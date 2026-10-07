import { buildStandaloneHtmlDoc } from "@whirl/lib/html-frame";
import { visualUrl } from "@whirl/lib/share";

/** Turn a title into a safe-ish filename stem. */
function slugify(title: string): string {
  const stem = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return stem || "whirl-artifact";
}

function isDark(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.classList.contains("dark")
  );
}

function standaloneDoc(title: string, html: string): string {
  return buildStandaloneHtmlDoc(html, title, { dark: isDark() });
}

/**
 * Download an artifact as a standalone .html file — just the artifact with
 * its theme tokens baked in, no branding wrapper.
 */
export function downloadHtmlArtifact(title: string, html: string) {
  const doc = standaloneDoc(title, html);
  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(title)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoke after the click has a chance to start the download. */
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Download a React artifact as its source module.
 *
 * Deliberately not a standalone .html: making one run outside Whirl means
 * inlining a megabyte of runtime, and an artifact with data bindings would
 * still be inert because the bindings only resolve against the owner's
 * session. The source is the honest artifact — it's what whirl wrote.
 */
export function downloadReactArtifactSource(title: string, code: string) {
  const blob = new Blob([code], { type: "text/jsx;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slugify(title)}.jsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/**
 * Open the artifact in a new tab. Prefers the live, shareable
 * {site}/visual/{id} page (a real URL the user can copy and send); falls
 * back to a self-contained blob for artifacts without a share token.
 */
export function openHtmlArtifactInNewTab(
  title: string,
  html: string,
  shortId?: string,
) {
  if (shortId) {
    window.open(visualUrl(shortId), "_blank", "noopener,noreferrer");
    return;
  }
  const blob = new Blob([standaloneDoc(title, html)], {
    type: "text/html;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener,noreferrer");
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
