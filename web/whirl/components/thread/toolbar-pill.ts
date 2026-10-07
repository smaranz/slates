/* The thread toolbar's floating pill buttons (thread-toolbar.tsx): the
   composer's translucent-well language, shrunk to a capsule — they float
   over the transcript the same way the dock does, so they share its
   chrome. data-popup-open keeps a pill lit while its menu or popover is
   up (the pointer is off in the portal by then). */

export const TOOLBAR_PILL_CLASS =
  "flex h-8 cursor-pointer items-center gap-1.5 rounded-full bg-(--well-translucent) px-3 text-[13px]/4 font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] backdrop-blur-xl transition-colors duration-150 hover:text-foreground data-popup-open:text-foreground";
