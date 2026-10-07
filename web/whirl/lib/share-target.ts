/**
 * The OS share sheet's end of the manifest's `share_target`.
 *
 * Android hands a shared item over as a plain navigation to `/?title=…&text=…
 * &url=…`, so the arrival looks like any other cold load. This reads those
 * params once, folds them into one prompt, and wipes them off the URL — the
 * app's own routing treats "/" as home, and a stale `?text=` in history
 * would re-prefill the composer on every back button press.
 */

const PARAMS = ["title", "text", "url"] as const;

/** The shared item as a draft, or null when this wasn't a share. */
export function claimSharedText(): string | null {
  if (typeof window === "undefined") return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(window.location.search);
  } catch {
    return null;
  }
  if (!PARAMS.some((key) => params.has(key))) return null;

  const title = params.get("title")?.trim() ?? "";
  const text = params.get("text")?.trim() ?? "";
  const url = params.get("url")?.trim() ?? "";

  for (const key of PARAMS) params.delete(key);
  const query = params.toString();
  try {
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`,
    );
  } catch {
    // Replacing the URL is tidiness, not correctness — carry on either way.
  }

  /* Apps disagree about which field carries what: some put the link in
     `url`, some inline it in `text`, some send a `title` that just repeats
     the page's. Keep the parts that say something new, in reading order. */
  const parts: string[] = [];
  if (title && title !== text && !text.includes(title)) parts.push(title);
  if (text) parts.push(text);
  if (url && !text.includes(url)) parts.push(url);

  const draft = parts.join("\n\n").trim();
  return draft.length > 0 ? draft : null;
}
