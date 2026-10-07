import type { ButtonHTMLAttributes } from "react";

import { cn } from "@whirl/lib/utils";

/* Liquid-glass squish pill. The glaze is a translucent background-image
   gradient (brighter at the top) layered over the background-color, so
   hover can still animate the color beneath it. One recipe for both
   modes, translucent at every stop on purpose: it may only LIGHTEN the
   base, never replace it — heavier or solid stops paint a white cap
   over accent primaries, which must stay shades of their own hue.
   Press feedback is a scale dip; `scale` is a standalone CSS property
   in Tailwind v4, so the transition names it explicitly. */
const GLAZE = "bg-linear-to-b from-white/25 to-white/0";

export function SquishButton({
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      className={cn(
        "inline-flex cursor-pointer items-center justify-start gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-[background-color,scale] duration-150 ease-out hover:bg-(--primary-hover) active:scale-[0.96]",
        GLAZE,
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
