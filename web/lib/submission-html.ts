import { marked } from "marked";

/**
 * Turning what you typed into what Schoology stores.
 *
 * Schoology's response box is a TinyMCE editor, so a submission is HTML, not
 * plain text — which means the formatting was always possible and Slates was
 * just throwing it away. A pasted link arrived as dead text, paragraphs
 * collapsed, and there was no way to write a list.
 *
 * Markdown is the authoring surface rather than a rich-text editor for two
 * reasons. It keeps the saved draft plain text, so nothing is lost if a
 * submission fails and the draft is all you have. And it is already the app's
 * idiom — the tutor writes it, the counselor's documents are it — so there is
 * one thing to learn instead of two.
 *
 * The same function renders the preview and builds the payload, so the preview
 * is not an approximation of what gets submitted: it is the identical string.
 */

/** Tags Schoology's editor keeps. Anything else is unwrapped, not dropped. */
const ALLOWED = new Set([
  "P", "BR", "SPAN", "DIV", "B", "I", "STRONG", "EM", "U", "S", "STRIKE", "A",
  "UL", "OL", "LI", "H1", "H2", "H3", "H4", "BLOCKQUOTE", "CODE", "PRE", "HR",
  "SUB", "SUP", "TABLE", "THEAD", "TBODY", "TR", "TH", "TD",
]);

/** Attributes worth carrying. Everything else — class, id, on* — is dropped. */
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  A: new Set(["href", "title", "target", "rel", "style"]),
  TH: new Set(["colspan", "rowspan", "style"]),
  TD: new Set(["colspan", "rowspan", "style"]),
};

/** Every element may carry a style, filtered down to the declarations below. */
const STYLE_EVERYWHERE = new Set([
  "SPAN", "DIV", "P", "H1", "H2", "H3", "H4", "LI", "UL", "OL", "BLOCKQUOTE",
  "STRONG", "EM", "U", "S", "B", "I",
]);

/**
 * The CSS a submission is allowed to carry.
 *
 * Restricted to declarations that change how the words look, and each value is
 * pattern-matched rather than passed through. That rules out `url(...)`,
 * `expression(...)`, and anything positional — a submission has no business
 * loading a resource or laying itself over the page it's rendered in, and
 * Schoology renders this markup inside a teacher's gradebook.
 */
const STYLE_RULES: Record<string, RegExp> = {
  // Families are quoted names and generic keywords; no parens, so no url().
  "font-family": /^[\w\s'",-]+$/,
  "font-size": /^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/, // bounded further in safeStyle
  "font-weight": /^(normal|bold|[1-9]00)$/,
  "font-style": /^(normal|italic)$/,
  "text-decoration": /^(none|underline|line-through|underline line-through)$/,
  "text-decoration-line": /^(none|underline|line-through)$/,
  "text-align": /^(left|center|right|justify)$/,
  color: /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|[a-z]+)$/i,
  "background-color": /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|[a-z]+)$/i,
};

/** Keeps only the declarations above, with values that match their pattern. */
function safeStyle(raw: string): string {
  const kept: string[] = [];
  for (const part of raw.split(";")) {
    const at = part.indexOf(":");
    if (at === -1) continue;
    const prop = part.slice(0, at).trim().toLowerCase();
    const value = part.slice(at + 1).trim();
    const rule = STYLE_RULES[prop];
    if (!rule || !value || value.length > 120) continue;
    // Belt and braces: neither can appear in any allowed value anyway.
    if (/url\(|expression\(|javascript:/i.test(value)) continue;
    if (!rule.test(value)) continue;

    /*
     * A size cap, because the pattern alone let `font-size: 400px` through.
     * Nothing about that is dangerous, but it renders inside a teacher's
     * gradebook and a submission has no business shouting over the page
     * around it.
     */
    if (prop === "font-size") {
      const n = parseFloat(value);
      const unit = value.replace(/[\d.]/g, "");
      const max: Record<string, number> = { px: 48, pt: 36, em: 3, rem: 3, "%": 300 };
      if (!Number.isFinite(n) || n <= 0 || n > (max[unit] ?? 0)) continue;
    }

    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}

/**
 * A link Slates is willing to write.
 *
 * `javascript:` and `data:` are the two that turn a link into an execution
 * vector, and this HTML is being injected into a page authenticated as the
 * student. Anything not plainly http(s) or mailto loses its href and survives
 * as text — the words are still theirs, the link just isn't live.
 */
function safeHref(raw: string): string | null {
  const href = raw.trim();
  if (/^(https?:|mailto:)/i.test(href)) return href;
  // A bare domain typed without a scheme is the common case, not an attack.
  if (/^[\w-]+(\.[\w-]+)+(\/|$)/.test(href)) return `https://${href}`;
  return null;
}

/**
 * Rebuilds a parsed tree keeping only what's allowed.
 *
 * Unknown elements are unwrapped rather than deleted: a `<div>` marked's
 * extensions might emit still contains the student's words, and silently
 * eating a paragraph of someone's homework is the worst possible failure here.
 */
function clean(node: Node, out: Node[], doc: Document): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      out.push(doc.createTextNode(child.nodeValue ?? ""));
      continue;
    }
    if (child.nodeType !== 1) continue;

    const el = child as Element;
    const tag = el.tagName.toUpperCase();

    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") {
      // These hold code, not prose. Unwrapping them the way an unknown tag is
      // unwrapped would drop `alert(1)` into the submission as visible text.
      continue;
    }

    if (!ALLOWED.has(tag)) {
      clean(el, out, doc);
      continue;
    }

    const copy = doc.createElement(tag.toLowerCase());

    if (STYLE_EVERYWHERE.has(tag) || ALLOWED_ATTRS[tag]?.has("style")) {
      const style = safeStyle(el.getAttribute("style") ?? "");
      if (style) copy.setAttribute("style", style);
    }

    const attrs = ALLOWED_ATTRS[tag];
    if (attrs) {
      for (const attr of Array.from(el.attributes)) {
        if (!attrs.has(attr.name.toLowerCase())) continue;
        if (attr.name.toLowerCase() === "href") {
          const href = safeHref(attr.value);
          if (href) copy.setAttribute("href", href);
          continue;
        }
        copy.setAttribute(attr.name, attr.value);
      }
      // A link that lost its href is no longer a link; keep the words.
      if (tag === "A" && !copy.getAttribute("href")) {
        clean(el, out, doc);
        continue;
      }
      // Submissions are read in a browser, and a teacher clicking a link
      // shouldn't lose the page they're marking from.
      if (tag === "A") {
        copy.setAttribute("target", "_blank");
        copy.setAttribute("rel", "noopener noreferrer");
      }
    }

    const kids: Node[] = [];
    clean(el, kids, doc);

    // A span or div that ended up carrying no styling is pure noise —
    // contenteditable emits piles of them — so unwrap rather than nest.
    if ((tag === "SPAN" || tag === "DIV") && !copy.getAttribute("style")) {
      for (const kid of kids) out.push(kid);
      continue;
    }

    for (const kid of kids) copy.appendChild(kid);
    out.push(copy);
  }
}

/** Escapes text for the no-DOM fallback below. */
function escapeText(text: string): string {
  return text.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] as string);
}

/**
 * Markdown to the HTML Schoology will store.
 *
 * GFM is on, which is what makes a pasted URL become a real link without the
 * student writing link syntax around it — the single most common thing a
 * submission needs.
 */
export function toSubmissionHtml(markdown: string): string {
  const source = markdown.trim();
  if (!source) return "";

  const raw = marked.parse(source, { gfm: true, breaks: true, async: false }) as string;

  // Server-side (or anywhere without DOM) there is nothing to parse with, and
  // this is only ever called from the browser — but returning escaped
  // paragraphs beats returning unsanitised markup if that ever changes.
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return source
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeText(p).replace(/\n/g, "<br>")}</p>`)
      .join("");
  }

  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, "text/html");
  const kept: Node[] = [];
  clean(doc.body, kept, doc);

  const holder = doc.createElement("div");
  for (const node of kept) holder.appendChild(node);
  return holder.innerHTML.trim();
}

/**
 * Cleans HTML the editor produced.
 *
 * `contenteditable` emits whatever the browser felt like — nested spans,
 * `<font>` tags, stray `<div>`s, styles copied wholesale from a page the
 * student pasted from. This puts all of it through the same whitelist the
 * markdown path uses, so both routes into a submission are sanitised by one
 * piece of code rather than two that can drift apart.
 */
export function sanitizeSubmissionHtml(html: string): string {
  if (!html.trim()) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return "";

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  // execCommand still emits <font> on some paths. Rewrite to a styled span
  // before the whitelist sees it, or the formatting is silently discarded.
  for (const font of Array.from(doc.querySelectorAll("font"))) {
    const span = doc.createElement("span");
    const bits: string[] = [];
    const face = font.getAttribute("face");
    const color = font.getAttribute("color");
    if (face) bits.push(`font-family: ${face}`);
    if (color) bits.push(`color: ${color}`);
    const existing = font.getAttribute("style");
    if (existing) bits.push(existing);
    if (bits.length) span.setAttribute("style", bits.join("; "));
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  }

  const kept: Node[] = [];
  clean(doc.body, kept, doc);
  const holder = doc.createElement("div");
  for (const node of kept) holder.appendChild(node);
  return holder.innerHTML.trim();
}

/**
 * Bare URLs in the text, turned into links.
 *
 * The editor's promise — "paste a link and it becomes clickable" — was being
 * kept by Chromium, not by us: a contenteditable auto-links a paste only when
 * the clipboard holds a URL and nothing else. Paste "and: https://…" and the
 * browser does nothing, which is why one link in a submission would be live
 * and the next one plain text.
 *
 * Walks text nodes so it can skip the inside of an existing `<a>` — otherwise
 * running twice would nest a link inside a link — and never sees attribute
 * values, so an href is not a candidate for linking to itself.
 */
const BARE_URL =
  /\b(?:https?:\/\/|www\.)[^\s<>"']+|\b[\w.-]+@[\w-]+\.[\w.-]+\b/gi;

/** Trailing punctuation belongs to the sentence, not the address. */
function trimUrlTail(url: string): { url: string; tail: string } {
  const match = /[.,;:!?)\]}'"]+$/.exec(url);
  if (!match) return { url, tail: "" };
  // A closing bracket is only punctuation if the URL has no opening one.
  let cut = match[0];
  if (cut.includes(")") && url.includes("(") && !url.slice(0, -cut.length).includes(")")) {
    cut = cut.replace(/\)+$/, "");
  }
  return cut ? { url: url.slice(0, url.length - cut.length), tail: cut } : { url, tail: "" };
}

export function linkifyHtml(html: string): string {
  if (!html.trim()) return html;
  if (typeof window === "undefined" || typeof DOMParser === "undefined") return html;

  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);

  const targets: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.nodeValue || !/https?:\/\/|www\.|@/.test(text.nodeValue)) continue;
    // Already inside a link, or inside something that is not prose.
    if (text.parentElement?.closest("a, code, pre")) continue;
    targets.push(text);
  }

  for (const text of targets) {
    const source = text.nodeValue ?? "";
    const fragment = doc.createDocumentFragment();
    let last = 0;
    BARE_URL.lastIndex = 0;

    for (let m = BARE_URL.exec(source); m; m = BARE_URL.exec(source)) {
      const { url, tail } = trimUrlTail(m[0]);
      if (!url) continue;

      const href = url.includes("@") && !/^https?:/i.test(url) ? `mailto:${url}` : safeHref(url);
      if (!href) continue;

      if (m.index > last) fragment.appendChild(doc.createTextNode(source.slice(last, m.index)));
      const anchor = doc.createElement("a");
      anchor.setAttribute("href", href);
      anchor.textContent = url;
      fragment.appendChild(anchor);
      if (tail) fragment.appendChild(doc.createTextNode(tail));
      last = m.index + m[0].length;
    }

    if (last === 0) continue;
    if (last < source.length) fragment.appendChild(doc.createTextNode(source.slice(last)));
    text.replaceWith(fragment);
  }

  return doc.body.innerHTML;
}

/**
 * The words without the markup.
 *
 * Needed because Schoology's *upload* tab has a plain comment field rather
 * than an editor — a submission with a file attached puts the written part
 * there, and it would otherwise receive a wall of tags.
 */
export function htmlToPlainText(html: string): string {
  if (!html.trim()) return "";
  if (typeof window === "undefined" || typeof DOMParser === "undefined") {
    return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  // Block elements have to become line breaks or every paragraph runs together.
  for (const el of Array.from(doc.querySelectorAll("p, div, li, br, h1, h2, h3, h4, tr"))) {
    el.after(doc.createTextNode("\n"));
  }
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Whether a saved draft is HTML, or plain text from before the editor existed. */
export function looksLikeHtml(value: string): boolean {
  return /<(p|div|span|br|ul|ol|li|h[1-4]|strong|em|b|i|u|s|a|blockquote)\b/i.test(value);
}
