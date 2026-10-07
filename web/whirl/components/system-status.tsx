"use client";

import { useEffect, useState } from "react";
import { IconBolt, IconFlame } from "@tabler/icons-react";
import { useMutation, useQuery } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";

import { useModelAccess } from "@whirl/lib/model-access";
import { dismissUpdateToast, showToast, showUpdateToast } from "@whirl/lib/toasts";
import { useView } from "@whirl/lib/view";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog";

export type ActiveMultiplier = {
  multiplier: number;
  headline: string;
  subtext: string | null;
  applyToFreeMessages: boolean;
  startsAt: number | null;
  expiresAt: number | null;
};

export function useActiveMultiplier(): ActiveMultiplier | null {
  const event = useQuery(api.admin.getActiveMultiplier) as
    ActiveMultiplier | null | undefined;
  const [now, setNow] = useState(0);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(Date.now()), 0);
    if (!event) return () => window.clearTimeout(initial);
    const boundaries = [event.startsAt, event.expiresAt].filter(
      (value): value is number =>
        typeof value === "number" && value > Date.now(),
    );
    if (boundaries.length === 0) return () => window.clearTimeout(initial);
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(...boundaries) - Date.now() + 50,
    );
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(timer);
    };
  }, [event]);
  if (!event || now === 0) return null;
  if (event.startsAt && now < event.startsAt) return null;
  if (event.expiresAt && now >= event.expiresAt) return null;
  return event;
}

export function UsageMultiplierBadge({
  compact = false,
}: {
  compact?: boolean;
}) {
  const event = useActiveMultiplier();
  if (!event) return null;
  return (
    <span
      title={event.subtext ?? event.headline}
      className={`inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-500/12 font-semibold text-amber-700 dark:text-amber-300 ${
        compact ? "px-1.5 py-0.5 text-[10.5px]" : "px-2 py-1 text-xs"
      }`}
    >
      <IconBolt size={compact ? 11 : 13} fill="currentColor" />
      {event.multiplier}× usage
    </span>
  );
}

export function UsageMultiplierBanner() {
  const event = useActiveMultiplier();
  if (!event) return null;
  return (
    <div className="flex min-h-9 shrink-0 items-center justify-center gap-2 border-b border-amber-500/20 bg-amber-500/10 px-4 text-center text-xs text-amber-900 dark:text-amber-100">
      <IconBolt size={14} fill="currentColor" />
      <strong>{event.headline || `${event.multiplier}× usage event`}</strong>
      {event.subtext && (
        <span className="hidden opacity-75 sm:inline">{event.subtext}</span>
      )}
    </div>
  );
}

export function ComposerStatusPills() {
  const load = useQuery(api.serverLoad.getServerLoad);
  const { isPaid } = useModelAccess();
  const { openPricing } = useView();
  const overloaded = isPaid === false && (load?.level ?? 0) > 0;
  return (
    <div className="mb-1.5 flex min-h-0 items-center justify-end gap-1.5">
      {overloaded && (
        <button
          type="button"
          onClick={openPricing}
          className="inline-flex items-center gap-1 rounded-full bg-orange-500/12 px-2 py-1 text-[11px] font-medium text-orange-700 dark:text-orange-300"
          title="Free requests are temporarily limited while demand is high"
        >
          <IconFlame size={12} />
          High demand
        </button>
      )}
      <UsageMultiplierBadge />
    </div>
  );
}

export function ResetNoticeDialog({ enabled }: { enabled: boolean }) {
  const notice = useQuery(
    api.admin.getPendingResetNotice,
    enabled ? {} : "skip",
  );
  const acknowledge = useMutation(api.admin.acknowledgeResetNotice);
  const [closing, setClosing] = useState(false);
  const open = Boolean(notice) && !closing;
  const close = async () => {
    setClosing(true);
    try {
      await acknowledge({});
    } catch {
      setClosing(false);
      showToast("The notice couldn’t be dismissed. Try again?");
    }
  };
  return (
    <Dialog open={open} onOpenChange={(next) => !next && void close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Your usage was reset</DialogTitle>
          <DialogDescription className="pt-1">
            {notice?.message}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button onClick={() => void close()}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DeploymentWatcher() {
  const localVersion = process.env.NEXT_PUBLIC_APP_VERSION;
  const enabled =
    process.env.NEXT_PUBLIC_APP_ENV === "production" && Boolean(localVersion);
  const deployment = useQuery(api.deployment.current, enabled ? {} : "skip");
  const deploymentVersion = deployment?.version;

  useEffect(() => {
    // undefined = still loading / skipped; null = no deploy recorded yet.
    if (!enabled || !deploymentVersion) {
      if (!enabled) dismissUpdateToast();
      return;
    }
    if (deploymentVersion !== localVersion) {
      showUpdateToast(() => window.location.reload());
    } else {
      dismissUpdateToast();
    }
  }, [deploymentVersion, enabled, localVersion]);
  return null;
}
