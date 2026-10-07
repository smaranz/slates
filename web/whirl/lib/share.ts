/** The path for a shared conversation's public read-only page
 * (app/share/[shareId] — the token is the only gate). */
export function threadSharePath(shareId: string): string {
  return `/share/${shareId}`;
}

/** The absolute, shareable URL for a conversation (origin + path). */
export function threadShareUrl(shareId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${threadSharePath(shareId)}`;
}

/** The in-app path for a public artifact share page (served by the main
 * app — the token is minted backend-side and works on either origin). */
export function visualPath(shortId: string): string {
  return `/visual/${shortId}`;
}

/** The absolute, shareable URL for an artifact (origin + path). */
export function visualUrl(shortId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${visualPath(shortId)}`;
}

/** The in-app path for a public document share page (same family as
 * /visual — the token is minted backend-side, completed docs only). */
export function documentPath(shortId: string): string {
  return `/doc/${shortId}`;
}

/** The absolute, shareable URL for a document (origin + path). */
export function documentUrl(shortId: string): string {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return `${origin}${documentPath(shortId)}`;
}
