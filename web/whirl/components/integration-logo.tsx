"use client";

import { useState } from "react";
import { IconPlugConnected } from "@tabler/icons-react";

import { isImageLoaded, markImageLoaded } from "@whirl/lib/image-cache";

/* An integration's face, ported lean from v1: the uploaded logo when there
   is one, else the developer's monochrome SVG icon (recolored via CSS
   mask), else a friendly plug. The corner radius scales with the size so
   every size reads the same gently-rounded shape.

   Logos skeleton while their bytes arrive and fade in only once fully
   decoded; URLs that already loaded this session (lib/image-cache.ts)
   paint instantly — no re-shimmer every time a row or modal remounts. */
export function IntegrationLogo({
  name,
  logoUrl,
  iconSvg,
  size = 18,
  className = "",
}: {
  name: string;
  logoUrl: string | null;
  iconSvg?: string;
  size?: number;
  className?: string;
}) {
  /* A logo URL that won't load falls through to the icon tile instead of
     the browser's broken-image glyph. */
  const [failed, setFailed] = useState(false);
  const [loadedSrc, setLoadedSrc] = useState<string | null>(() =>
    logoUrl && isImageLoaded(logoUrl) ? logoUrl : null,
  );
  const radius = Math.round(size * 0.22);

  if (logoUrl && !failed) {
    const loaded = loadedSrc === logoUrl || isImageLoaded(logoUrl);
    // decode() resolves only once the image can paint completely (and
    // rejects for a dead URL), so the fade never shows a partial frame.
    const settle = (node: HTMLImageElement) => {
      node.decode().then(
        () => {
          markImageLoaded(logoUrl);
          setLoadedSrc(logoUrl);
        },
        () => setFailed(true),
      );
    };
    return (
      <span
        title={name}
        className={`relative block shrink-0 overflow-hidden ring-1 ring-black/[0.06] dark:ring-white/[0.08] ${className}`}
        style={{ width: size, height: size, borderRadius: radius }}
      >
        {!loaded && (
          <span className="absolute inset-0 block animate-pulse bg-black/[0.05] dark:bg-white/[0.08]" />
        )}
        {/* Arbitrary developer-hosted logo domains — next/image would need
            every one whitelisted. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={logoUrl}
          alt=""
          draggable={false}
          // Cached images can finish before React wires up onLoad — the
          // ref callback catches those so they never shimmer forever.
          ref={(node) => {
            if (node?.complete && !loaded) settle(node);
          }}
          onLoad={(event) => settle(event.currentTarget)}
          onError={() => setFailed(true)}
          className={`absolute inset-0 h-full w-full object-cover transition-opacity duration-300 ${
            loaded ? "opacity-100" : "opacity-0"
          }`}
        />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      title={name}
      className={`flex shrink-0 items-center justify-center bg-black/[0.05] text-muted-foreground ring-1 ring-black/[0.06] dark:bg-white/[0.08] dark:ring-white/[0.08] ${className}`}
      style={{ width: size, height: size, borderRadius: radius }}
    >
      {iconSvg ? (
        <span
          className="bg-current"
          style={{
            width: Math.round(size * 0.6),
            height: Math.round(size * 0.6),
            WebkitMaskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
            maskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      ) : (
        <IconPlugConnected size={Math.round(size * 0.6)} stroke={2} />
      )}
    </span>
  );
}

/** A console-provided monochrome integration mark without its store tile.
 * Tight activity rows use this so the tool's own face can replace the
 * generic plug without changing the row's geometry. */
export function IntegrationIcon({
  iconSvg,
  size = 16,
  className = "",
}: {
  iconSvg: string;
  size?: number;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 bg-current ${className}`}
      style={{
        width: size,
        height: size,
        WebkitMaskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
        maskImage: `url("data:image/svg+xml,${encodeURIComponent(iconSvg)}")`,
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
