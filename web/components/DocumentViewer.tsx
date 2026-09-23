"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { sanitizeSubmissionHtml } from "@/lib/submission-html";
import { Icon, ICON, Spinner } from "./ui";

/**
 * Schoology's files, read inside Slates.
 *
 * This used to be an `<iframe>` pointed at the bytes, which handed the job to
 * Chromium's built-in PDF plugin. That worked in the sense that pixels
 * appeared, and failed at everything else: a grey browser toolbar with its own
 * hamburger, print and annotate buttons sitting inside the app, a thumbnail
 * rail taking a third of the width with no way to close it from here, a
 * default zoom of 52% that made a syllabus unreadable, and a title bar showing
 * whatever string the PDF had buried in its metadata rather than the name of
 * the file you clicked.
 *
 * So the document is drawn here instead. pdf.js was already a dependency —
 * the tutor uses it to read attachments — and rendering to our own canvas
 * means the page is the only thing on screen that isn't ours.
 *
 * Pages render as you reach them rather than all at once: a fourteen-page
 * slide deck is four thousand canvas pixels tall per page at this density, and
 * drawing all of it up front is a visible freeze for a document you are going
 * to read one page at a time.
 */

type Doc =
  | { kind: "pdf"; pages: number }
  | { kind: "image"; url: string }
  | { kind: "text"; body: string }
  /** A Word file, converted to HTML server-side and sanitized here. */
  | { kind: "html"; body: string }
  | { kind: "other" };

interface PdfPage {
  getViewport(opts: { scale: number }): { width: number; height: number };
  render(opts: Record<string, unknown>): { promise: Promise<void>; cancel(): void };
  getTextContent(): Promise<unknown>;
  cleanup?: () => void;
}

interface PdfDoc {
  numPages: number;
  getPage(n: number): Promise<PdfPage>;
  destroy(): Promise<void>;
}

/** Zoom stops, in the order the buttons step through them. */
const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];

export interface DocumentViewerProps {
  /** Attachment path on Schoology; fetched back through the scraper. */
  path: string;
  title: string;
  /** Content type when Slates can draw it, null when it belongs in a browser. */
  inlineType: string | null;
  /** Link out, for the cases this viewer deliberately doesn't handle. */
  schoologyUrl?: string;
  domain?: string;
  /** Human size ("456 KB"), shown in the fallback where it helps you decide. */
  size?: string;
  /**
   * `page` fills its container and scrolls internally — the Classes reader.
   * `inline` sits in a scrolling page and takes a fixed, comfortable height —
   * an attachment opened underneath an assignment.
   */
  variant?: "page" | "inline";
}

export default function DocumentViewer({
  path,
  title,
  inlineType,
  schoologyUrl,
  domain,
  size,
  variant = "page",
}: DocumentViewerProps) {
  const src = `/api/materials/file?path=${encodeURIComponent(path)}`;

  const [doc, setDoc] = useState<Doc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [page, setPage] = useState(1);

  const pdfRef = useRef<PdfDoc | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /*
   * The bytes are fetched once and kept, rather than letting the canvas and a
   * download link each ask for them. These come through the scraper's
   * authenticated session, so a second request is a second round trip to
   * Schoology for something we are already holding.
   */
  const blobUrl = useRef<string | null>(null);

  /*
   * No state is reset here on purpose. Callers pass `key={path}`, so opening a
   * different file remounts this and every piece of state starts fresh — which
   * is React's own answer to "reset when the input changes", and avoids the
   * frame where the new file is being fetched while the old one is still drawn.
   */
  useEffect(() => {
    let live = true;

    (async () => {
      try {
        if (!inlineType) {
          if (live) setDoc({ kind: "other" });
          return;
        }

        /*
         * Word goes through the converter rather than the raw bytes: nothing
         * in a browser can draw a .docx, so the server turns it into HTML and
         * this sanitizes it with the same whitelist a pasted submission gets.
         */
        if (inlineType.includes("wordprocessingml")) {
          const res = await fetch(`/api/materials/docx?path=${encodeURIComponent(path)}`, {
            cache: "no-store",
          });
          const body = (await res.json()) as { html?: string; error?: string };
          if (!live) return;
          if (!res.ok || body.error || !body.html) {
            throw new Error(body.error ?? `Converting it failed (${res.status}).`);
          }
          setDoc({ kind: "html", body: sanitizeSubmissionHtml(body.html) });
          return;
        }

        const res = await fetch(src, { cache: "no-store" });
        if (!res.ok) throw new Error(`Schoology returned ${res.status} for this file.`);
        const buffer = await res.arrayBuffer();
        if (!live) return;

        if (inlineType.startsWith("image/")) {
          const url = URL.createObjectURL(new Blob([buffer], { type: inlineType }));
          blobUrl.current = url;
          setDoc({ kind: "image", url });
          return;
        }

        if (inlineType.startsWith("text/")) {
          setDoc({ kind: "text", body: new TextDecoder().decode(buffer) });
          return;
        }

        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          "pdfjs-dist/build/pdf.worker.min.mjs",
          import.meta.url
        ).toString();

        const loaded = (await pdfjs.getDocument({ data: buffer }).promise) as unknown as PdfDoc;
        if (!live) {
          void loaded.destroy();
          return;
        }
        pdfRef.current = loaded;
        setDoc({ kind: "pdf", pages: loaded.numPages });
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : "That file wouldn't open.");
      }
    })();

    return () => {
      live = false;
      if (blobUrl.current) {
        URL.revokeObjectURL(blobUrl.current);
        blobUrl.current = null;
      }
      const open = pdfRef.current;
      pdfRef.current = null;
      if (open) void open.destroy();
    };
  }, [src, inlineType]);

  const pages = doc?.kind === "pdf" ? doc.pages : 0;

  const goTo = useCallback((n: number) => {
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    el?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, []);

  const stepZoom = useCallback((direction: 1 | -1) => {
    setZoom((current) => {
      // "Fit" has no position in the list, so stepping from it starts at 100%
      // — the stop a reader means when they reach for the zoom buttons.
      if (current === "fit") return direction === 1 ? 1.25 : 0.75;
      const i = ZOOMS.indexOf(current);
      const next = i === -1 ? 1 : Math.min(ZOOMS.length - 1, Math.max(0, i + direction));
      return ZOOMS[next];
    });
  }, []);

  // Arrow keys and ⌘+/− while the reader has focus, which is what anyone who
  // reads a PDF reaches for first.
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "=" || e.key === "+") {
          e.preventDefault();
          stepZoom(1);
        } else if (e.key === "-") {
          e.preventDefault();
          stepZoom(-1);
        } else if (e.key === "0") {
          e.preventDefault();
          setZoom("fit");
        }
        return;
      }
      if (e.key === "ArrowRight" || e.key === "PageDown") {
        e.preventDefault();
        goTo(Math.min(pages, page + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        goTo(Math.max(1, page - 1));
      }
    },
    [goTo, page, pages, stepZoom]
  );

  const openHref = useMemo(() => {
    if (!schoologyUrl) return null;
    try {
      return new URL(schoologyUrl, domain ? `https://${domain}` : undefined).href;
    } catch {
      return null;
    }
  }, [schoologyUrl, domain]);

  return (
    <div
      className={`docview docview--${variant}`}
      onKeyDown={onKeyDown}
      tabIndex={-1}
      role="group"
      aria-label={title}
    >
      <div className="docview-bar">
        <span className="docview-name truncate" title={title}>
          {title}
        </span>

        {doc?.kind === "pdf" && (
          <>
            <span className="docview-sep" />
            <div className="docview-pager">
              <button
                type="button"
                className="docview-btn"
                onClick={() => goTo(Math.max(1, page - 1))}
                disabled={page <= 1}
                aria-label="Previous page"
              >
                <Icon path={ICON.chevronDown} size={13} style={{ transform: "rotate(180deg)" }} />
              </button>
              <span className="docview-count">
                {page} <span className="docview-of">/ {pages}</span>
              </span>
              <button
                type="button"
                className="docview-btn"
                onClick={() => goTo(Math.min(pages, page + 1))}
                disabled={page >= pages}
                aria-label="Next page"
              >
                <Icon path={ICON.chevronDown} size={13} />
              </button>
            </div>
          </>
        )}

        {(doc?.kind === "pdf" || doc?.kind === "image") && (
          <>
            <span className="docview-sep" />
            <div className="docview-pager">
              <button
                type="button"
                className="docview-btn"
                onClick={() => stepZoom(-1)}
                aria-label="Zoom out"
              >
                <Icon path={ICON.minus} size={13} />
              </button>
              <button
                type="button"
                className="docview-zoom"
                onClick={() => setZoom((z) => (z === "fit" ? 1 : "fit"))}
                title="Fit to width"
              >
                {zoom === "fit" ? "Fit" : `${Math.round(zoom * 100)}%`}
              </button>
              <button
                type="button"
                className="docview-btn"
                onClick={() => stepZoom(1)}
                aria-label="Zoom in"
              >
                <Icon path={ICON.plus} size={13} />
              </button>
            </div>
          </>
        )}

        <span style={{ flex: 1 }} />

        <a className="docview-btn" href={src} download={title} title="Download">
          <Icon path={ICON.download} size={13} />
        </a>
        {openHref && (
          <a
            className="docview-btn"
            href={openHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open in Schoology"
          >
            <Icon path={ICON.external} size={13} />
          </a>
        )}
      </div>

      <div className="docview-stage" ref={scrollRef}>
        {error && (
          <div className="docview-note">
            <Icon path={ICON.alert} size={15} />
            <p>{error}</p>
            <a className="btn btn--quiet" href={src} download={title}>
              Download it instead
            </a>
          </div>
        )}

        {!error && !doc && (
          <div className="docview-note">
            <Spinner size={16} />
            <p>Opening {title}…</p>
          </div>
        )}

        {doc?.kind === "pdf" && (
          <PdfPages
            docRef={pdfRef}
            pages={doc.pages}
            zoom={zoom}
            scrollRef={scrollRef}
            onPage={setPage}
          />
        )}

        {doc?.kind === "image" && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="docview-image"
            src={doc.url}
            alt={title}
            style={zoom === "fit" ? undefined : { width: `${zoom * 100}%`, maxWidth: "none" }}
          />
        )}

        {doc?.kind === "text" && <pre className="docview-text">{doc.body}</pre>}

        {doc?.kind === "html" && (
          <div
            /* Deliberately not `prose`: that is written for Slates' dark
               background and rendered the handout's bold headings in a light
               grey that vanished on white paper. */
            className="docview-doc"
            // Sanitized above, through the submission whitelist.
            dangerouslySetInnerHTML={{ __html: doc.body }}
          />
        )}

        {doc?.kind === "other" && (
          <div className="docview-note">
            <Icon path={ICON.file} size={18} />
            <p>
              Slates doesn&apos;t draw {extensionOf(title) ? `${extensionOf(title)} files` : "this kind of file"} yet
              {size ? ` — it's ${size}.` : "."}
            </p>
            <div style={{ display: "flex", gap: 8 }}>
              <a className="btn" href={src} download={title}>
                <Icon path={ICON.download} size={13} />
                Download
              </a>
              {openHref && (
                <a className="btn btn--quiet" href={openHref} target="_blank" rel="noopener noreferrer">
                  <Icon path={ICON.external} size={13} />
                  Open in Schoology
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function extensionOf(name: string): string {
  const m = /\.([a-z0-9]{1,5})$/i.exec(name.trim());
  return m ? `.${m[1].toLowerCase()}` : "";
}

/**
 * The pages themselves.
 *
 * Each page gets a placeholder of the right shape immediately, so the scroll
 * height is correct from the start and the scrollbar doesn't grow under your
 * thumb while you read. The canvas is filled in when the page comes near the
 * viewport, and thrown away again when it is far from it — a hundred-page
 * document would otherwise hold a hundred full-resolution bitmaps.
 */
function PdfPages({
  docRef,
  pages,
  zoom,
  scrollRef,
  onPage,
}: {
  docRef: React.RefObject<PdfDoc | null>;
  pages: number;
  zoom: number | "fit";
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPage: (n: number) => void;
}) {
  const [shapes, setShapes] = useState<Array<{ width: number; height: number }>>([]);
  const [onScreen, setOnScreen] = useState<Set<number>>(new Set([1]));
  const [width, setWidth] = useState(0);

  // The width available to a page, which is what "fit" means.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth - 48);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [scrollRef]);

  // Natural page sizes, read once, so every placeholder is the right shape
  // before anything is drawn.
  useEffect(() => {
    let live = true;
    (async () => {
      const doc = docRef.current;
      if (!doc) return;
      const out: Array<{ width: number; height: number }> = [];
      for (let i = 1; i <= pages; i++) {
        const p = await doc.getPage(i);
        const v = p.getViewport({ scale: 1 });
        out.push({ width: v.width, height: v.height });
      }
      if (live) setShapes(out);
    })();
    return () => {
      live = false;
    };
  }, [docRef, pages]);

  useEffect(() => {
    if (onScreen.size > 0) onPage(Math.min(...onScreen));
  }, [onScreen, onPage]);

  const toDraw = useMemo(() => {
    const set = new Set<number>();
    for (const n of onScreen.size > 0 ? onScreen : [1]) {
      set.add(n);
      if (n > 1) set.add(n - 1);
      if (n < pages) set.add(n + 1);
    }
    return set;
  }, [onScreen, pages]);

  const scale = useCallback(
    (i: number) => {
      const shape = shapes[i];
      if (!shape || !width) return 1;
      const fit = width / shape.width;
      return zoom === "fit" ? fit : fit * zoom;
    },
    [shapes, width, zoom]
  );

  // Which page you're on, and which ones are worth drawing.
  useEffect(() => {
    const root = scrollRef.current;
    if (!root || shapes.length === 0) return;

    const io = new IntersectionObserver(
      (entries) => {
        /*
         * An observer callback carries only the pages whose visibility just
         * changed, not everything on screen. Taking the minimum of that batch
         * reported whichever page had crossed the edge — which is how clicking
         * "next" once from page 1 announced page 3. So the full set is kept
         * here and the counter reads the top of it.
         */
        setOnScreen((prev) => {
          const next = new Set(prev);
          for (const e of entries) {
            const n = Number((e.target as HTMLElement).dataset.page);
            if (e.isIntersecting) next.add(n);
            else next.delete(n);
          }
          return next;
        });
      },
      { root, rootMargin: "-45% 0px -45% 0px" }
    );

    for (const el of root.querySelectorAll("[data-page]")) io.observe(el);
    return () => io.disconnect();
  }, [scrollRef, shapes.length, pages, onPage]);

  return (
    <div className="docview-pages">
      {shapes.map((shape, i) => {
        const s = scale(i);
        return (
          <div
            key={i}
            data-page={i + 1}
            className="docview-page"
            style={{ width: shape.width * s, height: shape.height * s }}
          >
            {toDraw.has(i + 1) && <PageCanvas docRef={docRef} number={i + 1} scale={s} />}
          </div>
        );
      })}
    </div>
  );
}

/** One page, drawn at the screen's real pixel density so text stays sharp. */
function PageCanvas({
  docRef,
  number,
  scale,
}: {
  docRef: React.RefObject<PdfDoc | null>;
  number: number;
  scale: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const doc = docRef.current;
    if (!canvas || !doc || !scale) return;

    let cancelled = false;
    let task: { cancel(): void } | null = null;

    (async () => {
      const page = await doc.getPage(number);
      if (cancelled) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const viewport = page.getViewport({ scale: scale * dpr });
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      canvas.style.width = "100%";
      canvas.style.height = "100%";

      const render = page.render({ canvasContext: ctx, viewport, canvas });
      task = render;
      try {
        await render.promise;
      } catch {
        // Cancelled because the zoom changed or the page scrolled away.
      }
    })();

    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [docRef, number, scale]);

  return <canvas ref={ref} className="docview-canvas" />;
}
