"use client";

import { IconChevronRight, IconCircleCheckFilled } from "@tabler/icons-react";
import { AnimatePresence, motion, type Variants } from "motion/react";

import { IntegrationLogo } from "@whirl/components/integration-logo";
import { VerifiedBadge } from "./verified-badge";

/* The storefront grid: plain directory rows, two columns when there's
   room — no wells, no rings, just a soft tint on hover. Listing-type-
   agnostic — the browse tab feeds it integrations, the skills tab feeds
   it skills; the trailing glyph tells the row's install story. */

const listStagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.03 } },
};

const listItem: Variants = {
  hidden: { opacity: 0, y: 4 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.22, 0.61, 0.36, 1] },
  },
};

const trailingPop = {
  initial: { opacity: 0, scale: 0.5 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.5 },
  transition: { duration: 0.14, ease: [0.22, 0.61, 0.36, 1] as const },
};

export type StoreListing = {
  id: string;
  name: string;
  description: string;
  logoUrl: string | null;
  iconSvg?: string;
  verified: boolean;
  /** "installed" shows the check, "pending" the finish-setup pill. */
  state: "none" | "pending" | "installed";
};

export function StoreGrid({
  items,
  onOpen,
}: {
  items: StoreListing[];
  onOpen: (id: string) => void;
}) {
  return (
    <motion.ul
      variants={listStagger}
      initial="hidden"
      animate="show"
      className="relative grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2"
    >
      {/* popLayout lets surviving rows glide into place as search filters. */}
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item) => (
          <motion.li
            layout
            variants={listItem}
            exit={{
              opacity: 0,
              scale: 0.96,
              transition: { duration: 0.15, ease: [0.22, 0.61, 0.36, 1] },
            }}
            key={item.id}
            /* min-w-0 or the row refuses to shrink below its own min-content
               — a long description would widen the cell right off the page
               and the truncate below would never get a turn. */
            className="min-w-0"
          >
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              transition={{ type: "spring", stiffness: 500, damping: 30 }}
              onClick={() => onOpen(item.id)}
              className="group flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors duration-150 hover:bg-muted"
            >
              <IntegrationLogo
                name={item.name}
                logoUrl={item.logoUrl}
                iconSvg={item.iconSvg}
                size={44}
              />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">
                    {item.name}
                  </span>
                  {item.verified && <VerifiedBadge size={14} />}
                </span>
                <span className="truncate text-[12.5px] text-muted-foreground">
                  {item.description}
                </span>
              </span>
              <AnimatePresence mode="wait" initial={false}>
                {item.state === "installed" ? (
                  <motion.span
                    key="installed"
                    {...trailingPop}
                    title="Installed"
                    className="shrink-0 text-emerald-500"
                  >
                    <IconCircleCheckFilled size={18} aria-label="Installed" />
                  </motion.span>
                ) : item.state === "pending" ? (
                  <motion.span
                    key="pending"
                    {...trailingPop}
                    className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:bg-amber-400/15 dark:text-amber-400"
                  >
                    Finish setup
                  </motion.span>
                ) : (
                  <motion.span key="open" {...trailingPop} className="shrink-0">
                    <IconChevronRight
                      size={16}
                      stroke={2}
                      className="text-muted-foreground/40 transition-[color,translate] group-hover:translate-x-0.5 group-hover:text-muted-foreground"
                    />
                  </motion.span>
                )}
              </AnimatePresence>
            </motion.button>
          </motion.li>
        ))}
      </AnimatePresence>
    </motion.ul>
  );
}
