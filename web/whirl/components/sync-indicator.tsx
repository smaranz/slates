"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useConvexAuth } from "@whirl/backend/react";
import { AnimatePresence, motion } from "motion/react";

import { useFolders } from "@whirl/lib/folders";
import { useThreads } from "@whirl/lib/threads";

/* A quiet spinner beside the logo while the thread list is still catching
   up with the server (auth resolving or queries in flight); fades away
   once everything is live. Subscriptions are shared with ThreadList, so
   this costs nothing extra. */
export function SyncIndicator() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const threads = useThreads(isAuthenticated);
  const folders = useFolders(isAuthenticated);

  const syncing = isLoading || (isAuthenticated && (!threads || !folders));

  return (
    <AnimatePresence>
      {syncing && (
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, ease: "linear" }}
          aria-label="Syncing"
          className="ml-2 flex items-center sidebar-collapsed:hidden"
        >
          <IconLoader2
            size={13}
            className="animate-spin text-foreground-soft"
          />
        </motion.span>
      )}
    </AnimatePresence>
  );
}
