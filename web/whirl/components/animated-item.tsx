"use client";

import { motion } from "motion/react";

import { pinRasterPath } from "@whirl/lib/motion";

/* Height + fade enter/exit for sidebar list items — deletes collapse away,
   moved and freshly arrived threads grow in with a soft pop. Pass
   `enter={false}` for items that should mount silently (e.g. the cached
   list's first live paint after the skeleton reveal). Pair with an
   <AnimatePresence> parent. Deliberately no `layout` prop: measured layout
   animations jitter against the sidebar's style-driven width transition. */
export function AnimatedItem({
  children,
  enter = true,
}: {
  children: React.ReactNode;
  enter?: boolean;
}) {
  return (
    <motion.div
      initial={enter ? { opacity: 0, height: 0, scale: 0.97 } : false}
      animate={{ opacity: 1, height: "auto", scale: 1 }}
      exit={{ opacity: 0, height: 0 }}
      transformTemplate={pinRasterPath}
      transition={{
        height: { duration: 0.2, ease: "easeOut" },
        scale: { duration: 0.2, ease: "easeOut" },
        opacity: { duration: 0.12, ease: "linear" },
      }}
    >
      {children}
    </motion.div>
  );
}
