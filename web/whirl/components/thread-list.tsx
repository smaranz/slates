"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUser } from "@whirl/backend/auth";
import { useConvexAuth } from "@whirl/backend/react";
import { AnimatePresence } from "motion/react";

import { AnimatedItem } from "./animated-item";
import { endThreadDrag, getThreadDrag, useFolders } from "@whirl/lib/folders";
import {
  cachedFolderToSummary,
  cachedThreadToSummary,
  useThreadListSnapshot,
  type ThreadListSnapshot,
} from "@whirl/lib/thread-cache";
import { runMutation as run } from "@whirl/lib/toasts";
import {
  useFinishedThreadIds,
  useTrackFinishedThreads,
} from "@whirl/lib/thread-attention";
import { useKnownLockedIds } from "@whirl/lib/locked/locked-ids";
import { LOCKED_THREAD_TITLE } from "@whirl/lib/locked/thread-lock";
import { useView } from "@whirl/lib/view";
import {
  groupThreads,
  partitionThreadsByFolder,
  useRunningThreadIds,
  useThreadActions,
  useThreads,
} from "@whirl/lib/threads";
import { FolderSection } from "./folder-section";
import { ScrollFade, useScrollFades } from "./scroll-fade";
import { SkeletonReveal } from "./skeleton-reveal";
import { ThreadListSkeleton } from "./thread-list-skeleton";
import { ThreadRow } from "./thread-row";

/* The scrollable middle of the sidebar: folders first, then the loose
   threads under date markers (Pinned / Today / Yesterday / …). Hidden on
   the collapsed rail.

   On reload the last-known list (cached per user) paints as REAL rows —
   navigable immediately — and the live query replaces it silently in the
   background; threads that arrived since grow in through AnimatedItem.
   The skeleton only ever shows on a truly-first visit with nothing
   cached (plus the pre-hydration boot-script silhouette). */

/* Hits ThreadListSkeleton's generic-bones branch on cache-less loads. */
const EMPTY_SNAPSHOT: ThreadListSnapshot = { threads: [], folders: [] };

/* How many loose threads are in the DOM at a time. A long history used to
   mount every row it had — hundreds of buttons, each with a dropdown and a
   drag handler — and then reconcile the lot on every push from the
   listing. Rows past the window arrive as you scroll toward them. */
const PAGE_SIZE = 20;
/* Start fetching the next page while it's still this far below the fold, so
   the list is never visibly waiting for rows. */
const PAGE_AHEAD_PX = 400;
/* The open thread should be highlighted in the list it came from, so the
   window stretches to reach it — but only so far. Past this, a thread
   opened from search or a link is simply older than the sidebar goes, and
   dragging a thousand rows into the DOM to light one of them up is a worse
   trade than not lighting it up. */
const MAX_REACH_FOR_ACTIVE = 10 * PAGE_SIZE;

export function ThreadList({ onNavigate }: { onNavigate?: () => void }) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { user } = useUser();
  const threads = useThreads(isAuthenticated);
  const runningIds = useRunningThreadIds(isAuthenticated);
  const folders = useFolders(isAuthenticated);
  const threadActions = useThreadActions();
  const { snapshot, resolved } = useThreadListSnapshot(
    user?.id,
    threads,
    folders,
  );

  const knownLocked = useKnownLockedIds();
  const { threadId: activeThreadId } = useView();
  /* A spinner that stops while you're elsewhere leaves a tick behind. */
  useTrackFinishedThreads(runningIds, activeThreadId, isAuthenticated);
  const finishedIds = useFinishedThreadIds();
  const { scrollRef, onScroll, fades } = useScrollFades();
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const [unfileOver, setUnfileOver] = useState(false);
  /* The window carries the account it was counted for, so signing into
     another history starts at the top on its own. */
  const userId = user?.id;
  const [page, setPage] = useState({ userId, count: PAGE_SIZE });
  const visibleCount = page.userId === userId ? page.count : PAGE_SIZE;

  const attachScroller = useCallback(
    (el: HTMLDivElement | null) => {
      scrollerRef.current = el;
      scrollRef(el);
    },
    [scrollRef],
  );

  /* Takes the count actually on screen rather than reading state, so a
     window stretched to reach the open thread grows from where it is
     instead of climbing back up to it one page at a time. */
  const showMore = useCallback(
    (from: number) => setPage({ userId, count: from + PAGE_SIZE }),
    [userId],
  );

  /* Live data once it's in; the cached snapshot dressed as summaries
     until then. Same keys either way, so the background swap reconciles
     in place instead of remounting rows. */
  const display = useMemo(() => {
    if (threads && folders) return { threads, folders };
    if (!snapshot) return null;
    return {
      /* A snapshot taken before a thread was locked still holds its real
         title, and the sidebar paints from it a beat before the listing
         lands. The persisted locked set is written the moment a chat is
         locked, so it's the one thing here that can't be stale — a row it
         names wears the placeholder, whatever the snapshot remembers. */
      threads: snapshot.threads.map((cached) => {
        const summary = cachedThreadToSummary(cached);
        return knownLocked.has(cached.id)
          ? { ...summary, title: LOCKED_THREAD_TITLE, locked: true }
          : summary;
      }),
      folders: snapshot.folders.map(cachedFolderToSummary),
    };
  }, [threads, folders, snapshot, knownLocked]);

  const grouped = useMemo(() => {
    if (!display) return null;
    const { byFolder, loose } = partitionThreadsByFolder(
      display.threads,
      new Set(display.folders.map((folder) => folder.id)),
    );
    const activeIndex = activeThreadId
      ? loose.findIndex((thread) => thread.id === activeThreadId)
      : -1;
    const reach =
      activeIndex >= 0 && activeIndex < MAX_REACH_FOR_ACTIVE
        ? Math.ceil((activeIndex + 1) / PAGE_SIZE) * PAGE_SIZE
        : 0;
    const shown = Math.max(visibleCount, reach);
    return {
      byFolder,
      groups: groupThreads(loose.slice(0, shown)),
      shown,
      more: loose.length > shown,
    };
  }, [display, visibleCount, activeThreadId]);

  /* Re-armed on every page: re-observing reports straight away, so a window
     that still doesn't reach the fold keeps filling until it does. */
  const more = grouped?.more ?? false;
  const shown = grouped?.shown ?? PAGE_SIZE;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!more || !sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) showMore(shown);
      },
      {
        root: scrollerRef.current,
        rootMargin: `0px 0px ${PAGE_AHEAD_PX}px 0px`,
      },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [more, shown, showMore]);

  /* Nothing animates on the initial paint (cached or cold); anything
     mounting after it — new threads from the live sync, sends from other
     tabs — grows in. Rows past the first page are excepted: they only ever
     mount because you scrolled to them, and a list that pops as it fills
     reads as jank, not as life. */
  const revealedOnceRef = useRef(false);
  const freshIds: ReadonlySet<string> | null = revealedOnceRef.current
    ? null
    : new Set();
  useEffect(() => {
    if (display) revealedOnceRef.current = true;
  }, [display]);

  if (!isLoading && !isAuthenticated) return null;

  let rowIndex = 0;

  return (
    /* -mx-3/px-3: the scroller reaches the sidebar edges so its overflow
       clip doesn't cut off the rows' edge-to-edge hit layers. The whole
       area doubles as the "un-file" drop zone for folder threads —
       folders swallow their own drags before they bubble here. */
    <div
      /* invisible (not hidden) when collapsed: it fades under the sliding
         rail edge instead of vanishing a frame before the width moves, and
         visibility still drops it from the a11y tree and hit-testing. */
      className={`relative -mx-3 min-h-0 flex-1 rounded-lg transition-[background-color,opacity,visibility] duration-150 sidebar-collapsed:invisible sidebar-collapsed:opacity-0 ${
        unfileOver ? "bg-black/[0.04] dark:bg-white/[0.04]" : ""
      }`}
      onDragOver={(event) => {
        const drag = getThreadDrag();
        if (!drag?.folderId) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setUnfileOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setUnfileOver(false);
        }
      }}
      onDrop={(event) => {
        const drag = getThreadDrag();
        if (!drag?.folderId) return;
        event.preventDefault();
        setUnfileOver(false);
        endThreadDrag();
        run(threadActions.setFolder(drag.threadId, null));
      }}
    >
      {/* Keyed on `resolved`: the post-resolve instance mounts already
          revealed when a snapshot exists, so cached rows paint on the
          first frame with no skeleton and no cross-fade. Cold loads keep
          the pulsing bones + reveal. */}
      <SkeletonReveal
        key={resolved ? "resolved" : "boot"}
        revealed={Boolean(grouped)}
        skeleton={
          <ThreadListSkeleton snapshot={resolved ? EMPTY_SNAPSHOT : null} />
        }
        className="h-full [--pulse-count:infinite]"
      >
        {grouped && display && (
          <div
            ref={attachScroller}
            onScroll={onScroll}
            className="h-full overflow-y-auto px-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            <div className="flex flex-col gap-2">
              {display.folders.length > 0 && (
                <FolderSection
                  folders={display.folders}
                  byFolder={grouped.byFolder}
                  freshIds={freshIds}
                  runningIds={runningIds}
                  finishedIds={finishedIds}
                  onNavigate={onNavigate}
                />
              )}
              <AnimatePresence>
                {grouped.groups.map(([label, items]) => (
                  <AnimatedItem
                    key={label}
                    enter={
                      freshIds
                        ? items.every((thread) => freshIds.has(thread.id))
                        : true
                    }
                  >
                    <section>
                      {/* Deliberately whisper-quiet — these are markers,
                          not rows, and must never read as threads. */}
                      <div className="flex h-5 items-center px-2.5 text-[10.5px]/4 font-medium text-muted-foreground/55">
                        {label}
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <AnimatePresence>
                          {items.map((thread) => {
                            const paged = rowIndex++ >= PAGE_SIZE;
                            return (
                              <AnimatedItem
                                key={thread.id}
                                enter={
                                  freshIds
                                    ? freshIds.has(thread.id)
                                    : !paged
                                }
                              >
                                <ThreadRow
                                  thread={thread}
                                  folders={display.folders}
                                  running={runningIds.has(thread.id)}
                                  finished={finishedIds.has(thread.id)}
                                  onNavigate={onNavigate}
                                />
                              </AnimatedItem>
                            );
                          })}
                        </AnimatePresence>
                      </div>
                    </section>
                  </AnimatedItem>
                ))}
              </AnimatePresence>
              {/* Tripwire for the next page — it has no height of its own,
                  so an exhausted list ends exactly where its last row does. */}
              <div ref={sentinelRef} aria-hidden />
            </div>
          </div>
        )}
      </SkeletonReveal>
      <ScrollFade side="top" visible={fades.top} />
      <ScrollFade side="bottom" visible={fades.bottom} />
    </div>
  );
}
