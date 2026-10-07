import { asBlob } from "html-docx-js-typescript";

/** Strip the file extension so we can re-suffix it per export format. */
export function baseFileName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Print-friendly styles, kept close to the editor's on-screen typography. */
const PRINT_STYLES = `
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; font-size: 12pt; line-height: 1.6; color: #1c1917; margin: 0; }
  h1 { font-size: 22pt; } h2 { font-size: 17pt; } h3 { font-size: 14pt; }
  h1, h2, h3, h4 { font-weight: 650; line-height: 1.25; margin: 1.2em 0 0.5em; }
  p { margin: 0 0 0.8em; }
  ul, ol { padding-left: 1.6em; margin: 0 0 0.8em; }
  li { margin: 0.2em 0; }
  blockquote { border-left: 3px solid #d6d3d1; padding-left: 1em; color: #57534e; font-style: italic; margin: 0 0 0.8em; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.9em; background: #f5f5f4; padding: 0.1em 0.35em; border-radius: 4px; }
  pre { background: #f5f5f4; border-radius: 8px; padding: 0.9em 1.1em; overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  a { color: #2563eb; }
  hr { border: none; border-top: 1px solid #e7e5e4; margin: 1.4em 0; }
  img { max-width: 100%; height: auto; border-radius: 8px; }
  table { border-collapse: collapse; width: 100%; margin: 0 0 0.9em; font-size: 0.95em; }
  th, td { border: 1px solid #d6d3d1; padding: 0.4em 0.6em; text-align: left; vertical-align: top; }
  th { background: #f5f5f4; font-weight: 650; }
  .katex-display { margin: 0.5em 0; text-align: center; }
`;

// Pull in KaTeX's stylesheet so the math rendered into the export HTML (via the
// editor's getHTML) typesets correctly in the printed PDF. Pinned to the
// installed KaTeX version.
const KATEX_STYLESHEET =
  '<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.47/dist/katex.min.css">';

function wrapHtmlDocument(title: string, bodyHtml: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title,
  )}</title>${KATEX_STYLESHEET}<style>${PRINT_STYLES}</style></head><body>${bodyHtml}</body></html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Save the raw markdown as a `.md` file. */
export function downloadMarkdown(name: string, markdown: string) {
  const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
  triggerDownload(blob, `${baseFileName(name)}.md`);
}

/* The blob type rides into the saved file's registered type on some
   platforms — a CSV saved as text/plain won't open in a spreadsheet app.
   Anything unlisted stays text/plain, which every text file survives. */
const DOWNLOAD_MIME_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  html: "text/html",
  htm: "text/html",
  ics: "text/calendar",
  json: "application/json",
  md: "text/markdown",
  svg: "image/svg+xml",
  tsv: "text/tab-separated-values",
  xml: "text/xml",
};

/** Save a code document exactly as authored under its original filename. */
export function downloadCodeFile(name: string, content: string) {
  const safeName =
    name
      .split(/[\\/]/)
      .pop()
      ?.replace(/[\u0000-\u001f<>:"|?*]/g, "-")
      .replace(/[. ]+$/g, "")
      .trim() || "untitled.txt";
  const extension = safeName.slice(safeName.lastIndexOf(".") + 1).toLowerCase();
  const mime = DOWNLOAD_MIME_BY_EXTENSION[extension] ?? "text/plain";
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  triggerDownload(blob, safeName);
}

/** Convert the editor's HTML to a Word document and save it as `.docx`. */
export async function downloadDocx(name: string, html: string) {
  const result = await asBlob(wrapHtmlDocument(baseFileName(name), html));
  // In the browser asBlob returns a Blob; the Buffer branch is Node-only.
  const blob =
    result instanceof Blob
      ? result
      : new Blob([new Uint8Array(result as Uint8Array)], {
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
  triggerDownload(blob, `${baseFileName(name)}.docx`);
}

/**
 * Render the document into a hidden iframe and open the print dialog, where the
 * browser's "Save as PDF" produces a crisp, selectable-text PDF — no heavyweight
 * client-side PDF dependency required.
 */
export function downloadPdf(name: string, html: string) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  const win = iframe.contentWindow;
  if (!doc || !win) {
    iframe.remove();
    return;
  }

  doc.open();
  doc.write(wrapHtmlDocument(baseFileName(name), html));
  doc.close();

  let settled = false;
  const print = () => {
    if (settled) return;
    settled = true;
    try {
      win.focus();
      win.print();
    } finally {
      // Give the print dialog time to grab the document before we tear it
      // down — and tear it down even when print() throws, so a failed
      // export never leaves an orphaned document in the body.
      setTimeout(() => iframe.remove(), 1000);
    }
  };

  if (doc.readyState === "complete") {
    print();
  } else {
    win.addEventListener("load", print, { once: true });
    // A load that never fires must not strand the hidden frame either.
    setTimeout(() => {
      if (settled) return;
      settled = true;
      iframe.remove();
    }, 10_000);
  }
}
