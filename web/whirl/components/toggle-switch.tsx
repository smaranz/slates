"use client";

/* A little flat switch, sized for menu rows. The knob glides on the
   standalone `translate` property (transition must name it explicitly in
   Tailwind v4). Omit `onCheckedChange` to render it presentational — for
   rows that are themselves the click target. */
export function ToggleSwitch({
  checked,
  onCheckedChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  onCheckedChange?: (checked: boolean) => void;
  "aria-label"?: string;
}) {
  const track = `relative h-4.5 w-8 shrink-0 rounded-full transition-colors duration-150 ${
    checked ? "bg-primary" : "bg-black/[0.15] dark:bg-white/[0.2]"
  }`;
  const knob = (
    <span
      className={`absolute top-0.5 left-0.5 block size-3.5 rounded-full bg-surface ring-1 ring-black/[0.06] transition-[translate] duration-150 dark:ring-white/[0.08] ${
        checked ? "translate-x-3.5" : "translate-x-0"
      }`}
    />
  );

  if (!onCheckedChange) {
    return (
      <span aria-hidden className={track}>
        {knob}
      </span>
    );
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onCheckedChange(!checked)}
      className={`${track} cursor-pointer ${
        checked ? "" : "hover:bg-black/[0.2] dark:hover:bg-white/[0.25]"
      }`}
    >
      {knob}
    </button>
  );
}
