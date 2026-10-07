"use client";

import { cn } from "@whirl/lib/utils";

/* Form bits for the agent-layer settings, in the composer's "well" look so
   they sit beside Whirl's own fields without a new pattern. */

const WELL =
  "w-full rounded-lg bg-well px-3 py-2 text-[13px]/5 shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)] outline-none transition-shadow placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="text-[11.5px]/4 text-muted-foreground">{hint}</span>}
    </label>
  );
}

export function TextArea({ className, ...props }: React.ComponentProps<"textarea">) {
  return <textarea {...props} className={cn(WELL, "resize-y", className)} />;
}

export function Select({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <select {...props} className={cn(WELL, "h-9 appearance-none pr-8", className)} style={{ backgroundImage: "none" }}>
      {children}
    </select>
  );
}
