"use client";

import { useClerk, useUser } from "@whirl/backend/auth";
import Link from "next/link";
import {
  IconCreditCardFilled,
  IconDeviceDesktopFilled,
  IconLifebuoyFilled,
  IconLogout,
  IconMoonFilled,
  IconSettingsFilled,
  IconSunFilled,
} from "@tabler/icons-react";
import { useCustomer } from "@whirl/backend/billing";

import {
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "@whirl/components/ui/dropdown-menu";
import { Skeleton } from "@whirl/components/ui/skeleton";
import { formatFreeMessagesLeft, formatResetsIn } from "@whirl/lib/plan";
import { useCachedUsage } from "@whirl/lib/usage-cache";
import { resetSupport } from "@whirl/lib/support";
import { useTheme, type Theme } from "@whirl/lib/theme";
import { useView } from "@whirl/lib/view";
import { PlanBadge } from "./plan-badge";
import { UsageMeter } from "./usage-meter";

/* Compact, Cursor-ish rows: tight vertical rhythm, muted icons that
   brighten on focus (the base item styles handle the brighten). */
const ITEM = "gap-2 px-2 py-1.5";

/* Radio items reserve right padding for the absolutely-positioned check
   indicator — overriding it with px would run the label under the check. */
const RADIO_ITEM = "gap-2 py-1.5 pr-8 pl-2";

/* On the icon itself (not a descendant selector) so the item's
   focus:**:text-accent-foreground rule still wins on hover. */
const ICON = "text-muted-foreground";

function UsageBlock() {
  const { user } = useUser();
  const { customer, isLoading, error } = useCustomer();
  /* Cached summary paints instantly on repeat opens; the skeleton only
     shows on a first-ever open. Errored fetches (the pre-auth window)
     read as unsettled, so the cache holds instead of a false "Free". */
  const usage = useCachedUsage(user?.id, customer, isLoading || error != null);

  if (!usage) {
    return (
      <div className="px-2 pt-1.5 pb-2">
        <div className="flex items-center justify-between">
          <Skeleton className="h-3.5 w-12" />
          <Skeleton className="h-3 w-10" />
        </div>
        <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
        <div className="mt-1.5 flex items-center justify-between">
          <Skeleton className="h-2.5 w-20" />
          <Skeleton className="h-2.5 w-8" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-2 pt-1.5 pb-2">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm font-medium">Usage</span>
        {usage.planId ? (
          <PlanBadge plan={usage.planId} className="h-3 w-auto" />
        ) : (
          <span className="text-xs text-muted-foreground">
            {usage.planName}
          </span>
        )}
      </div>
      {usage.freeMessages ? (
        <>
          <UsageMeter remainingPct={usage.remainingPct} className="mt-2" />
          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">
              {usage.nextResetAt
                ? `Resets in ${formatResetsIn(usage.nextResetAt)}`
                : "This period"}
            </span>
            <span className="shrink-0 font-medium whitespace-nowrap text-foreground">
              {formatFreeMessagesLeft(usage.freeMessages, { compact: true })}
            </span>
          </div>
        </>
      ) : usage.unlimited ? (
        <div className="mt-1 text-xs text-muted-foreground">
          Unlimited messages
        </div>
      ) : (
        <>
          <UsageMeter remainingPct={usage.remainingPct} className="mt-2" />
          <div className="mt-1.5 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span className="truncate">
              {usage.nextResetAt
                ? `Resets in ${formatResetsIn(usage.nextResetAt)}`
                : "This period"}
            </span>
            <span className="shrink-0 font-medium tabular-nums whitespace-nowrap text-foreground">
              {Math.round(usage.remainingPct)}% left
            </span>
          </div>
        </>
      )}
    </div>
  );
}

export function UserMenuContent({
  billing = true,
  onSupport,
}: {
  /** False on a deployment without billing: no usage, no plans. */
  billing?: boolean;
  /** Absent when the deployment has no support agent. */
  onSupport?: () => void;
}) {
  const { theme, setTheme } = useTheme();
  const { openSettings } = useView();

  return (
    /* Solid on purpose — the user menu is the one popover that stays
       opaque. Width tracks the pill it anchors to (stableContentWidth's
       fixed w-56 left a growing right-side gap on wider sidebars, since
       the popup aligns to the pill's left edge); min-w-56 is the floor
       for the collapsed rail's tiny anchor. */
    <DropdownMenuContent
      side="top"
      sideOffset={8}
      className="w-(--anchor-width) min-w-56 bg-popover p-1 backdrop-blur-none"
    >
      {billing && (
        <>
          <UsageBlock />
          <DropdownMenuSeparator />
        </>
      )}

      <DropdownMenuSub>
        <DropdownMenuSubTrigger className={ITEM}>
          <IconMoonFilled size={15} className={ICON} />
          Theme
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent className="p-1">
          <DropdownMenuRadioGroup
            value={theme}
            onValueChange={(value) => setTheme(value as Theme)}
          >
            <DropdownMenuRadioItem value="light" className={RADIO_ITEM}>
              <IconSunFilled size={15} className={ICON} />
              Light
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark" className={RADIO_ITEM}>
              <IconMoonFilled size={15} className={ICON} />
              Dark
            </DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system" className={RADIO_ITEM}>
              <IconDeviceDesktopFilled size={15} className={ICON} />
              System
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      {onSupport && (
        <DropdownMenuItem className={ITEM} onClick={onSupport}>
          <IconLifebuoyFilled size={15} className={ICON} />
          Support
        </DropdownMenuItem>
      )}
      {billing && (
        <DropdownMenuItem render={<Link href="/pricing" />} className={ITEM}>
          <IconCreditCardFilled size={15} className={ICON} />
          Plans & pricing
        </DropdownMenuItem>
      )}
      <DropdownMenuItem className={ITEM} onClick={() => openSettings()}>
        <IconSettingsFilled size={15} className={ICON} />
        Settings
      </DropdownMenuItem>

      <DropdownMenuSeparator />

      {/* No accounts to leave in Slates — the way out is back to the launcher. */}
      <DropdownMenuItem
        className={ITEM}
        onClick={() => {
          try {
            window.localStorage.removeItem("slates.mode.v1");
          } catch {
            /* the launcher just shows once more */
          }
          // A different root layout: a full load, not a client navigation.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          window.location.assign("/");
        }}
      >
        <IconLogout size={15} className={ICON} />
        Back to Slates
      </DropdownMenuItem>
    </DropdownMenuContent>
  );
}
