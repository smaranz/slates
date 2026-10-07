"use client";

import { useState } from "react";
import { IconPencilPlus, IconSearch } from "@tabler/icons-react";
import { useConvexAuth } from "@whirl/backend/react";

import { DialogTrigger } from "@whirl/components/ui/dialog";
import { SearchModal } from "@whirl/components/search-modal";
import { ThreadList } from "@whirl/components/thread-list";
import { UserButton } from "@whirl/components/user-button";
import { useView } from "@whirl/lib/view";

/* The rail, as a page.
 *
 * Taking the drawer away on phones took the thread list, the palette and the
 * account row with it, so this puts all three back where a thumb can reach
 * them: the History tab. It is the same ThreadList, SearchModal and
 * UserButton the desktop rail builds itself out of — nothing here is a
 * second copy of anything, only a different arrangement of it.
 *
 * Rendered at any width (it rides the shell's away face like settings and
 * the store do), so a deep link to /history on a desktop gets a real page
 * rather than a broken one. Nothing routes there from a desktop, because
 * the rail is already showing this. */
export function HistoryView() {
  const { openHome } = useView();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const signedOut = !isLoading && !isAuthenticated;
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex min-h-0 flex-1 flex-col px-3 pt-[max(1rem,env(safe-area-inset-top))]">
      <header className="mb-2 flex shrink-0 items-center gap-1 px-1.5">
        <h1 className="mr-auto text-xl font-semibold tracking-tight">Chats</h1>
        <SearchModal
          open={searchOpen}
          onOpenChange={setSearchOpen}
          trigger={
            <DialogTrigger
              render={
                <button
                  type="button"
                  aria-label="Search chats"
                  className="flex size-10 cursor-pointer items-center justify-center rounded-full text-foreground-soft transition-[background-color,scale] duration-150 active:scale-[0.94] active:bg-accent-pressed"
                >
                  <IconSearch size={20} stroke={2} />
                </button>
              }
            />
          }
        />
        <button
          type="button"
          aria-label="New chat"
          onClick={openHome}
          className="flex size-10 cursor-pointer items-center justify-center rounded-full text-foreground-soft transition-[background-color,scale] duration-150 active:scale-[0.94] active:bg-accent-pressed"
        >
          <IconPencilPlus size={20} stroke={2} />
        </button>
      </header>
      {/* Claims the middle whatever is in it. ThreadList renders nothing at
          all when signed out, and without a column of its own to fill, the
          account row below would ride up under the header.

          Opening a chat leaves this page for the chat tab, so the list's own
          onNavigate has nothing to close — the route change is the
          navigation. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {signedOut ? (
          <p className="mt-10 px-1.5 text-center text-[13.5px]/5 text-muted-foreground">
            Your chats show up here once you&rsquo;re signed in.
          </p>
        ) : (
          <ThreadList />
        )}
      </div>
      <UserButton />
    </div>
  );
}
