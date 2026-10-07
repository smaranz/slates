"use client";

import { IconAlertTriangleFilled, IconPlugConnected } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { IntegrationLogo } from "@whirl/components/integration-logo";
import { Button } from "@whirl/components/ui/button";
import {
  canReconnect,
  errorText,
  useConnectFlow,
  useExpiredIntegrations,
  type InstalledIntegration,
} from "@whirl/lib/integrations-data";
import { formatRelative } from "@whirl/lib/relative-time";
import { showToast } from "@whirl/lib/toasts";

/**
 * The "your sign-in ran out" notice.
 *
 * An expired grant used to be completely silent: the integration dropped out
 * of every turn, dashboards built on it rendered empty, and settings still
 * said "Ready to use". This is the part that says it out loud, in both places
 * someone would go looking — the store and the manage page — with the fix
 * attached rather than described.
 *
 * Renders nothing when everything is healthy, which is almost always.
 */
export function ReauthNotice({ className = "" }: { className?: string }) {
  const expired = useExpiredIntegrations();
  const connect = useConnectFlow();

  const reconnect = (item: InstalledIntegration) => {
    connect(item).catch((error: unknown) =>
      showToast(errorText(error, "Couldn't start the sign-in. Try again.")),
    );
  };

  return (
    <AnimatePresence initial={false}>
      {expired.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.22, 0.61, 0.36, 1] }}
          aria-live="polite"
          className={`flex flex-col gap-3 rounded-2xl bg-(--destructive-soft) p-4 shadow-[inset_0_0_0_1px_var(--destructive-outline)] ${className}`}
        >
          <div className="flex items-start gap-2.5">
            <IconAlertTriangleFilled
              size={16}
              className="mt-px shrink-0 text-destructive"
            />
            <div className="min-w-0">
              <h2 className="text-[13.5px] font-semibold tracking-tight text-destructive">
                {expired.length === 1
                  ? `${expired[0]!.name} needs signing in again`
                  : `${expired.length} integrations need signing in again`}
              </h2>
              <p className="mt-0.5 text-[12.5px]/5 text-muted-foreground">
                Whirl can&apos;t use{" "}
                {expired.length === 1 ? "it" : "them"} until you do — chats and
                anything built on {expired.length === 1 ? "it" : "them"} will
                come back empty.
              </p>
            </div>
          </div>

          <ul className="flex flex-col gap-2">
            {expired.map((item) => (
              <li
                key={item.serverId}
                className="flex items-center gap-3 rounded-xl bg-background px-3 py-2.5"
              >
                <IntegrationLogo
                  name={item.name}
                  logoUrl={item.logoUrl}
                  iconSvg={item.iconSvg}
                  size={30}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-[13px] font-medium">
                    {item.name}
                  </span>
                  <span className="truncate text-[11.5px]/4 text-muted-foreground">
                    {item.authExpiredAt
                      ? `Expired ${formatRelative(item.authExpiredAt)}`
                      : "Sign-in expired"}
                  </span>
                </span>
                {canReconnect(item) ? (
                  <Button
                    size="sm"
                    className="shrink-0"
                    onClick={() => reconnect(item)}
                  >
                    <IconPlugConnected size={13} stroke={2} />
                    Reconnect
                  </Button>
                ) : (
                  // An API key can't be repaired by a popup — the install form
                  // owns that, and saying so beats a button that does nothing.
                  <span className="shrink-0 text-[11.5px] text-muted-foreground">
                    Update its key below
                  </span>
                )}
              </li>
            ))}
          </ul>
        </motion.section>
      )}
    </AnimatePresence>
  );
}
