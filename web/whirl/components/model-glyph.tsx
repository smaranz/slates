"use client";

import { IconAtom2Filled } from "@tabler/icons-react";

import type { ComposerModel } from "@whirl/lib/models";

/* A model's face at any size: the tier's Tabler glyph, an admin-uploaded
   monochrome SVG (recolored via CSS mask, same trick as integration icons),
   or a neutral atom for a catalog model that shipped without one. Color
   follows currentColor either way, so callers just set a text class. */
export function ModelGlyph({
  model,
  size = 15,
  className = "",
}: {
  model: Pick<ComposerModel, "icon" | "iconSvg">;
  size?: number;
  className?: string;
}) {
  if (model.iconSvg) {
    const url = `url("data:image/svg+xml,${encodeURIComponent(model.iconSvg)}")`;
    return (
      <span
        aria-hidden
        className={`inline-block shrink-0 bg-current ${className}`}
        style={{
          width: size,
          height: size,
          WebkitMaskImage: url,
          maskImage: url,
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskPosition: "center",
          maskPosition: "center",
        }}
      />
    );
  }
  const Icon = model.icon ?? IconAtom2Filled;
  return <Icon size={size} className={className} />;
}
