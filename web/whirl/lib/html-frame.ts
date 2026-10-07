/* Builds the host document whirl's HTML artifacts render inside. The model
   writes a self-contained body fragment styled with --whirl-* theme tokens
   (convex/inference/htmlTheme.ts); here we define those tokens for the
   current light/dark theme, add a reset and a height reporter, and wrap
   the fragment. Ported from apps/legacy/app/lib/html-frame.ts — keep the
   token names in sync with the backend. */

type ThemeVars = Record<string, string>;

const LIGHT: ThemeVars = {
  "--whirl-bg": "#ffffff",
  "--whirl-surface": "#f5f5f4",
  "--whirl-surface-2": "#ebebea",
  "--whirl-fg": "#171717",
  "--whirl-muted": "#737373",
  "--whirl-border": "rgba(0,0,0,0.09)",
  "--whirl-accent": "#0c82f2",
  "--whirl-accent-soft": "rgba(12,130,242,0.12)",
  "--whirl-accent-fg": "#ffffff",
  "--whirl-success": "#16a34a",
  "--whirl-warning": "#d97706",
  "--whirl-danger": "#dc2626",
  "--whirl-radius": "12px",
  "--whirl-font-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "--whirl-font-mono":
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  "--whirl-shadow": "0 1px 2px rgba(0,0,0,0.06), 0 8px 24px rgba(0,0,0,0.06)",
};

const DARK: ThemeVars = {
  "--whirl-bg": "#181818",
  "--whirl-surface": "rgba(255,255,255,0.045)",
  "--whirl-surface-2": "rgba(255,255,255,0.08)",
  "--whirl-fg": "#ededed",
  "--whirl-muted": "#a3a3a3",
  "--whirl-border": "rgba(255,255,255,0.1)",
  "--whirl-accent": "#4d9bf6",
  "--whirl-accent-soft": "rgba(77,155,246,0.18)",
  "--whirl-accent-fg": "#0b0b0b",
  "--whirl-success": "#4ade80",
  "--whirl-warning": "#fbbf24",
  "--whirl-danger": "#f87171",
  "--whirl-radius": "12px",
  "--whirl-font-sans":
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  "--whirl-font-mono":
    'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
  "--whirl-shadow": "0 1px 2px rgba(0,0,0,0.4), 0 8px 24px rgba(0,0,0,0.35)",
};

/** The same palette, posted into a React artifact's frame on every theme
 *  change — see components/thread/artifacts/react-frame-view.tsx. Shared so
 *  the two runtimes can never drift apart. */
export function whirlThemeTokens(dark: boolean): ThemeVars {
  return dark ? DARK : LIGHT;
}

const varsBlock = (vars: ThemeVars) =>
  Object.entries(vars)
    .map(([key, value]) => `  ${key}: ${value};`)
    .join("\n");

function fixedTokensCss(dark: boolean): string {
  return `:root {\n${varsBlock(dark ? DARK : LIGHT)}\n  color-scheme: ${dark ? "dark" : "light"};\n}`;
}

function baseResetCss(fill: boolean): string {
  /* fill (the side panel / standalone stage) pins html+body to the frame's
     height so app-style content ("height: 100%" game containers, canvas
     stages) has a real chain to resolve against instead of collapsing;
     longer documents still scroll. Inline cards keep auto height — it's
     what the height reporter measures. */
  return `*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; padding: 0; ${fill ? "height: 100%;" : ""} }
body {
  font-family: var(--whirl-font-sans);
  color: var(--whirl-fg);
  background: ${fill ? "var(--whirl-bg)" : "transparent"};
  font-size: 14px;
  line-height: 1.55;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
  /* Oversized authored layouts scroll inside the sandbox instead of
     widening or being clipped by a narrow chat/sidebar container. */
  overflow-x: auto;
  max-width: 100%;
  overflow-wrap: anywhere;
}
a { color: var(--whirl-accent); }
:focus-visible { outline: 2px solid var(--whirl-accent); outline-offset: 2px; }
img, svg, canvas, video { max-width: 100%; height: auto; }
code, pre { font-family: var(--whirl-font-mono); }
::selection { background: var(--whirl-accent-soft); }`;
}

/* The in-frame agent. Reports the rendered height up to the parent so an
   inline card can size its iframe to the content — and recognizes
   "app-style" content (games, 3D scenes, anything viewport-sized) that
   auto-height can only squish or inflate. Content-height sizing is a
   feedback loop for such documents: their height IS the viewport, so
   every height the parent applies becomes the next report. On detection
   it tells the parent to switch to a fixed stage instead
   ('whirl-html-app') and pins html+body to that stage's height.

   Detection: a <canvas> anywhere, viewport units / full-height styles on
   the document's own elements, or the loop's signature itself — reports
   that stay a constant hair above a growing viewport. Harmless in the
   side panel (already a fixed stage; messages are ignored). */
const FRAME_AGENT = `(function(){
  var appMode = false;
  var creep = 0, lastVh = 0, lastDelta = -1;
  function goApp(){
    if (appMode) return;
    appMode = true;
    document.documentElement.style.height = '100%';
    document.body.style.height = '100%';
    document.body.style.padding = '0';
    try { parent.postMessage({ type: 'whirl-html-app' }, '*'); } catch (e) {}
  }
  function wantsViewport(){
    if (document.querySelector('canvas')) return true;
    var styles = document.querySelectorAll('style');
    for (var i = 0; i < styles.length; i++) {
      if (/100(d|s|l)?vh/.test(styles[i].textContent || '')) return true;
    }
    var nodes = document.querySelectorAll('[style]');
    for (var j = 0; j < nodes.length; j++) {
      var st = nodes[j].getAttribute('style') || '';
      if (/100(d|s|l)?vh/.test(st) || /height:\\s*100%/.test(st)) return true;
    }
    return false;
  }
  function send(){
    try {
      if (wantsViewport()) goApp();
      if (appMode) return;
      var h = Math.ceil(document.documentElement.getBoundingClientRect().height);
      var d = h - window.innerHeight;
      if (d > 0 && d <= 64 && window.innerHeight > lastVh && Math.abs(d - lastDelta) <= 2) {
        creep++;
        if (creep >= 3) { goApp(); return; }
      } else {
        creep = 0;
      }
      lastDelta = d;
      lastVh = Math.max(lastVh, window.innerHeight);
      parent.postMessage({ type: 'whirl-html-height', height: h }, '*');
    } catch (e) {}
  }
  window.addEventListener('load', send);
  window.addEventListener('resize', send);
  document.addEventListener('DOMContentLoaded', send);
  if (window.ResizeObserver) { try { new ResizeObserver(send).observe(document.documentElement); } catch (e) {} }
  [50, 250, 800, 2000].forEach(function(t){ setTimeout(send, t); });
})();`;

/**
 * Pull the renderable fragment out of whatever the model produced. It's
 * instructed to write a body fragment, but if it wraps the output in a
 * full document we lift the body (hoisting any <head> styles) so wrapping
 * stays clean instead of nesting <html> inside <body>.
 */
export function normalizeHtmlFragment(raw: string): string {
  let html = raw.trim();
  html = html.replace(/^<!doctype[^>]*>/i, "").trim();

  /* Greedy to the LAST </body> — a stray "</body>" inside a <script> or
     text node must not truncate the real body content. */
  const bodyMatch = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (bodyMatch) {
    const beforeBody = html.slice(0, bodyMatch.index);
    const headStyles = (
      beforeBody.match(/<style[\s\S]*?<\/style>/gi) ?? []
    ).join("\n");
    return `${headStyles}\n${bodyMatch[1]}`.trim();
  }

  return html
    .replace(/<\/?html[^>]*>/gi, "")
    .replace(/<\/?head[^>]*>/gi, "")
    .replace(/<\/?body[^>]*>/gi, "")
    .trim();
}

/** The iframe srcDoc for an in-app artifact. `fill` = side panel (solid
 * background, no outer padding); otherwise an inline card (transparent,
 * padded). */
export function buildHtmlSrcDoc(
  html: string,
  { dark, fill = false }: { dark: boolean; fill?: boolean },
): string {
  const padding = fill ? "0" : "14px";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
${fixedTokensCss(dark)}
${baseResetCss(fill)}
body { padding: ${padding}; }
</style>
</head>
<body>
${normalizeHtmlFragment(html)}
<script>${FRAME_AGENT}</script>
</body>
</html>`;
}

/**
 * A complete, self-contained HTML file of just the artifact — the theme
 * tokens, the base reset, and the fragment itself, exactly what renders in
 * the sandbox. Deliberately NO branding chrome: a download is the user's
 * HTML and nothing else. Theme is baked from the download-time `dark`.
 */
export function buildStandaloneHtmlDoc(
  html: string,
  title: string,
  { dark }: { dark: boolean },
): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title || "Visualization")}</title>
<style>
${fixedTokensCss(dark)}
${baseResetCss(true)}
</style>
</head>
<body>
${normalizeHtmlFragment(html)}
</body>
</html>`;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
