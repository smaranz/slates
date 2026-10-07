"use client";

import { useTwirl, WhirlHoverMark } from "./whirl-rings";

export function WhirlLogo({
  size = 20,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const { twirling, twirl } = useTwirl();
  const dim = `${size}px`;

  return (
    <span
      onMouseEnter={twirl}
      style={{ width: dim, height: dim }}
      className={`relative inline-block shrink-0 ${className}`}
    >
      <WhirlHoverMark
        twirling={twirling}
        layers={[{ className: "bg-foreground-soft" }]}
      />
    </span>
  );
}
