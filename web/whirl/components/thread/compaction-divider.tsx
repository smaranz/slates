"use client";

import { IconFileZip } from "@tabler/icons-react";
import { motion } from "motion/react";

export function CompactionDivider({ compactedAt }: { compactedAt: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="my-5 flex items-center gap-3 text-[11px] font-medium text-muted-foreground"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="inline-flex items-center gap-1.5">
        <IconFileZip size={13} stroke={2} />
        Earlier context compacted{" "}
        {new Date(compactedAt).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        })}
      </span>
      <span className="h-px flex-1 bg-border" />
    </motion.div>
  );
}
