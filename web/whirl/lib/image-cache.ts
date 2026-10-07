"use client";

/* A session-wide memory of which image URLs have fully loaded. Store
   surfaces mount the same logos over and over (grid rows, hero, modals) —
   once a URL has decoded, later mounts paint it instantly instead of
   re-running the skeleton-and-fade. `preloadImage` warms the cache in the
   background so most images are ready before they're ever on screen. */

const loaded = new Set<string>();
const pending = new Set<string>();

export function isImageLoaded(url: string): boolean {
  return loaded.has(url);
}

export function markImageLoaded(url: string) {
  loaded.add(url);
}

/** Fetch + decode an image off-screen; no-op if done, in flight, or SSR. */
export function preloadImage(url: string | null | undefined) {
  if (!url || loaded.has(url) || pending.has(url)) return;
  if (typeof window === "undefined") return;
  pending.add(url);
  const image = new Image();
  image.src = url;
  image
    .decode()
    .then(() => loaded.add(url))
    .catch(() => {
      // Broken or blocked URL — the on-screen <img> will surface it.
    })
    .finally(() => pending.delete(url));
}
