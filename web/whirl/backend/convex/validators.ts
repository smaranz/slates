import { type Infer, v } from "convex/values";

export const attachmentValidator = v.object({
  id: v.string(),
  name: v.string(),
  size: v.number(),
  type: v.string(),
  storageId: v.optional(v.id("_storage")),
  url: v.optional(v.string()),
  data: v.optional(v.string()),
  text: v.optional(v.string()),
  skippedReason: v.optional(v.string()),
});

/**
 * One read a react artifact declared against a connected integration. The
 * artifact's own code can never name an integration or a tool — it asks for a
 * binding by `id` and the host runs whatever was declared here, which is what
 * keeps a model-written page from turning into a general-purpose gateway.
 *
 * `args` is a JSON-encoded object, exactly like mcp_call_tool's `arguments`:
 * a free-form object in a tool schema trips the strict-schema providers, and
 * a string round-trips everywhere.
 */
export const artifactBindingValidator = v.object({
  /** The handle the artifact's code passes to useWhirlData. */
  id: v.string(),
  /** Exact connected-integration name, resolved the same way the gateway does. */
  integration: v.string(),
  /** The integration tool to run. */
  tool: v.string(),
  /** JSON-encoded arguments object. */
  args: v.optional(v.string()),
  /** Human label for the host's "reads from" chrome. */
  label: v.optional(v.string()),
});

export type ArtifactBinding = Infer<typeof artifactBindingValidator>;

export const searchSourceValidator = v.object({
  url: v.string(),
  title: v.string(),
  author: v.optional(v.string()),
  publishedDate: v.optional(v.string()),
});

// One evaluated expression inside a batch calculation.
export const calcItemValidator = v.object({
  expression: v.string(),
  result: v.optional(v.string()),
  label: v.optional(v.string()),
  expressionTex: v.optional(v.string()),
  resultTex: v.optional(v.string()),
  needsLatex: v.optional(v.boolean()),
  error: v.optional(v.string()),
});

// One hour in a weather widget's hourly strip.
export const weatherHourValidator = v.object({
  time: v.string(),
  temp: v.number(),
  code: v.number(),
  precipProb: v.optional(v.number()),
});

// One day in a weather widget's daily forecast.
export const weatherDayValidator = v.object({
  date: v.string(),
  code: v.number(),
  max: v.number(),
  min: v.number(),
  precipProb: v.optional(v.number()),
  sunrise: v.optional(v.string()),
  sunset: v.optional(v.string()),
});

// One series in a chart, mirrored from ChartSeries in inference/chart.ts.
// `values` lines up index-for-index with the spec's categories (null is a gap
// in the data, not a zero); `points` replaces it for scatter charts, which
// have no shared category axis.
export const chartSeriesValidator = v.object({
  name: v.string(),
  values: v.optional(v.array(v.union(v.number(), v.null()))),
  points: v.optional(v.array(v.object({ x: v.number(), y: v.number() }))),
});

// A chart the model drew via the createChart tool, mirrored from ChartSpec in
// inference/chart.ts. The whole spec rides on the message phase — small
// enough to (the tool caps series, categories, and total points precisely so
// this row stays cheap to re-read while the turn streams).
export const chartSpecValidator = v.object({
  type: v.union(
    v.literal("line"),
    v.literal("area"),
    v.literal("bar"),
    v.literal("hbar"),
    v.literal("pie"),
    v.literal("scatter"),
  ),
  title: v.string(),
  subtitle: v.optional(v.string()),
  categories: v.optional(v.array(v.string())),
  series: v.array(chartSeriesValidator),
  stacked: v.optional(v.boolean()),
  xLabel: v.optional(v.string()),
  yLabel: v.optional(v.string()),
  format: v.optional(
    v.union(
      v.literal("number"),
      v.literal("compact"),
      v.literal("percent"),
      v.literal("currency"),
    ),
  ),
  currency: v.optional(v.string()),
  source: v.optional(v.string()),
  // A live source (see inference/chartBinding.ts). When present, the values
  // above are the snapshot taken when the chart was drawn, and the card
  // re-reads the integration on every open. The integration and tool are fixed
  // here at authoring time — nothing on the client can change them.
  binding: v.optional(
    v.object({
      integration: v.string(),
      tool: v.string(),
      args: v.optional(v.string()),
      path: v.optional(v.string()),
      categoryField: v.string(),
      valueFields: v.optional(v.array(v.string())),
      aggregate: v.optional(
        v.union(
          v.literal("none"),
          v.literal("count"),
          v.literal("sum"),
          v.literal("average"),
        ),
      ),
      limit: v.optional(v.number()),
    }),
  ),
});

// One step of an askUserQuestion form, mirrored from QuestionSpec in
// inference/askQuestion.ts. `options`/`allowOther` only apply to choice types;
// `placeholder` only to text.
export const questionSpecValidator = v.object({
  id: v.string(),
  prompt: v.string(),
  header: v.optional(v.string()),
  type: v.union(
    v.literal("single"),
    v.literal("multi"),
    v.literal("text"),
    v.literal("attachment"),
  ),
  options: v.optional(
    v.array(
      v.object({
        label: v.string(),
        description: v.optional(v.string()),
      }),
    ),
  ),
  allowOther: v.optional(v.boolean()),
  placeholder: v.optional(v.string()),
});

// The user's recorded answer to one form step. `selected` holds chosen option
// labels, `text` the free-text answer (a text step or the "something else"
// row), `attachments` the names of files they attached for an attachment step.
export const questionAnswerValidator = v.object({
  id: v.string(),
  selected: v.optional(v.array(v.string())),
  text: v.optional(v.string()),
  attachments: v.optional(v.array(v.string())),
  skipped: v.optional(v.boolean()),
});

export const phaseValidator = v.union(
  v.object({
    kind: v.literal("thought"),
    durationMs: v.number(),
    contentOffset: v.optional(v.number()),
    // Raw reasoning text captured from the model, surfaced in a modal when
    // the user clicks the persisted "Thought for N seconds" chip.
    text: v.optional(v.string()),
    pending: v.optional(v.boolean()),
  }),
  v.object({
    kind: v.literal("search"),
    sources: v.number(),
    items: v.optional(v.array(searchSourceValidator)),
    contentOffset: v.optional(v.number()),
    query: v.optional(v.string()),
    pending: v.optional(v.boolean()),
  }),
  // A deterministic calculation the model ran via a math tool, shown as a
  // quiet "Calculated …" chip that opens the full working. All result fields
  // are optional so a pending phase (shown while the model is still writing
  // the call) can exist before anything has been computed. Batch calls
  // (calculateBatch) carry their per-expression results in `items` instead of
  // the single expression/result pair.
  v.object({
    kind: v.literal("fetch"),
    sources: v.number(),
    items: v.optional(v.array(searchSourceValidator)),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  v.object({
    kind: v.literal("calc"),
    // Legacy: the retired "result card" mode. Kept so old messages validate;
    // never written anymore and ignored by the UI.
    visible: v.optional(v.boolean()),
    expression: v.optional(v.string()),
    result: v.optional(v.string()),
    label: v.optional(v.string()),
    expressionTex: v.optional(v.string()),
    resultTex: v.optional(v.string()),
    needsLatex: v.optional(v.boolean()),
    error: v.optional(v.string()),
    items: v.optional(v.array(calcItemValidator)),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // A live weather snapshot from Open-Meteo, rendered inline as a full widget
  // (current conditions + an hourly strip + a few days out) rather than a chip.
  // `error` covers the "couldn't find that place" case; `approximate` flags a
  // timezone-derived guess at the user's location when no precise fix exists.
  v.object({
    kind: v.literal("weather"),
    place: v.optional(v.string()),
    approximate: v.optional(v.boolean()),
    latitude: v.optional(v.number()),
    longitude: v.optional(v.number()),
    timezone: v.optional(v.string()),
    tempUnit: v.optional(v.union(v.literal("C"), v.literal("F"))),
    windUnit: v.optional(v.union(v.literal("km/h"), v.literal("mph"))),
    temp: v.optional(v.number()),
    apparentTemp: v.optional(v.number()),
    humidity: v.optional(v.number()),
    windSpeed: v.optional(v.number()),
    code: v.optional(v.number()),
    isDay: v.optional(v.boolean()),
    precipitation: v.optional(v.number()),
    hourly: v.optional(v.array(weatherHourValidator)),
    daily: v.optional(v.array(weatherDayValidator)),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // A call to a user-registered MCP server tool, shown as a quiet
  // "Used <server> · <tool>" chip. Opened pending on tool-input-start and
  // finalized (ok/error) once the tool returns. All fields optional so a
  // pending phase can exist before the call resolves.
  v.object({
    kind: v.literal("mcp"),
    server: v.optional(v.string()),
    tool: v.optional(v.string()),
    // Snapshot the store-configured lifecycle phrases so current and historic
    // messages render the same metadata even if the listing later changes.
    action: v.optional(v.string()),
    completed: v.optional(v.string()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // A skill (an installed instruction pack from the store) the model pulled
  // in via the load_skill tool, shown as a quiet "Learned <name>" chip.
  // Opened pending on tool-input-start and finalized (ok/error) once the
  // text is fetched. All fields optional so a pending phase can exist before
  // the load resolves.
  v.object({
    kind: v.literal("skill"),
    name: v.optional(v.string()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // A rummage through the user's past chats via the searchChatHistory tool,
  // shown as a quiet "Dug through your chats" chip. Opened pending on
  // tool-input-start; finalized with the query + match count once the search
  // settles. The matched excerpts go to the model only — never stored here.
  v.object({
    kind: v.literal("history"),
    query: v.optional(v.string()),
    matches: v.optional(v.number()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // Store listings whirl surfaced via the suggestIntegrations tool, rendered
  // inline as install cards. Only the listing id + a name snapshot are stored;
  // the card hydrates live branding + install state reactively (so installing
  // flips the card without touching the message). Opened pending on
  // tool-input-start; dropped instead of finalized when nothing matched.
  v.object({
    kind: v.literal("integrationSuggestion"),
    query: v.optional(v.string()),
    items: v.optional(
      v.array(
        v.object({
          integrationId: v.id("integrations"),
          name: v.string(),
        }),
      ),
    ),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // A markdown or code document whirl authored or revised via the document
  // tools,
  // shown inline as a card. Opened pending on tool-input-start (carrying the
  // `documentId` so the card can open + stream the live row); finalized once
  // the row is written. `op` distinguishes the first write ("create") from a
  // later find/replace pass ("edit").
  v.object({
    kind: v.literal("document"),
    op: v.optional(v.union(v.literal("create"), v.literal("edit"))),
    documentId: v.optional(v.id("documents")),
    title: v.optional(v.string()),
    editCount: v.optional(v.number()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // An HTML artifact whirl authored or revised via the HTML tools (paid-only),
  // shown inline as a card. `mode` is "inline" (a viz rendered straight in the
  // chat) or "full" (a standalone page that opens in the HTML side panel);
  // both stream live like a document. Opened pending on tool-input-start;
  // finalized once the row exists (carrying `htmlId` so the card can subscribe
  // to the live row). `op` distinguishes the first write ("create") from a
  // later find/replace pass ("edit").
  v.object({
    kind: v.literal("html"),
    mode: v.optional(v.union(v.literal("inline"), v.literal("full"))),
    op: v.optional(v.union(v.literal("create"), v.literal("edit"))),
    htmlId: v.optional(v.id("htmlArtifacts")),
    title: v.optional(v.string()),
    editCount: v.optional(v.number()),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // A chart whirl drew via the createChart tool, rendered inline as a card.
  // The model writes a spec, never the pixels — so the palette, light/dark
  // steps, and hover behaviour stay the app's. Opened pending on
  // tool-input-start; finalized with the validated spec once the call lands.
  // A spec the tool rejected never finalizes at all (the model gets the
  // reason back and retries), so `chart` is absent only on a stray pending
  // phase, which the turn-end sweep clears.
  v.object({
    kind: v.literal("chart"),
    chart: v.optional(chartSpecValidator),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // An image whirl painted mid-reply via the generateImage tool, rendered as
  // an inline picture card. Generation runs in a background worker (see
  // imageWorker.ts) so slow paints can't stall or time out the reply stream:
  // the phase opens pending on tool-input-start, gets its `prompt` stamped
  // when the job is scheduled, and the worker finalizes it with the stored
  // pictures' public URLs in `images`. Legacy rows have no `images` — those
  // pictures live in the prose as markdown (the old in-stream tool handed the
  // model a URL to embed) and the phase is just a "Painted an image" chip.
  v.object({
    kind: v.literal("image"),
    prompt: v.optional(v.string()),
    count: v.optional(v.number()),
    images: v.optional(v.array(v.string())),
    ok: v.optional(v.boolean()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // An interactive form whirl raised via the askUserQuestion tool. The
  // composer morphs into the steps while this is the thread's latest message;
  // answerQuestionPhase stamps `answers` + `answered` when the user submits,
  // and the serialized answers ride in as their next user message either way.
  v.object({
    kind: v.literal("question"),
    questions: v.optional(v.array(questionSpecValidator)),
    answers: v.optional(v.array(questionAnswerValidator)),
    answered: v.optional(v.boolean()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
  // Legacy: the retired generative-UI feature. No longer produced or rendered;
  // kept so older messages that stored a `ui` phase still validate.
  v.object({
    kind: v.literal("ui"),
    title: v.optional(v.string()),
    spec: v.optional(v.any()),
    error: v.optional(v.string()),
    contentOffset: v.optional(v.number()),
    pending: v.optional(v.boolean()),
  }),
);

export type MessagePhase = Infer<typeof phaseValidator>;

// Drop any phases still marked pending — used when a turn ends abnormally
// (stopped, errored, or reaped by the stream watchdog) so no spinner outlives
// it. Image phases that already carry a prompt survive: their picture lands
// via a background action even after the turn ends (see expectedStreamId).
export function settledPhases(
  phases: MessagePhase[] | undefined,
): MessagePhase[] | undefined {
  if (!phases) return undefined;
  const settled = phases.filter(
    (phase) =>
      !(
        (phase.kind === "search" ||
          phase.kind === "fetch" ||
          phase.kind === "thought" ||
          phase.kind === "calc" ||
          phase.kind === "weather" ||
          phase.kind === "mcp" ||
          phase.kind === "skill" ||
          phase.kind === "history" ||
          phase.kind === "integrationSuggestion" ||
          phase.kind === "question" ||
          phase.kind === "chart" ||
          phase.kind === "document" ||
          phase.kind === "html" ||
          (phase.kind === "image" && !phase.prompt)) &&
        phase.pending
      ),
  );
  return settled.length === phases.length ? phases : settled;
}

export const messageStatusValidator = v.union(
  v.literal("thinking"),
  v.literal("searching"),
  v.literal("streaming"),
  v.literal("complete"),
  v.literal("stopped"),
  v.literal("error"),
);

// "Pro" is a retired tier: no new sends use it, but old threads/messages still
// carry the key, so the validator must keep accepting it. The server folds it
// into Auto (resolveModelKey in convex/inference/billing.ts).
export const modelKeyValidator = v.union(
  v.literal("Auto"),
  v.literal("Fast"),
  v.literal("Basic"),
  v.literal("Pro"),
  v.literal("Max"),
  v.literal("Image"),
);

export const sendOptionsValidator = v.object({
  thinking: v.boolean(),
  search: v.boolean(),
  // A preset tier key OR an admin catalog model's OpenRouter slug (always
  // carries a "/", so the two can never collide). sendUserMessage resolves
  // the value against the catalog (resolveSendModel in convex/models.ts) —
  // anything unknown lands as Auto, never as an error.
  model: v.string(),
});

// What an admin-curated model can do, detected from OpenRouter's model
// listing when the model is saved in the console (convex/models.ts) — never
// hand-entered, so it can't drift from what the slug actually supports.
export const modelCapabilitiesValidator = v.object({
  // Accepts image input.
  vision: v.boolean(),
  // Accepts document/file input natively.
  files: v.boolean(),
  // Accepts audio input.
  audio: v.boolean(),
  // Supports the `reasoning` parameter (thinking).
  reasoning: v.boolean(),
  // Supports tool calling.
  tools: v.boolean(),
  // Can produce images.
  imageOutput: v.boolean(),
  // Largest context window across the model's live endpoints, in tokens.
  contextLength: v.number(),
});

// An integration the user tagged in their message (an @mention chip in the
// composer). `serverId` points at their install (an mcpServers row); `name` is
// snapshotted at send time so old messages keep their chip label even if the
// install is later renamed or removed.
export const integrationMentionValidator = v.object({
  serverId: v.id("mcpServers"),
  name: v.string(),
});

// A skill the user tagged in their message (an @mention chip in the
// composer). `installId` points at their install (a skillInstalls row);
// `name` is snapshotted at send time so old messages keep their chip label
// even if the skill is later renamed or uninstalled.
export const skillMentionValidator = v.object({
  installId: v.id("skillInstalls"),
  name: v.string(),
});

export const compactionStatusValidator = v.union(
  v.literal("idle"),
  v.literal("compacting"),
  v.literal("ready"),
);

export const compactionMarkerValidator = v.object({
  messageId: v.id("messages"),
  createdAt: v.number(),
});

// One compaction run's spend, logged so the usage page can attribute it.
export const compactionUsageValidator = v.object({
  cost: v.number(),
  createdAt: v.number(),
  // Portion of `cost` billed to the extra-usage bucket (see messages).
  extraCost: v.optional(v.number()),
});

// One home-screen conversation starter. `icon` is a key from the closed set in
// convex/suggestions/types.ts — validated on the way in (suggestions/parse.ts)
// and again on the way out (the client's Tabler registry), so an unknown key
// can never reach a glyph lookup.
export const homeSuggestionValidator = v.object({
  prompt: v.string(),
  icon: v.string(),
});

// --- Usage ledger ------------------------------------------------------------
// Every charge Whirl reports to Autumn is written down before it's sent (see
// convex/usageLedger.ts), so a slow or failing Autumn round trip postpones a
// charge instead of losing it.

// The Autumn features a charge can land on. The two metered ones carry USD;
// `messages` carries a free-tier message count.
export const usageChargeFeatureValidator = v.union(
  v.literal("ai_cost"),
  v.literal("search"),
  v.literal("messages"),
);

// `pending` is retried by the sweeper until it settles; `failed` has exhausted
// its attempts and needs a human. `settled` is money in the books.
export const usageChargeStatusValidator = v.union(
  v.literal("pending"),
  v.literal("settled"),
  v.literal("failed"),
);

// --- Locked threads ----------------------------------------------------------
// A locked thread's key material, exactly as the browser handed it over. The
// server stores this and understands none of it: it never sees the password,
// the recovery key, or the content key those two open. See
// apps/v2/lib/locked/crypto.ts for the format and why each piece is here.
export const threadLockValidator = v.object({
  version: v.number(),
  // base64url, per thread. Salts the password stretch AND the recovery-key
  // derivation, so it must never be rotated once a recovery key is printed.
  salt: v.string(),
  // PBKDF2 rounds this thread's password wrapping used. Stored rather than
  // assumed, so raising the cost for new threads leaves old ones openable.
  iterations: v.number(),
  // The content key wrapped under the password. "iv.ciphertext", base64url.
  passwordWrapped: v.string(),
  // The same content key wrapped under the printed recovery key.
  recoveryWrapped: v.string(),
});

// /kirkify: which daily budget paid for a run, and how the run ended.
// `refunded` means the provider never produced an image and the slot was
// handed back; a content refusal stays `failed` and keeps the slot.
export const kirkifyPoolValidator = v.union(
  v.literal("anonymous"),
  v.literal("account"),
  v.literal("paid"),
);
export const kirkifyRunStatusValidator = v.union(
  v.literal("running"),
  v.literal("done"),
  v.literal("failed"),
  v.literal("refunded"),
);
