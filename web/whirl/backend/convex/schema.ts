import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  artifactBindingValidator,
  attachmentValidator,
  compactionMarkerValidator,
  compactionStatusValidator,
  compactionUsageValidator,
  homeSuggestionValidator,
  integrationMentionValidator,
  kirkifyPoolValidator,
  kirkifyRunStatusValidator,
  messageStatusValidator,
  modelCapabilitiesValidator,
  phaseValidator,
  sendOptionsValidator,
  skillMentionValidator,
  threadLockValidator,
  usageChargeFeatureValidator,
  usageChargeStatusValidator,
} from "./validators";

export default defineSchema({
  threads: defineTable({
    userId: v.string(),
    title: v.string(),
    titleStatus: v.optional(
      v.union(v.literal("generating"), v.literal("ready")),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
    pinnedAt: v.optional(v.number()),
    // Tier key or admin catalog slug — whatever the last send picked
    // (see sendOptionsValidator).
    model: v.optional(v.string()),
    // LEGACY. The summary now lives in `threadCompaction` — multi-KB prose on
    // a row the sidebar reads in full for every thread a user owns, and which
    // nothing in the sidebar renders. See convex/threadCompaction.ts. Cleared
    // on the next compaction; optional so old rows still validate.
    compactionSummary: v.optional(v.string()),
    // The rest stay put — all scalars or a few small entries, and the sidebar
    // and usage page read them alongside threads they're fetching anyway.
    compactionBoundary: v.optional(v.id("messages")),
    compactionStatus: v.optional(compactionStatusValidator),
    compactionCost: v.optional(v.number()),
    compactionUpdatedAt: v.optional(v.number()),
    compactionUsage: v.optional(v.array(compactionUsageValidator)),
    compactionMarkers: v.optional(v.array(compactionMarkerValidator)),
    // A short, unguessable-ish public share token (5 chars). Anyone with the
    // link {site}/share/{shareId} can view this thread read-only — its messages
    // plus the documents and visualizations whirl authored in it. Assigned the
    // first time the user shares the thread; absent until then.
    shareId: v.optional(v.string()),
    // Incognito thread: ephemeral by design. It never appears in the sidebar /
    // search (excluded from listForCurrentUser), the model turn never writes to
    // memory and never auto-compacts, and the whole thing — messages, attachment
    // blobs, stream chunks, documents and visualizations — is hard-purged on
    // exit and on the next app load (see threads:purgeIncognito). The user is
    // still billed normally for inference and search; only the record is dropped.
    incognito: v.optional(v.boolean()),
    // Sidebar folder this thread lives in. Absent => the thread shows in the
    // regular date groups. Cleared when its folder is deleted (the thread
    // itself survives — see folders:deleteFolder).
    folderId: v.optional(v.id("folders")),
    // Locked thread: end-to-end encrypted, opened with a password the server
    // never sees (convex/lockedThreads.ts). Present means locked. Message
    // bodies and `lockedTitle` are sealed with a content key this envelope
    // wraps; `title` is replaced with a neutral placeholder, since the sidebar
    // has to draw the row without the key. Locked threads are barred from
    // sharing, memory, chat-history search, compaction, generated titles and
    // every server-side tool — none of those can run on ciphertext, and the
    // ones that could would spill plaintext back into our tables.
    lock: v.optional(threadLockValidator),
    // The thread's real title, sealed. Rendered in place of `title` in any
    // tab that currently holds the key.
    lockedTitle: v.optional(v.string()),
    // Set when this thread was branched off another thread at a checkpoint
    // (threads:branchThread). Purely informational — the sidebar shows a little
    // branch glyph — so a deleted source leaves a harmless dangling id.
    branchedFromThreadId: v.optional(v.id("threads")),
  })
    .index("by_user_updated_at", ["userId", "updatedAt"])
    .index("by_share_id", ["shareId"])
    // Lets the purge sweep find a user's incognito threads directly (there are
    // almost never more than one) instead of scanning their whole history on
    // every app load.
    .index("by_user_incognito", ["userId", "incognito"])
    // Lets folder deletion release its member threads without scanning the
    // user's whole history.
    .index("by_folder", ["folderId"]),

  // A thread's compaction summary — see the note on threads.compactionSummary
  // for why it isn't on the thread itself. At most one row per thread.
  threadCompaction: defineTable({
    threadId: v.id("threads"),
    summary: v.string(),
  }).index("by_thread", ["threadId"]),

  // User-created sidebar folders for organizing threads. `order` is the
  // user-chosen position (drag to reorder; lower sorts first). Membership
  // lives on the thread (`threads.folderId`), so a folder row stays tiny no
  // matter how many chats it holds.
  folders: defineTable({
    userId: v.string(),
    name: v.string(),
    order: v.number(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  messages: defineTable({
    threadId: v.id("threads"),
    userId: v.string(),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    attachments: v.optional(v.array(attachmentValidator)),
    // Integrations the user @mentioned in this (user) message. The stream
    // handler preloads these servers' toolsets for the turn.
    integrations: v.optional(v.array(integrationMentionValidator)),
    // Skills the user @mentioned in this (user) message. The stream handler
    // preloads these skills' full instructions for the turn.
    skills: v.optional(v.array(skillMentionValidator)),
    status: v.optional(messageStatusValidator),
    phases: v.optional(v.array(phaseValidator)),
    streamId: v.optional(v.string()),
    // Liveness beacon for in-flight assistant turns: the stream handler stamps
    // this every ~25s while it's alive, so the watchdog cron (streamWatchdog.ts)
    // can tell a dead turn — handler killed mid-flight by a client disconnect,
    // isolate crash, or provider hang — from a merely slow one, and surface it
    // as a retryable error instead of an eternal shimmer.
    heartbeatAt: v.optional(v.number()),
    model: v.optional(v.string()),
    thinking: v.optional(v.boolean()),
    search: v.optional(v.boolean()),
    usageCost: v.optional(v.number()),
    // Of usageCost, the portion billed to the purchased extra-usage bucket
    // (i.e. spent after the plan pool ran dry). 0/absent when the plan covered
    // the whole charge.
    extraUsageCost: v.optional(v.number()),
    // Per-response stats surfaced under the message when the user enables
    // "Show stats" in settings. `outputTokens` is the provider's completion
    // token count (reasoning tokens included); `durationMs` is the wall-clock
    // generation time — from the model request to the last token — captured
    // before the post-stream analytics/billing bookkeeping so it reflects the
    // model, not our side effects. Both are best-effort — absent on legacy rows
    // and when the provider omitted usage.
    outputTokens: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    // Full token accounting for the usage tab, straight from the provider's
    // usage report. `inputTokens` is the total prompt side (cache reads and
    // writes included); the cache fields break that total down; `totalTokens`
    // is the provider's own grand total (may fold in reasoning overhead).
    // Best-effort like `outputTokens` — absent on legacy rows.
    inputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    // Retired first take at hiding prompt overhead (a system-prompt share
    // estimate) — still on a few rows, no longer written or read.
    systemPromptTokens: v.optional(v.number()),
    // Estimated tokens (chars/4) of the conversation actually sent — the
    // prompt side that's genuinely the user's, sans system prompt and tool
    // schemas. The usage tab shows this instead of the provider's lump.
    promptContentTokens: v.optional(v.number()),
    // This row's `content` is a sealed envelope, not readable text — the row
    // belongs to a locked thread (see threads.lock). Nothing server-side may
    // treat it as prose: no title model, no memory extraction, no compaction,
    // and the BM25 index below is meaningless for it (locked threads are
    // filtered out of search results by thread, not by row).
    sealed: v.optional(v.boolean()),
    // Legacy local memory: ids of `memories` rows this assistant turn saved
    // before Supermemory took over extraction. Still drives old "N memory
    // added" indicators. Cleared when the message is reset/retried so the
    // indicator reflects the latest run.
    addedMemoryIds: v.optional(v.array(v.id("memories"))),
  })
    .index("by_thread_created_at", ["threadId", "createdAt"])
    .index("by_thread_role", ["threadId", "role"])
    .index("by_stream_id", ["streamId"])
    // Powers the stuck-turn watchdog: only the (tiny) in-flight statuses are
    // ever queried through this.
    .index("by_status", ["status"])
    .index("by_user_created_at", ["userId", "createdAt"])
    .index("by_user_role_created_at", ["userId", "role", "createdAt"])
    // Powers the searchChatHistory tool: BM25 over message bodies, scoped to
    // the owner. Incognito threads are filtered out post-search (incognito
    // lives on the thread, and those rows are hard-purged shortly anyway).
    .searchIndex("search_content", {
      searchField: "content",
      filterFields: ["userId"],
    }),

  // Messages typed while a reply was still being written, waiting their
  // turn. The deployment sends them (convex/messageQueue.ts) the moment the
  // reply ahead settles, so the tab that typed one can move on or close.
  // Same payload sendUserMessage takes, held until it's this message's go.
  queuedMessages: defineTable({
    threadId: v.id("threads"),
    userId: v.string(),
    content: v.string(),
    attachments: v.optional(v.array(attachmentValidator)),
    integrations: v.optional(v.array(integrationMentionValidator)),
    skills: v.optional(v.array(skillMentionValidator)),
    options: v.optional(sendOptionsValidator),
    // The sender's display name, captured while there was an identity to
    // read it from — the send happens from a settle with no caller behind it.
    userName: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_thread_created_at", ["threadId", "createdAt"]),

  // Documents whirl authors and revises in a thread. Markdown documents render
  // as rich text; code documents render as editable source files and carry the
  // filename/language needed for a raw download. `format` is optional so rows
  // created before code documents existed continue to mean "markdown".
  documents: defineTable({
    threadId: v.id("threads"),
    userId: v.string(),
    title: v.string(),
    // LEGACY inline body. Bodies now live in `documentContents` (see
    // convex/artifactContent.ts) and this is cleared on the row's next write;
    // it stays optional so rows written before the split still validate.
    content: v.optional(v.string()),
    // The body row. Absent only on legacy rows the backfill hasn't reached.
    contentId: v.optional(v.id("documentContents")),
    // Whether the body is non-empty — so listing queries can skip empty
    // documents without reading the body at all.
    hasContent: v.optional(v.boolean()),
    format: v.optional(v.union(v.literal("markdown"), v.literal("code"))),
    fileName: v.optional(v.string()),
    language: v.optional(v.string()),
    createdByMessageId: v.optional(v.id("messages")),
    // "streaming" while whirl is still writing the body (the panel renders it
    // live + read-only); "complete" once the tool call finishes. Optional so
    // any row written before this field existed still validates.
    status: v.optional(v.union(v.literal("streaming"), v.literal("complete"))),
    // A short, unguessable public share token. Anyone with the link
    // {site}/doc/{shortId} can view a COMPLETED document. Assigned at
    // creation; optional so legacy rows still validate (the panel mints one
    // on next open via ensureDocumentShareId).
    shortId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_user", ["userId"])
    .index("by_short_id", ["shortId"])
    // Finds rows the body backfill hasn't migrated yet (contentId undefined).
    .index("by_content_id", ["contentId"]),

  // HTML artifacts whirl authors (paid-only): self-contained pages rendered in
  // a sandboxed iframe. Two kinds share this table, both streamed directly by
  // the main agent (status "streaming" -> "complete"), like a document but
  // rendered as HTML rather than markdown:
  //  - "inline": a quick visualization rendered straight into an inline chat
  //    card.
  //  - "full": a substantial standalone page (e.g. a study guide) that opens in
  //    the HTML side panel.
  // Either kind can be revised in place with editHtml.
  htmlArtifacts: defineTable({
    threadId: v.id("threads"),
    userId: v.string(),
    createdByMessageId: v.optional(v.id("messages")),
    kind: v.union(v.literal("inline"), v.literal("full")),
    // How the body is rendered. Absent means "html" — the original runtime,
    // where the body IS the markup. "react" bodies are a JSX module compiled
    // on the host and mounted inside the sandbox against a prebuilt
    // React/Tailwind/Recharts runtime.
    runtime: v.optional(v.union(v.literal("html"), v.literal("react"))),
    // Read-only integration reads a react artifact declared at creation. The
    // HOST runs these, never the artifact's own code — the sandbox has no
    // call channel of its own, which is what makes them safe to auto-approve.
    // Any artifact carrying one is withheld from public share links.
    bindings: v.optional(v.array(artifactBindingValidator)),
    // Short label, shown on the card / panel header. Optional for inline viz.
    title: v.string(),
    // LEGACY inline body (NOT wrapped in the iframe host doc — the client wraps
    // it with theme tokens + a height reporter at render time). Bodies now live
    // in `htmlArtifactContents`; see the note on documents.content.
    content: v.optional(v.string()),
    contentId: v.optional(v.id("htmlArtifactContents")),
    hasContent: v.optional(v.boolean()),
    // LEGACY, "full" only: the page brief from the retired background-builder
    // era. Full pages are written directly by the main agent now.
    brief: v.optional(v.string()),
    status: v.union(
      v.literal("streaming"), // the main agent is writing the body
      v.literal("pending"), // LEGACY: retired background builder, queued
      v.literal("generating"), // LEGACY: retired background builder, writing
      v.literal("complete"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    // A short, unguessable-ish public share token (5 chars). Anyone with the
    // link {site}/visual/{shortId} can view a COMPLETED artifact. Assigned at
    // creation; optional only so legacy rows still validate.
    shortId: v.optional(v.string()),
    updatedAt: v.number(),
  })
    .index("by_thread", ["threadId"])
    .index("by_user", ["userId"])
    .index("by_short_id", ["shortId"])
    // Finds rows the body backfill hasn't migrated yet (contentId undefined).
    .index("by_content_id", ["contentId"]),

  // Artifact bodies, kept out of the rows above so that listing, sorting, and
  // permission-checking an artifact never pays for its text — and so the many
  // small writes of a streaming body don't invalidate every query that merely
  // lists titles. Always reached by id from the parent's `contentId`, never
  // queried directly, so they need no index of their own.
  documentContents: defineTable({
    content: v.string(),
  }),

  htmlArtifactContents: defineTable({
    content: v.string(),
  }),

  // The last result of one data binding, keyed by the exact arguments it ran
  // with. Doubles as the rate limiter: a repeat read inside the TTL is served
  // from here without touching the integration, so an artifact stuck in a
  // render loop costs one call per window instead of one per frame.
  //
  // `scope` is who owns the binding — "artifact:<htmlId>" for a react
  // artifact, "chart:<messageId>:<phaseIndex>" for a live chart. A string
  // rather than an id union because the two live in different places (a table
  // row vs a phase on a message) and the cache does not care which.
  artifactBindingCache: defineTable({
    scope: v.string(),
    bindingId: v.string(),
    // Stable hash of the resolved arguments — same binding, different filter,
    // different row.
    argsKey: v.string(),
    // The integration's response text, or the failure copy when `ok` is false.
    value: v.string(),
    ok: v.boolean(),
    fetchedAt: v.number(),
  }).index("by_binding", ["scope", "bindingId", "argsKey"]),

  // Per-scope call budget for data bindings, as a rolling window. The cache
  // above absorbs identical reads; this is the backstop for something that
  // varies its parameters every frame.
  artifactBindingUsage: defineTable({
    scope: v.string(),
    windowStart: v.number(),
    count: v.number(),
  }).index("by_scope", ["scope"]),

  // Singleton row tracking the version (git SHA) of the live production
  // deployment. Written by the Vercel deploy webhook (see convex/deployment.ts),
  // subscribed to by clients to detect when a newer client has shipped.
  deployment: defineTable({
    version: v.string(),
    updatedAt: v.number(),
  }),

  // Singleton row holding admin-configured global settings. Currently just the
  // usage-multiplier "event": a time-windowed modifier that scales how much
  // usage each prompt deducts (e.g. multiplier 0.5 => prompts cost half =>
  // "2x usage"). Read by the inference deduction path, the global banner, and
  // the pricing page. Written only by admin mutations in convex/admin.ts.
  adminConfig: defineTable({
    // Deduction factor applied to the `usage` pool, e.g. 0.5 => "2x usage".
    multiplier: v.optional(v.number()),
    // Banner / pricing copy shown while the event is active.
    headline: v.optional(v.string()),
    subtext: v.optional(v.string()),
    // When true, free-tier per-message deductions are scaled too; otherwise the
    // multiplier only touches the paid `usage` pool.
    applyToFreeMessages: v.optional(v.boolean()),
    // Active window (ms epoch). Absent bound => unbounded on that side.
    startsAt: v.optional(v.number()),
    expiresAt: v.optional(v.number()),
    // Master on/off independent of the window.
    enabled: v.optional(v.boolean()),
    updatedAt: v.number(),
  }),

  // Singleton row: whether the Platinum line is open for purchase right now.
  // Its own table rather than a field on adminConfig, which setMultiplierConfig
  // replaces wholesale — a co-tenant field there would be wiped every time an
  // admin saved a usage event. Absent row => closed.
  platinumConfig: defineTable({
    open: v.boolean(),
    updatedAt: v.number(),
  }),

  // One row per person who asked to be let into Platinum while it was closed.
  // An admin approves from the console, which mints a Stripe checkout link and
  // emails it to them (see convex/platinum.ts). `email` and `name` are snapped
  // from the Clerk identity at request time so the console can show a real
  // person without a second round trip to Clerk.
  platinumInterest: defineTable({
    userId: v.string(),
    email: v.string(),
    name: v.optional(v.string()),
    // Which tier they asked for: "platinum" or "platinum_max".
    plan: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("approved"),
      v.literal("declined"),
    ),
    // The checkout link the approval email carried, kept so an admin can
    // re-send or copy it without minting a second session.
    checkoutUrl: v.optional(v.string()),
    decidedAt: v.optional(v.number()),
    emailedAt: v.optional(v.number()),
    // Why the invite email failed, if it did — an approval whose email bounced
    // must be visible in the console, not silently "approved".
    emailError: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_status", ["status", "createdAt"]),

  // Which models the user starred into the composer's compact picker — tier
  // keys and catalog slugs mixed, order irrelevant. One row per user so
  // favorites roam devices (the client keeps a localStorage mirror for
  // instant paint and signed-out use; see apps/v2/lib/model-favorites.ts).
  modelFavorites: defineTable({
    userId: v.string(),
    keys: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // The composer's search + thinking gate choices. One row per user so the
  // toggles roam devices (the client keeps a localStorage mirror for
  // instant paint and signed-out use; see apps/v2/lib/composer-gates.ts).
  // `thinking` stays a plain string here — the mutation validates against
  // the current levels, the client clamps unknowns to its default.
  composerGates: defineTable({
    userId: v.string(),
    search: v.boolean(),
    thinking: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Free-text personalization written by the user in general settings. One row
  // per user; injected verbatim into the model's system prompt as explicit
  // user preferences (see convex/prompts.ts).
  userPreferences: defineTable({
    userId: v.string(),
    text: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Legacy local memory rows. New memory extraction/search is handled by
  // Supermemory; these rows remain so historical per-message indicators and
  // manual edits for old rows do not break.
  memories: defineTable({
    userId: v.string(),
    text: v.string(),
    createdAt: v.number(),
    updatedAt: v.number(),
    sourceMessageId: v.optional(v.id("messages")),
  }).index("by_user", ["userId"]),

  // The two home-screen starters, the batch they were drawn from, and what
  // the user has already turned down. This lives in the database rather than
  // the browser because it decides when a user pays for a generation: a
  // cleared localStorage must never be able to bill someone for a batch they
  // already have. The client's cache is only there to paint the first frame.
  homeSuggestions: defineTable({
    userId: v.string(),
    // What the two cards show, in order.
    visible: v.array(homeSuggestionValidator),
    // Generated with them, waiting to take a dismissed card's place.
    reserve: v.array(homeSuggestionValidator),
    // Prompts already dismissed, newest last — the model's exclusion list.
    dismissed: v.array(v.string()),
    // Card index awaiting a replacement; absent when nothing is in flight.
    pendingSlot: v.optional(v.number()),
    // Lease on a generation, so two tabs can't pay for the same batch. Stale
    // leases expire, which is also how a crashed generation recovers.
    claimedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Per-user memory switch. Absent row => the default (on). When off,
  // Supermemory retrieval and writes are skipped.
  memorySettings: defineTable({
    userId: v.string(),
    enabled: v.boolean(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Memory sync (paid perk, 1/day): a background sweep that uploads recently
  // touched thread transcripts to Supermemory. One row per run, tracking live
  // progress so the settings UI can draw a progress bar, plus the rolling-24h
  // cooldown and the incremental cutoff (only threads updated since the last
  // completed run are scanned).
  memoryIndexRuns: defineTable({
    userId: v.string(),
    status: v.union(
      v.literal("running"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    startedAt: v.number(),
    finishedAt: v.optional(v.number()),
    // Only threads whose updatedAt is past this cutoff are scanned this run.
    cutoff: v.number(),
    totalThreads: v.number(),
    processedThreads: v.number(),
    // New memories saved across all threads in this run.
    addedCount: v.number(),
    // USD spent on the run, and the portion billed to the extra-usage bucket.
    cost: v.optional(v.number()),
    extraCost: v.optional(v.number()),
    error: v.optional(v.string()),
  }).index("by_user_started_at", ["userId", "startedAt"]),

  // Auto-captured device context (IANA timezone + locale), one row per user.
  // Reported silently by the client on load — the user is never asked — and
  // used to tell the model the user's local time and approximate whereabouts.
  // Precise coordinates are only ever filled in when the browser geolocation
  // permission is already granted (read silently) or the user explicitly opts
  // in via the weather widget; otherwise location stays timezone-coarse.
  userContext: defineTable({
    userId: v.string(),
    timeZone: v.string(),
    locale: v.optional(v.string()),
    /** Metric vs imperial for weather and other unit-aware surfaces. */
    unitsSystem: v.optional(
      v.union(v.literal("auto"), v.literal("metric"), v.literal("imperial")),
    ),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    place: v.optional(v.string()),
    locationUpdatedAt: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Acquisition-funnel stations a user has already passed (see convex/funnel.ts).
  // One row per user holding a small set of milestone names — `first_chat`,
  // `free_limit`, `paid`. The row exists so a "first time" event stays a first
  // time: PostHog is fed from several places (a send mutation, the stream's gate
  // rejection, the client noticing a paid plan), and any of them can fire twice.
  // Bounded by the milestone list, so the array never grows unbounded.
  funnelMilestones: defineTable({
    userId: v.string(),
    reached: v.array(v.string()),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // MCP Servers (paid-only): per-user remote (HTTP) Model Context Protocol
  // servers the user has registered. Each row is one server; the model sees
  // only its name + description per turn and discovers its tools on demand
  // through the mcp_list_tools / mcp_call_tool gateway (see inference/mcp.ts).
  // Header values are AES-GCM ciphertext (see convex/inference/crypto.ts) and
  // never leave the server in plaintext — `listServers` returns header keys
  // only. `lastConnectedAt` / `lastError` reflect the most recent connection or
  // tools/list attempt so the settings UI can show "Connected · N tools".
  mcpServers: defineTable({
    userId: v.string(),
    name: v.string(),
    url: v.string(),
    enabled: v.boolean(),
    // Set when this server was installed from the integration store: links back
    // to the store listing for branding, and guards against double-installs.
    // Absent on hand-added servers.
    integrationId: v.optional(v.id("integrations")),
    // How the server authenticates. Absent => "headers" (the original mode).
    authMode: v.optional(v.union(v.literal("headers"), v.literal("oauth"))),
    // Header pairs sent to the server. `valueCipher` is "ivBase64:cipherBase64".
    // Capped at MAX_HEADERS_PER_SERVER in the mutations so the row stays small.
    headers: v.optional(
      v.array(
        v.object({
          key: v.string(),
          valueCipher: v.string(),
        }),
      ),
    ),
    // OAuth state for `authMode: "oauth"`. Endpoints + client are filled in by
    // Dynamic Client Registration when the user starts the flow; the tokens are
    // filled in by the callback. All secret material (`*Cipher`) is AES-GCM
    // encrypted at rest and never returned to the client.
    oauth: v.optional(
      v.object({
        clientId: v.string(),
        clientSecretCipher: v.optional(v.string()),
        authorizationEndpoint: v.string(),
        tokenEndpoint: v.string(),
        registrationEndpoint: v.optional(v.string()),
        scope: v.optional(v.string()),
        resource: v.optional(v.string()),
        accessTokenCipher: v.optional(v.string()),
        refreshTokenCipher: v.optional(v.string()),
        expiresAt: v.optional(v.number()),
        connected: v.optional(v.boolean()),
      }),
    ),
    // Composio-backed installs (the listing has `integrations.composio`):
    // install-time account connection state. Present from install for any
    // Composio listing whose toolkit needs an account; `connectedAccountId`
    // is filled in when the user starts the hosted link flow, and `connected`
    // flips true once Composio reports the account ACTIVE (verified by the
    // /composio/oauth/callback route). Runtime skips servers where
    // `connected` is false, mirroring not-connected OAuth servers.
    composio: v.optional(
      v.object({
        connectedAccountId: v.optional(v.string()),
        connected: v.boolean(),
      }),
    ),
    lastConnectedAt: v.optional(v.number()),
    lastError: v.optional(v.string()),
    // When the stored credential stopped being accepted — an OAuth refresh
    // that was rejected, or a 401/403 from the integration itself. Distinct
    // from "never connected": this one used to work, so the UI asks for a
    // reconnect in red instead of an install nudge in amber. Cleared the
    // moment anything succeeds against the server again.
    authExpiredAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // In-flight OAuth authorization-code flows (PKCE). One short-lived row per
  // "Connect" click; looked up by `state` when the provider redirects back to
  // the callback, then deleted. `codeVerifier` is the PKCE secret.
  mcpOAuthFlows: defineTable({
    userId: v.string(),
    serverId: v.id("mcpServers"),
    state: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
    createdAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_server", ["serverId"]),

  // Singleton row caching how much free-tier traffic has cost Whirl so far
  // today (USD), read from a PostHog endpoint. Refreshed by a cron and by a
  // background job scheduled from stale inference reads. The inference path
  // uses it to tighten free message caps when we're under load, and clients
  // subscribe (via serverLoad:getServerLoad) to show the vague "servers under
  // extra load" notice under the composer.
  serverLoad: defineTable({
    freeCostUsd: v.number(),
    updatedAt: v.number(),
  }),

  // Pending "your usage limits were reset" notices, one per affected user. An
  // admin reset writes a row here (keyed by the user's id = Autumn customer id =
  // Clerk subject) with admin-customizable copy; the app shows it as a modal on
  // the user's next visit and deletes it on dismiss.
  resetNotices: defineTable({
    userId: v.string(),
    message: v.string(),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // Admin-curated AI models, managed from the console's Models tab
  // (convex/models.ts). Two kinds share the table:
  // - custom models (`tier` absent): extra OpenRouter models that join v2's
  //   composer search list alongside the preset lineup.
  // - tier overrides (`tier` set): swap the model behind a preset tier
  //   without a deploy. Auto is deliberately not overridable. Inference falls
  //   back to the hardcoded MODEL_IDS defaults (inference/billing.ts) when a
  //   tier has no row here.
  // Capabilities are auto-detected from OpenRouter at save time, so a saved
  // slug is always a real, routable model.
  models: defineTable({
    // The preset tier this row overrides, in internal-key terms (the label
    // mapping lives in inference/billing.ts: Fast=Free, Basic=Fast,
    // Max=Heavy).
    tier: v.optional(
      v.union(
        v.literal("Fast"),
        v.literal("Basic"),
        v.literal("Max"),
        v.literal("Image"),
      ),
    ),
    // OpenRouter model slug, e.g. "anthropic/claude-fable-5".
    slug: v.string(),
    // What the composer's model picker shows.
    displayName: v.string(),
    // Who makes the model ("Anthropic") and what they call it ("Claude
    // Fable 5") — shown in the console and searchable in the picker.
    company: v.string(),
    modelName: v.string(),
    // Legacy per-model icon. New icons live in modelProviders so one provider
    // mark applies to all its models; reads keep this as a migration fallback.
    iconSvg: v.optional(v.string()),
    capabilities: modelCapabilitiesValidator,
    // Custom models can be drafted (hidden from the picker) via this switch.
    // Tier overrides are always written enabled — reverting is deletion.
    enabled: v.boolean(),
    // Search-only retirement: a legacy model leaves the picker's browse
    // list but still answers a typed search (and keeps serving anyone who
    // already picked it). Custom rows only — tier overrides can't retire.
    legacy: v.optional(v.boolean()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_enabled", ["enabled"])
    .index("by_slug", ["slug"])
    .index("by_tier", ["tier"]),

  // One shared monochrome icon per AI provider. Models continue to store the
  // provider's display name; this normalized key lets every Anthropic model,
  // for example, pick up one icon without duplicating SVG markup per row.
  modelProviders: defineTable({
    name: v.string(),
    normalizedName: v.string(),
    // An absent icon is an explicit clear that suppresses legacy model icons.
    iconSvg: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_normalized_name", ["normalizedName"]),

  // Every OpenRouter model with at least one zero-retention endpoint, cached
  // from `GET /models?zdr=true` by convex/zeroRetention.ts. Singleton row,
  // refreshed on a cron: a locked chat may only run a model on this list, and
  // both the composer and the turn handler resolve against it rather than
  // against a list anyone maintains by hand.
  zeroRetentionModels: defineTable({
    slugs: v.array(v.string()),
    updatedAt: v.number(),
  }),

  // Which preset tiers are locked behind a paid plan — admin-set from the
  // console's Models tab (convex/models.ts). Singleton row; absent means
  // the built-in default (everything but the Free tier). Free users see
  // locked tiers with an upgrade prompt, and the stream rejects them with
  // the tier's gate sentinel; a tier taken OFF the list skips the Autumn
  // model gate for free users entirely (their messages meter still
  // applies).
  tierAccess: defineTable({
    restrictedTiers: v.array(v.string()),
    updatedAt: v.number(),
  }),

  // Whirl Console (apps/console): developer-registered integrations. Each row
  // is one MCP server destined for the integration store, where regular Whirl
  // users will be able to add it. Registered from the console's New
  // Integration form, reviewed in the admin Approvals tab.
  integrations: defineTable({
    userId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    // Store shelf this listing sits on (one of storeCategories.ts's
    // STORE_CATEGORIES). Assigned by a lightweight model after approval
    // (storeCategorize.ts); absent until then — clients bucket missing as
    // "Everything else".
    category: v.optional(v.string()),
    // Display author for the store listing. "Whirl" submitted by an admin
    // account => `verified` (the blue checkmark). Optional only for rows that
    // predate the store model.
    author: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    // Store branding. Logo (required on new rows) and banner live in Convex
    // storage; the small monochrome icon is raw SVG markup so clients can
    // recolor it via CSS mask (shown gray wherever Whirl uses the
    // integration, in place of the generic plug icon).
    logoId: v.optional(v.id("_storage")),
    // External logo URL, used instead of `logoId` for listings whose branding
    // lives on someone else's CDN (Composio-sourced extensions). Storage wins
    // when both are present.
    logoUrl: v.optional(v.string()),
    bannerId: v.optional(v.id("_storage")),
    iconSvg: v.optional(v.string()),
    // The MCP server itself.
    mcpUrl: v.optional(v.string()),
    // How users authenticate when installing: "oauth" runs the standard MCP
    // OAuth flow; "apiKey" shows `authFields` as inputs (usually exactly one)
    // plus `authInstructions` telling them where to get the value; "none"
    // needs nothing.
    authMode: v.optional(
      v.union(v.literal("none"), v.literal("oauth"), v.literal("apiKey")),
    ),
    // For "apiKey": each field is one input the installing user fills in.
    // `key` is the HTTP header the value is sent as; `label` is what the
    // user sees.
    authFields: v.optional(
      v.array(v.object({ key: v.string(), label: v.string() })),
    ),
    authInstructions: v.optional(v.string()),
    // The server's tools, scanned from tools/list at registration time. Each
    // description is a developer-written ACTION PHRASE ("Searching your
    // issues") — it's the status line chat shows while the model runs the
    // tool, not the server's own advertised description. `completed` is its
    // past-tense sibling ("Searched your issues"), shown once the call
    // finishes; optional only for rows that predate it (the console now
    // requires it).
    tools: v.optional(
      v.array(
        v.object({
          name: v.string(),
          description: v.string(),
          completed: v.optional(v.string()),
        }),
      ),
    ),
    enabled: v.boolean(),
    // Legacy minted-API-key era fields; new rows no longer write these.
    environment: v.optional(
      v.union(v.literal("development"), v.literal("production")),
    ),
    secret: v.optional(v.string()),
    keyPrefix: v.optional(v.string()),
    // Approval workflow: new integrations start "pending" and an admin
    // approves or denies them from the console's Approvals tab. Absent =>
    // "approved" (rows that predate the workflow). Only approved integrations
    // can be enabled.
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
      ),
    ),
    // Requester identity claims captured at create time so reviewers see a
    // human, not a Clerk subject id.
    requestedByName: v.optional(v.string()),
    requestedByEmail: v.optional(v.string()),
    // Review outcome: who decided, when, and why. `reviewNote` is shown to
    // the requester (required on deny, optional on approve).
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    lastUsedAt: v.optional(v.number()),
    // Present only on Composio-backed extensions added from the console's
    // admin Extensions page (see convex/composio.ts). Records the Composio
    // resources this listing owns so removal can clean them up remotely, and
    // marks the row for install-time wiring: installs of a Composio listing
    // get a per-user `user_id` URL param plus our org API key as an encrypted
    // header (see integrationStore.installInternal).
    composio: v.optional(
      v.object({
        // Toolkit slug in Composio's catalog, e.g. "github".
        slug: v.string(),
        // The Composio-managed auth config created for this toolkit.
        authConfigId: v.string(),
        // The single-toolkit MCP server created for this listing.
        mcpServerId: v.string(),
        // True for toolkits that need no account at all (e.g. Hacker News) —
        // installs skip the connect-account popup entirely.
        noAuth: v.optional(v.boolean()),
      }),
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    // Lets the admin approvals queue list pending requests across all users.
    .index("by_status", ["status"]),

  // Whirl Console (apps/console): developer-registered skills. A skill is a
  // pasted block of instructions the model pulls in on demand (via the
  // load_skill tool) — no server, no auth, just text plus store branding.
  // Registered from the console's New Skill form, reviewed in the same admin
  // Approvals queue as integrations.
  skills: defineTable({
    userId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    // Store shelf, same story as integrations.category: model-assigned after
    // approval, absent until then.
    category: v.optional(v.string()),
    // Display author for the store listing. "Whirl" submitted by an admin
    // account => `verified` (the blue checkmark).
    author: v.optional(v.string()),
    verified: v.optional(v.boolean()),
    // Store branding, same shapes as integrations: logo (required on new
    // rows) and banner live in Convex storage; the small monochrome icon is
    // raw SVG so the chat chip can recolor it via CSS mask.
    logoId: v.optional(v.id("_storage")),
    bannerId: v.optional(v.id("_storage")),
    iconSvg: v.optional(v.string()),
    // The skill itself: the instruction text handed to the model when it
    // calls load_skill. Never sent to the store's browse surface.
    instructions: v.string(),
    enabled: v.boolean(),
    // Approval workflow, identical to integrations: new skills start
    // "pending" and an admin approves or denies them from the console's
    // Approvals tab. Only approved skills are listed in the store.
    status: v.optional(
      v.union(
        v.literal("pending"),
        v.literal("approved"),
        v.literal("denied"),
      ),
    ),
    requestedByName: v.optional(v.string()),
    requestedByEmail: v.optional(v.string()),
    reviewedBy: v.optional(v.string()),
    reviewedAt: v.optional(v.number()),
    reviewNote: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    // Lets the admin approvals queue list pending requests across all users.
    .index("by_status", ["status"]),

  // A user's installed skills, one row per (user, skill). Deliberately
  // separate from mcpServers: skills are plain text, need no auth or quota,
  // and there is no cap on how many a user can install.
  skillInstalls: defineTable({
    userId: v.string(),
    skillId: v.id("skills"),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_skill", ["skillId"]),

  // A user's own skills, written by hand in Settings → Integrations — the
  // bring-your-own sibling of store skills. Same runtime treatment as a
  // store install (name + description in the prompt, text pulled via
  // load_skill), but the instructions live right on the row: no listing, no
  // approval queue, no branding. Capped per user in customSkills.ts.
  customSkills: defineTable({
    userId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    // The instruction text handed to the model when it calls load_skill.
    instructions: v.string(),
    enabled: v.boolean(),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  // Short-lived OAuth flows for the console's tool scanner (see
  // convex/integrationScan.ts). When a developer registers an OAuth-protected
  // MCP server, they sign in once so tools/list can run; the grant lives here
  // (ciphertext, scan-scoped) and is never attached to the integration —
  // store users do their own OAuth when installing. Rows are purged whenever
  // the same user starts a new scan flow.
  integrationScanFlows: defineTable({
    userId: v.string(),
    // The MCP server URL this grant was issued for.
    url: v.string(),
    state: v.string(),
    codeVerifier: v.string(),
    redirectUri: v.string(),
    clientId: v.string(),
    clientSecretCipher: v.optional(v.string()),
    tokenEndpoint: v.string(),
    resource: v.optional(v.string()),
    status: v.union(
      v.literal("pending"),
      v.literal("connected"),
      v.literal("failed"),
    ),
    accessTokenCipher: v.optional(v.string()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_state", ["state"])
    .index("by_user", ["userId"]),

  // Every charge Whirl owes Autumn, written down before it's sent and kept
  // until Autumn confirms it. Reporting usage is a network call to somebody
  // else's API — it can be slow, it can 500, and the isolate that started it
  // can be torn down before it lands. Firing it best-effort meant a turn that
  // cost real money could quietly go unbilled with nothing left to show for
  // it. Now the row is the source of truth: the sweeper (convex/crons.ts)
  // retries anything still `pending`, and Autumn's idempotency keys make a
  // replay a no-op. See convex/usageLedger.ts.
  usageCharges: defineTable({
    customerId: v.string(),
    // What Autumn dedupes on — stable per logical charge, so retrying one can
    // never double-bill.
    idempotencyKey: v.string(),
    feature: usageChargeFeatureValidator,
    // What to report: USD for the metered features (already scaled by any
    // active usage multiplier), a message count for `messages`.
    amount: v.number(),
    status: usageChargeStatusValidator,
    attempts: v.number(),
    // Earliest the sweeper may try again — backs off after each failure.
    nextAttemptAt: v.number(),
    lastError: v.optional(v.string()),
    // The assistant message this charge belongs to, when it has one. The
    // extra-usage split isn't known until Autumn answers, so it's written back
    // here on settle.
    assistantId: v.optional(v.id("messages")),
    // Which path opened the charge ("assistant_turn", "web_search", …) —
    // purely for reading the ledger back when something looks off.
    source: v.string(),
    createdAt: v.number(),
    settledAt: v.optional(v.number()),
    // Set when support credited this charge back (convex/support/refunds.ts).
    // Present means the money went back to the customer, so a second refund
    // of the same reply finds it here and stops.
    refund: v.optional(
      v.object({
        at: v.number(),
        approvedBy: v.string(),
        reason: v.string(),
      }),
    ),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_status_and_next_attempt", ["status", "nextAttemptAt"])
    // A reply's charges, for refunding one.
    .index("by_assistant_id", ["assistantId"]),
  // /kirkify's daily budget: one counter per (key, UTC day). Keys are
  // "ip:<hash>", "device:<cookie id>", "user:<clerk id>", "ipAccounts:<hash>",
  // "paid:<clerk id>" and the two "global:" cost breakers — the shapes and
  // the limits live in convex/kirkify/limits.ts. Every counter a request
  // touches is bumped in one mutation, so two requests racing for the last
  // slot can't both get it. The cron drops rows once their day is over.
  kirkifyQuota: defineTable({
    key: v.string(),
    day: v.string(),
    count: v.number(),
  })
    .index("by_key_and_day", ["key", "day"])
    .index("by_day", ["day"]),

  // One row per Kirkify attempt: which pool paid for it, what the provider
  // charged, and how it ended. The audit trail for a feature that spends real
  // money on anonymous traffic. Swept after a month.
  kirkifyRuns: defineTable({
    day: v.string(),
    pool: kirkifyPoolValidator,
    status: kirkifyRunStatusValidator,
    ipHash: v.string(),
    deviceId: v.string(),
    userId: v.optional(v.string()),
    model: v.string(),
    costDollars: v.optional(v.number()),
    error: v.optional(v.string()),
    durationMs: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_day", ["day"]),
});
