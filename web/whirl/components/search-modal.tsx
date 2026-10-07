"use client";

import { BASE_PATH } from "@whirl/lib/view";

import {
  memo,
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  IconLoader2,
  IconMessageCircleFilled,
  IconSearch,
} from "@tabler/icons-react";
import { useConvexAuth, useQuery } from "@whirl/backend/react";
import { motion } from "motion/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { Dialog, DialogContent } from "@whirl/components/ui/dialog";
import { useFolders } from "@whirl/lib/folders";
import { pinRasterPath } from "@whirl/lib/motion";
import { useOpenedTitles } from "@whirl/lib/locked/thread-lock";
import { MASK_TEXT } from "@whirl/lib/replay-guard";
import { cn } from "@whirl/lib/utils";
import { groupThreads, useThreads, type ThreadSummary } from "@whirl/lib/threads";

const MAX_RESULTS = 50;

/* How much of the library the first render mounts. The scroller folds at
   max-h-80 (~9 rows), so this covers the fold with headroom — the rest
   streams in through a transition as soon as threads land. */
const FIRST_PAINT_ROWS = 30;

/* How long the user has to sit still before the deep (full-text) search
   kicks in behind the instant title filter. */
const DEEP_SEARCH_DELAY_MS = 450;

/* How long after closing before the palette lets go of its state — past
   the dialog's ~100ms exit, so the results never visibly swap back to the
   library mid-fade. */
const CLOSE_RESET_DELAY_MS = 200;

/* Entrance for the deep-search area: a soft rise-and-fade on mount only.
   Exits stay instant — this stuff unmounts on every keystroke, and
   lingering fade-outs there read as flicker. */
const POP_IN = {
  initial: { opacity: 0, y: 5 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.2, ease: [0.22, 0.61, 0.36, 1] as const },
  transformTemplate: pinRasterPath,
};

/* One result row. Memoized so hover and arrow-key moves only re-render the
   two rows whose highlight changed, and content-visibility lets the browser
   skip layout and paint below the fold (rows are exactly h-9, so the 36px
   intrinsic size keeps the scrollbar honest). Deep hits carry an excerpt;
   title hits may carry a folder name. */
const ResultRow = memo(function ResultRow({
  thread,
  title,
  index,
  active,
  folderName,
  excerpt,
  onHover,
  onSelect,
}: {
  thread: ThreadSummary;
  /** What to call it — the row's opened name when it's a locked chat this
   *  tab has the key for, otherwise the thread's own title. */
  title: string;
  index: number;
  active: boolean;
  folderName?: string;
  excerpt?: string;
  onHover: (index: number) => void;
  onSelect: (thread: ThreadSummary) => void;
}) {
  return (
    <button
      type="button"
      data-index={index}
      onClick={() => onSelect(thread)}
      onMouseEnter={() => onHover(index)}
      className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-lg px-2.5 text-[13.5px]/4 [contain-intrinsic-size:auto_36px] [content-visibility:auto] ${
        active ? "bg-accent text-accent-foreground" : ""
      }`}
    >
      <IconMessageCircleFilled
        size={15}
        className="shrink-0 text-muted-foreground"
      />
      {excerpt !== undefined ? (
        <>
          <span className={cn("max-w-[50%] shrink-0 truncate text-left", MASK_TEXT)}>
            {title}
          </span>
          {/* Lifted verbatim out of a message body. */}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-left text-xs text-muted-foreground",
              MASK_TEXT,
            )}
          >
            {excerpt}
          </span>
        </>
      ) : (
        <>
          <span className={cn("min-w-0 flex-1 truncate text-left", MASK_TEXT)}>
            {title}
          </span>
          {folderName && (
            <span className="shrink-0 text-xs text-muted-foreground">
              {folderName}
            </span>
          )}
        </>
      )}
    </button>
  );
});

function SearchingDeeper() {
  return (
    <>
      <IconLoader2 size={15} className="shrink-0 animate-spin text-muted-foreground" />
      <span className="text-shimmer text-[13.5px]/4">
        Searching deeper…
      </span>
    </>
  );
}

/* Command-palette style thread search. The body height morphs to fit the
   results: a ResizeObserver measures the (max-h capped) scroller and the
   motion wrapper animates toward it, so shrinking result sets pull the
   modal up instead of snapping. */
export function SearchModal({
  open,
  onOpenChange,
  trigger,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /* Rendered inside the Dialog root (wrap it in <DialogTrigger render={…}>)
     so Base UI treats it as the palette's own trigger: pressing it while
     open toggles closed instead of racing outside-press dismissal. */
  trigger?: ReactNode;
}) {
  const { isAuthenticated } = useConvexAuth();
  const threads = useThreads(isAuthenticated);
  /* Real names for the locked chats this tab has open — used for matching
     and for the row label, so the two can't disagree. */
  const openedTitles = useOpenedTitles(threads);
  const folders = useFolders(isAuthenticated);

  const [value, setValue] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  /* The debounced query the deep (full-text) pass actually searches for. */
  const [deepQuery, setDeepQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  /* ⌘K / Ctrl+K from anywhere. */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  /* Fresh slate per open; focus is Base UI's job via initialFocus. */
  useEffect(() => {
    if (!open) return;
    setValue("");
    setActiveIndex(0);
    setDeepQuery("");
  }, [open]);

  /* And a fresh slate again once the close settles. This is load-bearing,
     not tidiness: the palette stays mounted for the session, so a query
     left in `deepQuery` kept a live full-text search subscription re-running
     on every message write until the next open. Delayed past the exit so
     the content doesn't visibly swap under the fade. */
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => {
      setValue("");
      setActiveIndex(0);
      setDeepQuery("");
    }, CLOSE_RESET_DELAY_MS);
    return () => clearTimeout(id);
  }, [open]);

  const query = value.trim().toLowerCase();

  /* The list is kept mounted (hidden) behind the dialog, so the
     above-the-fold slice renders off the interaction path and opening is
     just the entrance animation. But only that slice: the full library
     streams in through a transition per open and lets go again after the
     close settles. It used to latch for the session, which left every
     thread ever listed as hidden DOM — reconciled on every thread-list
     push, i.e. continuously while replies stream — from the first load on. */
  const [fullLibrary, setFullLibrary] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (threads && !fullLibrary) startTransition(() => setFullLibrary(true));
  }, [open, threads, fullLibrary]);
  /* Keyed on `open` alone — a thread-list push while closed must not
     re-arm the timer and hold the library in the DOM through a long
     streaming stretch. */
  useEffect(() => {
    if (open) return;
    const id = setTimeout(() => setFullLibrary(false), CLOSE_RESET_DELAY_MS);
    return () => clearTimeout(id);
  }, [open]);

  const groups = useMemo((): Array<[string, ThreadSummary[]]> => {
    if (!threads) return [];
    /* No query: the full library, grouped like the sidebar, free to
       scroll (trimmed to the fold until the stream-in lands). Queries cap
       at MAX_RESULTS to keep filtering instant. */
    if (!query) {
      return groupThreads(
        fullLibrary ? threads : threads.slice(0, FIRST_PAINT_ROWS),
      );
    }
    const matches = threads
      /* A locked chat this tab has open shows its real name in the sidebar,
         so it has to answer to that name here too. One still locked keeps
         its placeholder, which is the honest answer — without the key
         there's nothing to match against. */
      .filter((thread) =>
        (openedTitles.get(thread.id) ?? thread.title)
          .toLowerCase()
          .includes(query),
      )
      .slice(0, MAX_RESULTS);
    return groupThreads(matches);
  }, [threads, query, fullLibrary, openedTitles]);

  const titleFlat = useMemo(
    () => groups.flatMap(([, items]) => items),
    [groups],
  );
  const folderNames = useMemo(
    () => new Map((folders ?? []).map((folder) => [folder.id, folder.name])),
    [folders],
  );

  useEffect(() => setActiveIndex(0), [query]);

  /* Deep pass: once the query has sat unchanged for a beat, run the
     full-text search over message content. While the user keeps typing,
     deepQuery lags behind `query`, which doubles as the "stale results —
     don't show them" signal. */
  useEffect(() => {
    if (!query) {
      setDeepQuery("");
      return;
    }
    const id = setTimeout(() => setDeepQuery(query), DEEP_SEARCH_DELAY_MS);
    return () => clearTimeout(id);
  }, [query]);

  const deepHits = useQuery(
    api.historySearch.deepSearch,
    isAuthenticated && deepQuery ? { query: deepQuery } : "skip",
  );
  const deepSettled = Boolean(query) && deepQuery === query && deepHits !== undefined;

  /* Deep hits arrive as thread ids — resolve them against the loaded list
     (which already hides deleted/pending-delete threads) and drop anything
     the title filter is showing. */
  const deepMatches = useMemo(() => {
    if (!deepSettled || !threads || !deepHits) return [];
    const shownIds = new Set(titleFlat.map((thread) => thread.id));
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const matches: Array<{ thread: ThreadSummary; excerpt: string }> = [];
    for (const hit of deepHits) {
      if (shownIds.has(hit.threadId)) continue;
      const thread = byId.get(hit.threadId);
      if (thread) matches.push({ thread, excerpt: hit.excerpt });
    }
    return matches;
  }, [deepSettled, threads, deepHits, titleFlat]);

  /* Title matches first, deep matches after — one list for the keyboard. */
  const flat = useMemo(
    () => [...titleFlat, ...deepMatches.map((match) => match.thread)],
    [titleFlat, deepMatches],
  );

  /* A deep pass is owed for what's in the input — true through the
     debounce AND the in-flight query. The notice element lives across the
     whole stretch: remounting it restarts the CSS shimmer, which reads as
     the animation "resetting" every time the search kicks in. */
  const deepOutstanding = Boolean(query) && !deepSettled;

  /* When the notice appears: straight away when titles came up empty (it
     owns the empty-state slot), otherwise only once the pause elapses —
     and sticky from then on, so continued typing restyles it instead of
     blinking it out and back. */
  const [deepNoticeSticky, setDeepNoticeSticky] = useState(false);
  const showDeepNotice =
    deepOutstanding &&
    (titleFlat.length === 0 || deepQuery === query || deepNoticeSticky);
  useEffect(() => setDeepNoticeSticky(showDeepNotice), [showDeepNotice]);

  const select = useCallback(
    (thread: ThreadSummary | undefined) => {
      if (!thread) return;
      onOpenChange(false);
      window.history.pushState(null, "", `${BASE_PATH}/thread/${thread.id}`);
    },
    [onOpenChange],
  );

  /* Height morph plumbing. The observer attaches through a callback ref —
     the popup portals in a beat after `open` flips, so an open-keyed
     effect would look before the node exists and never observe. */
  const [bodyEl, setBodyEl] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | "auto">("auto");
  useEffect(() => {
    if (!bodyEl) return;
    const observer = new ResizeObserver(() => {
      /* The kept-mounted popup measures 0 while hidden — swallowing that
         reading keeps the next open from springing up from zero. */
      const next = bodyEl.offsetHeight;
      if (next > 0) setHeight(next);
    });
    observer.observe(bodyEl);
    return () => observer.disconnect();
  }, [bodyEl]);

  /* Don't reopen at a stale height from the previous search. */
  useEffect(() => {
    if (!open) setHeight("auto");
  }, [open]);

  /* Keep the keyboard highlight on screen as it walks past the fold. */
  useEffect(() => {
    bodyEl
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [bodyEl, activeIndex]);

  let rowIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange} modal="trap-focus">
      {trigger}
      {/* Same frost recipe as the menus, but with the app's standard scrim
          behind it — the frosted dim pulls focus off the page (link-gate
          recipe) while trap-focus above keeps scroll free. The translucent
          popover var is hand-mixed (bg-popover/55 dies in the build) over a
          light backdrop blur. */}
      <DialogContent
        aria-label="Search threads"
        keepMounted
        backdropClassName="backdrop-blur-xs"
        initialFocus={inputRef}
        className="top-[16vh] max-w-xl bg-(--popover-translucent) p-0 backdrop-blur-xs duration-100"
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-4">
          <IconSearch size={16} className="shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setActiveIndex((index) => Math.min(index + 1, flat.length - 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setActiveIndex((index) => Math.max(index - 1, 0));
              } else if (event.key === "Enter") {
                event.preventDefault();
                select(flat[activeIndex]);
              }
            }}
            placeholder="Search threads…"
            className="h-full min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          <kbd className="shrink-0 rounded-md px-1.5 py-0.5 text-xs text-muted-foreground ring-1 ring-border">
            Esc
          </kbd>
        </div>

        {/* The container spring is the only animation here — content swaps
            instantly (palette-style; per-item fades read as flicker) and a
            spring keeps momentum across per-keystroke retargets. */}
        <motion.div
          initial={false}
          animate={{ height }}
          transition={{ type: "spring", stiffness: 700, damping: 50, mass: 0.6 }}
          className="overflow-hidden"
        >
          <div
            ref={setBodyEl}
            className="max-h-80 overflow-y-auto p-1.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {flat.length === 0 && !showDeepNotice ? (
              <div className="flex h-16 items-center justify-center text-sm text-muted-foreground">
                {!threads
                  ? "Loading…"
                  : query
                    ? `No chats match "${value.trim()}"`
                    : "No chats yet"}
              </div>
            ) : (
              <>
              {groups.map(([label, items]) => (
                <section key={label}>
                  <div className="flex h-7 items-end px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                    {label}
                  </div>
                  {items.map((thread) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    return (
                      <ResultRow
                        key={thread.id}
                        thread={thread}
                        title={openedTitles.get(thread.id) ?? thread.title}
                        index={index}
                        active={index === activeIndex}
                        folderName={
                          thread.folderId
                            ? folderNames.get(thread.folderId)
                            : undefined
                        }
                        onHover={setActiveIndex}
                        onSelect={select}
                      />
                    );
                  })}
                </section>
              ))}

              {/* Deep results: threads whose messages (not titles) matched,
                  each with a glimpse of the line that did it. */}
              {deepMatches.length > 0 && (
                <motion.section {...POP_IN}>
                  <div className="flex h-7 items-end px-2.5 pb-1 text-xs font-medium text-muted-foreground">
                    Found in messages
                  </div>
                  {deepMatches.map(({ thread, excerpt }) => {
                    rowIndex += 1;
                    const index = rowIndex;
                    return (
                      <ResultRow
                        key={thread.id}
                        thread={thread}
                        title={openedTitles.get(thread.id) ?? thread.title}
                        index={index}
                        active={index === activeIndex}
                        excerpt={excerpt}
                        onHover={setActiveIndex}
                        onSelect={select}
                      />
                    );
                  })}
                </motion.section>
              )}
              </>
            )}

            {/* One persistent notice for the whole deep lifecycle. It
                restyles between the centered empty slot and a row under
                the results — same element either way, so the shimmer
                sweeps on uninterrupted instead of resetting on remount. */}
            {showDeepNotice && (
              <motion.div
                {...POP_IN}
                className={
                  flat.length === 0
                    ? "flex h-16 items-center justify-center gap-2.5"
                    : "flex h-9 items-center gap-2.5 px-2.5"
                }
              >
                <SearchingDeeper />
              </motion.div>
            )}
          </div>
        </motion.div>
      </DialogContent>
    </Dialog>
  );
}
