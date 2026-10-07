"use client";

import { useState } from "react";
import { useUser } from "@whirl/backend/auth";
import { IconChevronUp, IconLogin2 } from "@tabler/icons-react";
import { useCustomer } from "@whirl/backend/billing";

import { AuthModal } from "@whirl/components/auth/auth-modal";
import { Avatar, AvatarFallback, AvatarImage } from "@whirl/components/ui/avatar";
import { DropdownMenu, DropdownMenuTrigger } from "@whirl/components/ui/dropdown-menu";
import { Skeleton } from "@whirl/components/ui/skeleton";
import { useDeploymentFeatures } from "@whirl/lib/deployment-features";
import { useCachedPlan, type PlanSummary } from "@whirl/lib/plan-cache";
import { ANALYTICS_EVENTS, captureEvent } from "@whirl/lib/posthog";
import { openSupport, useSupportAvailable } from "@whirl/lib/support";
import { PlanBadge } from "./plan-badge";
import { SkeletonReveal } from "./skeleton-reveal";
import { UserMenuContent } from "./user-menu";

/* The ::before layer is an invisible hit area stretching to the sidebar's
   edges (the wrap's absolute t-skel-content is the containing block, so the
   button's own overflow-hidden can't clip it — don't make the row
   `relative` or it will). */
const ROW =
  "flex h-full w-full cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg px-2 py-2 text-left transition-colors before:absolute before:-inset-x-3 before:-top-1.5 before:-bottom-2 hover:bg-accent";

/* Rail centering without the justify-center jump: the row stays
   left-anchored and the leading element glides the last few px into the
   rail's center on the width curve; the text just fades out under the
   sliding edge (the row's overflow-hidden clips whatever is left). */
const RAIL_GLIDE = "sidebar-glide transition-[margin]";
const FADE =
  "transition-[opacity,visibility] duration-150 sidebar-collapsed:invisible sidebar-collapsed:opacity-0";

/* Static bones; the t-skel layer pulses them as one, so the Skeleton
   primitive's own animate-pulse is switched off. */
function UserSkeleton() {
  return (
    <div className="flex h-full items-center gap-2.5 px-2 sidebar-collapsed:justify-center sidebar-collapsed:px-0">
      <Skeleton className="size-8 animate-none rounded-full" />
      <div className="flex flex-col gap-1.5 sidebar-collapsed:hidden">
        <Skeleton className="h-3 w-20 animate-none" />
        <Skeleton className="h-2.5 w-12 animate-none" />
      </div>
    </div>
  );
}

function SignInRow() {
  const [authOpen, setAuthOpen] = useState(false);

  return (
    <>
      <button type="button" className={ROW} onClick={() => setAuthOpen(true)}>
        <span
          className={`flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-foreground-soft sidebar-collapsed:-ml-1.5 ${RAIL_GLIDE}`}
        >
          <IconLogin2 size={18} />
        </span>
        <span className={`flex min-w-0 flex-col ${FADE}`}>
          <span className="text-sm leading-5 font-semibold text-foreground-soft">
            Sign in
          </span>
          <span className="text-xs leading-4 text-muted-foreground">
            to start chatting
          </span>
        </span>
      </button>
      <AuthModal open={authOpen} onOpenChange={setAuthOpen} />
    </>
  );
}

function SignedInRow({
  name,
  imageUrl,
  plan,
}: {
  name: string;
  imageUrl: string;
  plan: PlanSummary;
}) {
  const supportAvailable = useSupportAvailable();
  const { billing } = useDeploymentFeatures();

  return (
    <DropdownMenu stableContentWidth>
      <DropdownMenuTrigger className={`group ${ROW}`}>
        <Avatar className={`sidebar-collapsed:-ml-1 ${RAIL_GLIDE}`}>
          <AvatarImage src={imageUrl} alt="" />
          <AvatarFallback>{name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className={`flex min-w-0 flex-col items-start gap-0.5 ${FADE}`}>
          <span className="max-w-full truncate text-sm leading-4 font-medium text-foreground-soft">
            {name}
          </span>
          {/* No billing, no plans: the name stands alone. */}
          {!billing ? null : plan.planId ? (
            <PlanBadge plan={plan.planId} className="h-3 w-auto shrink-0" />
          ) : (
            <span className="text-xs leading-3 text-muted-foreground">
              {plan.planName}
            </span>
          )}
        </span>
        <IconChevronUp
          size={16}
          className="ml-auto shrink-0 text-foreground-soft transition-[rotate,opacity,visibility] duration-150 group-data-popup-open:rotate-180 sidebar-collapsed:invisible sidebar-collapsed:opacity-0"
        />
      </DropdownMenuTrigger>
      <UserMenuContent
        billing={billing}
        onSupport={
          supportAvailable
            ? () => {
                captureEvent(ANALYTICS_EVENTS.supportOpened);
                openSupport();
              }
            : undefined
        }
      />
    </DropdownMenu>
  );
}

/* The signed-in row at the bottom of the sidebar: pfp, name, plan under the
   name, and a chevron that flips open a context menu floating above it.
   Everything reveals together — Clerk plus a (cached) plan — so the badge
   doesn't pop in after the rest of the row. */
export function UserButton() {
  const { user, isLoaded } = useUser();
  const { customer, isLoading: customerLoading, error } = useCustomer();
  /* Errored fetches (the pre-auth window) read as unsettled — the cached
     plan holds the badge instead of a false "Free" flash. */
  const plan = useCachedPlan(
    user?.id,
    customer,
    customerLoading || error != null,
  );

  const revealed = isLoaded && (!user || plan !== null);
  const name =
    user?.fullName ??
    user?.username ??
    user?.primaryEmailAddress?.emailAddress ??
    "You";

  return (
    <SkeletonReveal
      revealed={revealed}
      skeleton={<UserSkeleton />}
      className="h-13 [--pulse-count:infinite]"
    >
      {isLoaded &&
        (user ? (
          plan && <SignedInRow name={name} imageUrl={user.imageUrl} plan={plan} />
        ) : (
          <SignInRow />
        ))}
    </SkeletonReveal>
  );
}
