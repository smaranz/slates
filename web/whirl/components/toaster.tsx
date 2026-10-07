"use client";

import { IconRefresh, IconTrashFilled } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";
import { useToasts, type Toast } from "@whirl/lib/toasts";
import { Button } from "@whirl/components/ui/button";

function ToastCard({ toast }: { toast: Toast }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      transformTemplate={pinRasterPath}
      className="raised pointer-events-auto flex w-[min(20rem,calc(100vw-2rem))] items-center gap-2.5 rounded-xl bg-popover py-2 pr-2 pl-3 text-popover-foreground ring-1 ring-border"
    >
      {toast.kind === "delete" && (
        <IconTrashFilled size={15} className="shrink-0 text-muted-foreground" />
      )}
      {toast.kind === "update" && (
        <IconRefresh size={15} className="shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{toast.message}</span>
      {toast.action && (
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 font-semibold"
          onClick={toast.action.onAction}
        >
          {toast.action.label}
        </Button>
      )}
    </motion.div>
  );
}

/* Fixed viewport for app toasts (delete + undo lives here). Mounted once
   in the shell; newest toast lands at the bottom. */
export function Toaster() {
  const toasts = useToasts();

  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex flex-col items-end gap-2">
      <AnimatePresence mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
