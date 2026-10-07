"use client";

import { useEffect, useState } from "react";
import {
  IconChevronRight,
  IconDots,
  IconFolderFilled,
  IconPencil,
  IconTrash,
} from "@tabler/icons-react";
import { AnimatePresence } from "motion/react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@whirl/components/ui/dropdown-menu";
import {
  endThreadDrag,
  getThreadDrag,
  persistCollapsedFolders,
  readCollapsedFolders,
  useFolderActions,
  type FolderSummary,
} from "@whirl/lib/folders";
import { runMutation as run } from "@whirl/lib/toasts";
import { useThreadActions, type ThreadSummary } from "@whirl/lib/threads";
import { AnimatedItem } from "./animated-item";
import { ConfirmDialog } from "./confirm-dialog";
import { RenameDialog } from "./rename-dialog";
import { RowPill } from "./row-pill";
import { ThreadRow } from "./thread-row";

/* How long a folder's rows stay mounted after it collapses — just past the
   200ms collapse, so the contents don't vanish mid-animation. */
const RELEASE_DELAY_MS = 260;

function FolderRow({
  folder,
  threads,
  folders,
  freshIds,
  runningIds,
  finishedIds,
  open,
  onToggle,
  onNavigate,
}: {
  folder: FolderSummary;
  threads: ThreadSummary[];
  folders: FolderSummary[];
  freshIds: ReadonlySet<string> | null;
  runningIds: ReadonlySet<string>;
  finishedIds: ReadonlySet<string>;
  open: boolean;
  onToggle: () => void;
  onNavigate?: () => void;
}) {
  const folderActions = useFolderActions();
  const threadActions = useThreadActions();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  /* A collapsed folder used to keep every row it held in the DOM behind a
     0fr grid track — invisible, still reconciled on every push, and there
     is no cap on how many threads someone files away. They mount with the
     folder now and are released a beat after it closes.

     `settled` is what keeps the open from looking like a stampede: rows
     appearing because the folder opened must not each play their own grow-in
     under the disclosure, so entrances only arm once it has finished. */
  const [mounted, setMounted] = useState(open);
  const [settled, setSettled] = useState(open);
  if (open && !mounted) setMounted(true);
  if (!open && settled) setSettled(false);
  useEffect(() => {
    const timer = setTimeout(
      () => (open ? setSettled(true) : setMounted(false)),
      RELEASE_DELAY_MS,
    );
    return () => clearTimeout(timer);
  }, [open]);

  return (
    /* The whole block (header + contents) accepts thread drops. Thread
       drags are swallowed here (stopPropagation) so the list's un-file
       zone underneath never fights over them — including drops back onto
       the thread's own folder, which are no-ops. */
    <div
      className={`rounded-lg transition-[background-color,box-shadow] duration-150 ${
        dragOver
          ? "bg-black/[0.04] ring-1 ring-ring ring-inset dark:bg-white/[0.04]"
          : ""
      }`}
      onDragOver={(event) => {
        const drag = getThreadDrag();
        if (!drag) return;
        event.stopPropagation();
        if (drag.folderId === folder.id) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDragOver(false);
        }
      }}
      onDrop={(event) => {
        const drag = getThreadDrag();
        if (!drag) return;
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        endThreadDrag();
        if (drag.folderId !== folder.id) {
          run(threadActions.setFolder(drag.threadId, folder.id));
        }
      }}
    >
      <div
        className="group/row group/folder relative"
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuOpen(true);
        }}
      >
        <button
          type="button"
          onClick={onToggle}
          className="relative flex h-8 w-full cursor-pointer items-center gap-1.5 rounded-lg pr-8 pl-1.5 text-[13.5px]/4 font-medium text-foreground-soft before:absolute before:-inset-x-3 before:-inset-y-px"
        >
          <RowPill className="group-has-data-popup-open/folder:bg-accent" />
          <IconChevronRight
            size={14}
            className={`relative shrink-0 transition-[rotate] duration-150 ${
              open ? "rotate-90" : ""
            }`}
          />
          <IconFolderFilled size={15} className="relative shrink-0" />
          <span className="relative min-w-0 flex-1 truncate text-left">
            {folder.name}
          </span>
        </button>

        <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-foreground-soft transition-opacity duration-150 group-hover/folder:opacity-0 group-has-data-popup-open/folder:opacity-0 coarse:opacity-0">
          {threads.length}
        </span>

        <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={`Actions for ${folder.name}`}
            className="absolute top-1/2 right-1 flex size-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-foreground-soft opacity-0 transition-opacity duration-150 group-hover/folder:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100 coarse:opacity-100"
          >
            <IconDots size={16} />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" sideOffset={4} className="w-44 p-1">
            <DropdownMenuItem
              className="gap-2 px-2 py-1.5"
              onClick={() => setRenameOpen(true)}
            >
              <IconPencil size={15} className="text-muted-foreground" />
              Rename
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="gap-2 px-2 py-1.5"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <IconTrash size={15} />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* 0fr ↔ 1fr grid animation: height auto without measuring. */}
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div className="flex flex-col gap-0.5 pl-2">
            {!mounted ? null : threads.length === 0 ? (
              <span className="flex h-8 items-center px-2.5 text-[13.5px]/4 text-muted-foreground">
                Nothing in here yet
              </span>
            ) : (
              <AnimatePresence>
                {threads.map((thread) => (
                  <AnimatedItem
                    key={thread.id}
                    enter={freshIds ? freshIds.has(thread.id) : settled}
                  >
                    <ThreadRow
                      thread={thread}
                      folders={folders}
                      running={runningIds.has(thread.id)}
                      finished={finishedIds.has(thread.id)}
                      onNavigate={onNavigate}
                    />
                  </AnimatedItem>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>

      <RenameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename folder"
        placeholder="Folder name"
        initialValue={folder.name}
        onSubmit={(name) => run(folderActions.rename(folder.id, name))}
      />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Delete folder?"
        message={`Chats inside "${folder.name}" won't be deleted — they'll move back to your history.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => run(folderActions.remove(folder.id))}
      />
    </div>
  );
}

/* The folder block above the date groups. Collapse state is local to the
   browser (same key as the main app), seeded lazily at mount — this only
   ever mounts client-side once live data lands (it's gated on Convex
   data, so it never SSRs), and syncing the stored state in an effect
   instead would paint stored-collapsed folders open for a frame and then
   visibly animate them shut. */
export function FolderSection({
  folders,
  byFolder,
  freshIds,
  runningIds,
  finishedIds,
  onNavigate,
}: {
  folders: FolderSummary[];
  byFolder: Map<string, ThreadSummary[]>;
  freshIds: ReadonlySet<string> | null;
  runningIds: ReadonlySet<string>;
  /** Replies that landed while another view was up (lib/thread-attention.ts). */
  finishedIds: ReadonlySet<string>;
  onNavigate?: () => void;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(readCollapsedFolders);

  const toggle = (folderId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      persistCollapsedFolders(next);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-0.5">
      <AnimatePresence>
        {folders.map((folder) => (
          <AnimatedItem
            key={folder.id}
            enter={freshIds ? freshIds.has(folder.id) : true}
          >
            <FolderRow
              folder={folder}
              threads={byFolder.get(folder.id) ?? []}
              folders={folders}
              freshIds={freshIds}
              runningIds={runningIds}
              finishedIds={finishedIds}
              open={!collapsed.has(folder.id)}
              onToggle={() => toggle(folder.id)}
              onNavigate={onNavigate}
            />
          </AnimatedItem>
        ))}
      </AnimatePresence>
    </div>
  );
}
