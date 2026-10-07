"use client";

import { useState } from "react";
import {
  IconLayoutSidebarLeftCollapseFilled,
  IconLayoutSidebarLeftExpandFilled,
  IconPlus,
  IconSearch,
} from "@tabler/icons-react";

import { useIncognitoState } from "@whirl/lib/incognito";
import {
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
  useSidebar,
} from "@whirl/lib/sidebar";
import { useView } from "@whirl/lib/view";
import { DialogTrigger } from "@whirl/components/ui/dialog";
import { Separator } from "@whirl/components/ui/separator";
import { PageSlide } from "./page-slide";
import { SearchModal } from "./search-modal";
import { SettingsSidebar } from "./settings/settings-sidebar";
import { SidebarRow } from "./sidebar-row";
import { SyncIndicator } from "./sync-indicator";
import { SquishButton } from "./squish-button";
import { ThreadList } from "./thread-list";
import { UserButton } from "./user-button";
import { AgentsNav } from "./agents-nav";
import { SlatesHome } from "./slates-home";

/* Width rides `--sidebar-width` (painted pre-hydration by the layout script,
   driven live by useSidebar), so drags track 1:1 and the collapse toggle
   glides on this curve — the same one the main app's shell uses.
 *
 * `translate` and not `transform`: Tailwind v4 compiles the translate
 * utilities to the standalone translate property, so an arbitrary list
 * naming transform eases none of them. */
const GLIDE =
  "transition-[translate,width,padding,opacity,visibility] duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)]";

/* Owns the palette's open state so toggling it re-renders this row alone —
   not the whole sidebar, whose thread list is a heavy commit to drop right
   as the entrance animation starts. The row is a real DialogTrigger, so
   Base UI excludes it from outside-press dismissal and pressing it while
   open toggles closed instead of racing a close-then-reopen. */
function SearchRow() {
  const [open, setOpen] = useState(false);
  /* ⌘K stays dead while incognito — history is exactly what this mode
     isn't, and a palette hop would torch the ephemeral chat. */
  const { enabled: incognito } = useIncognitoState();
  return (
    <SearchModal
      open={open && !incognito}
      onOpenChange={(next) => setOpen(next && !incognito)}
      trigger={
        <DialogTrigger
          render={
            <SidebarRow
              icon={IconSearch}
              label="Search"
              className="before:-top-px before:-bottom-px"
            />
          }
        />
      }
    />
  );
}

/* The desktop rail, and only that. Phones get a tab bar and a History page
   instead (components/mobile/), because a 20rem drawer is this rail in a
   costume: it hides where you are and it costs a reach to a far corner to
   find out. Everything the drawer used to carry — the thread list, the
   palette, the account row — is the same component over there. */
export function Sidebar() {
  const {
    collapsed,
    width,
    resizing,
    toggleCollapsed,
    onResizePointerDown,
    onResizeDoubleClick,
  } = useSidebar();
  const { settingsOpen, openHome } = useView();
  /* Incognito tucks the whole rail away: width glides to a slim gutter
     (so the main pane keeps its 8px inset) while the contents fade, and
     `invisible` lands at the curve's end to drop it from the tab order.
     Nothing here unmounts — leaving glides it right back. */
  const { enabled: incognito } = useIncognitoState();

  return (
    /* An even 8px beat between blocks; New and the nav rows tighten onto
       one shared row pitch (the -mt on the nav below). `relative` is the
       resize handle's containing block — the rail used to be `fixed` for
       the drawer, which positioned the handle for free; as a plain flex
       item it would otherwise resolve against the viewport. */
    <aside
      id="app-sidebar"
      className={`group/sidebar relative hidden shrink-0 flex-col gap-2 pt-3 pb-2 md:flex ${
        /* Incognito tucks the rail away: width glides to a slim gutter (so
           the pane keeps its 8px inset) while the contents fade, and
           `invisible` lands at the curve's end to drop it from the tab
           order. Nothing unmounts — leaving glides it right back. */
        incognito
          ? "invisible w-2 overflow-hidden px-0 opacity-0"
          : "visible w-[var(--sidebar-width,16rem)] px-3 opacity-100"
      } ${resizing ? "" : GLIDE}`}
    >
      {/* Fixed height: the toggle sits in-flow expanded but absolute when
          collapsed, so without it the row (and everything below) would
          shift vertically between states. */}
      {/* Left-anchored at all times: the collapsed padding re-centers the
          logo on the rail, gliding on the width curve instead of the old
          instant justify-center jump. */}
      <div className="sidebar-glide relative flex h-7 items-center px-1.5 transition-[padding] sidebar-collapsed:pl-2.5">
        <SlatesHome className="transition-opacity duration-150 sidebar-collapsed:group-hover/sidebar:opacity-0" />
        <SyncIndicator />
        {/* Only surfaces while the pointer is over the sidebar; when
            collapsed it overlays the header and crossfades with the logo. */}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="ml-auto -mr-1.5 hidden size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-foreground-soft opacity-0 transition-[opacity,background-color] duration-150 group-hover/sidebar:opacity-100 hover:bg-accent focus-visible:opacity-100 sidebar-collapsed:absolute sidebar-collapsed:inset-0 sidebar-collapsed:m-auto md:flex"
        >
          {collapsed ? (
            <IconLayoutSidebarLeftExpandFilled size={18} />
          ) : (
            <IconLayoutSidebarLeftCollapseFilled size={18} />
          )}
        </button>
      </div>
      {/* The middle is a two-faced strip (chats vs settings) riding the
          page slide; the header above and user row below stay put as
          chrome, so opening settings only swipes the rows between them. */}
      <PageSlide
        page={settingsOpen ? 2 : 1}
        className="min-h-0 flex-1"
        pageClassName="flex flex-col gap-2"
        one={
          <>
            {/* Hit areas (the before: layers here and on the rows) reach the
                sidebar edges and split the gaps between neighbors, so clicks
                in the dead space still land. The label clips in an inner
                span — overflow-hidden on the button itself would clip the
                hit area. */}
            {/* Stays left-anchored: px-3 already dead-centers the icon on the
                40px rail, so the icon never moves — the label just fades as
                the sliding edge clips it. */}
            <SquishButton
              onClick={openHome}
              className="relative h-8 w-full py-0 before:absolute before:-inset-x-3 before:-top-1 before:-bottom-px"
            >
              <span className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap">
                <IconPlus size={16} stroke={2.5} className="shrink-0" />
                <span className="transition-[opacity,visibility] duration-150 sidebar-collapsed:invisible sidebar-collapsed:opacity-0">
                  New
                </span>
              </span>
            </SquishButton>
            {/* -mt pulls the nav onto the same pitch as the New pill: 2px
                seams all the way down, so a hovered row's pill stacks under
                New exactly like the rows stack under each other. */}
            <nav className="-mt-1.5 flex flex-col gap-0.5">
              <SearchRow />

            </nav>
            {/* w-auto: the base w-full ignores the mx inset and skews right. */}
            <Separator className="sidebar-glide mx-1.5 transition-[margin] data-horizontal:w-auto sidebar-collapsed:mx-0" />
            {/* The agent layer: the team, then every conversation with it. */}
            <AgentsNav />
            <Separator className="sidebar-glide mx-1.5 transition-[margin] data-horizontal:w-auto sidebar-collapsed:mx-0" />
            <ThreadList />
          </>
        }
        two={<SettingsSidebar />}
      />
      <UserButton />
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuenow={width}
        aria-valuemin={SIDEBAR_MIN_WIDTH}
        aria-valuemax={SIDEBAR_MAX_WIDTH}
        onPointerDown={onResizePointerDown}
        onDoubleClick={onResizeDoubleClick}
        /* z-10: the thread list and user button live in SkeletonReveal
           layers (z-2), which would otherwise sit over the handle and eat
           the pointer along their stretch of the edge. */
        className={`absolute inset-y-0 right-0 z-10 block w-1.5 cursor-col-resize touch-none transition-colors duration-150 sidebar-collapsed:hidden ${
          resizing ? "bg-foreground/15" : "hover:bg-foreground/10"
        }`}
      />
    </aside>
  );
}
