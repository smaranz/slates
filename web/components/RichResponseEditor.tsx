"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { linkifyHtml, looksLikeHtml, sanitizeSubmissionHtml, toSubmissionHtml } from "@/lib/submission-html";
import { Icon, ICON } from "./ui";

/**
 * The written response, as rich text.
 *
 * Schoology stores a submission as HTML and its own editor offers fonts,
 * sizes and colours, so a plain textarea was throwing away formatting the
 * platform already supported. Markdown got structure and links back; this gets
 * the rest, which markdown has no way to express.
 *
 * `contenteditable` rather than a bundled editor: the whole feature is a
 * toolbar over a field, and shipping a rich-text framework for it would cost
 * more than the feature is worth. `execCommand` is deprecated but it is what
 * every browser still implements for exactly this, and the alternative —
 * hand-rolled Range surgery for every command — is a great deal more code
 * with more ways to corrupt someone's homework.
 *
 * Everything typed here is sanitised on the way out, so what the browser
 * emits internally never matters: only what survives the whitelist is stored.
 */

const FONTS = [
  { label: "Default", value: "" },
  { label: "Sans serif", value: "Arial, Helvetica, sans-serif" },
  { label: "Serif", value: "Georgia, 'Times New Roman', serif" },
  { label: "Mono", value: "'Courier New', monospace" },
  { label: "Rounded", value: "'Trebuchet MS', sans-serif" },
  { label: "Condensed", value: "'Arial Narrow', sans-serif" },
];

const SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "" },
  { label: "Large", value: "20px" },
  { label: "Huge", value: "28px" },
];

/** Readable on white, which is what a teacher's gradebook is. */
const COLORS = [
  "#111827", "#b91c1c", "#c2410c", "#a16207",
  "#15803d", "#1d4ed8", "#6d28d9", "#be185d",
];

const HIGHLIGHTS = ["#fef08a", "#bbf7d0", "#bfdbfe", "#fecaca", "#e9d5ff", "transparent"];

export default function RichResponseEditor({
  value,
  onChange,
  readOnly,
}: {
  value: string;
  onChange: (next: string) => void;
  readOnly?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [menu, setMenu] = useState<"font" | "size" | "color" | "highlight" | null>(null);

  /*
   * The editor owns its own DOM once it's mounted. Writing `value` back into
   * it on every render would move the caret to the start on every keystroke,
   * so the prop is only pushed in when it differs from what's already there —
   * which happens on mount, and when a different assignment is opened.
   */
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const incoming = looksLikeHtml(value) ? value : toSubmissionHtml(value);
    if (el.innerHTML !== incoming) el.innerHTML = incoming;
    // `value` is deliberately the only dependency: this is a sync from props
    // into an uncontrolled node, not a render.
  }, [value]);

  // Any click outside closes an open swatch menu.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menu]);

  const push = useCallback(() => {
    const el = ref.current;
    if (el) onChange(el.innerHTML);
  }, [onChange]);

  /*
   * Link the bare URLs, on the way out of the field rather than as you type.
   *
   * Rewriting the HTML under a live caret moves it — mid-URL, every keystroke.
   * Blur is the moment nothing is being typed, so the text can be replaced
   * wholesale without anyone losing their place.
   */
  const linkifyAndPush = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const linked = linkifyHtml(el.innerHTML);
    if (linked !== el.innerHTML) el.innerHTML = linked;
    onChange(el.innerHTML);
  }, [onChange]);

  /** Runs a command against the selection, keeping focus in the field. */
  const run = useCallback(
    (command: string, arg?: string) => {
      const el = ref.current;
      if (!el || readOnly) return;
      el.focus();
      // Produces styled spans rather than <font> tags, which survive the
      // whitelist intact instead of needing to be rewritten.
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, arg);
      push();
    },
    [push, readOnly]
  );

  /**
   * Wraps the selection in a styled span.
   *
   * `execCommand("fontSize")` only speaks the legacy 1-7 scale and
   * `fontName` is inconsistent across browsers, so size and family are applied
   * directly. An empty value means "clear it", which unwraps rather than
   * setting a style that would fight an outer one.
   */
  const style = useCallback(
    (prop: "fontFamily" | "fontSize", cssValue: string) => {
      const el = ref.current;
      if (!el || readOnly) return;
      el.focus();

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
        // Nothing selected: apply to the whole field, which is what someone
        // picking a font before typing anything means.
        const all = document.createRange();
        all.selectNodeContents(el);
        selection?.removeAllRanges();
        selection?.addRange(all);
      }

      const range = window.getSelection()?.getRangeAt(0);
      if (!range || range.collapsed) return;

      const span = document.createElement("span");
      span.style[prop] = cssValue;
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
        // Leave the same text selected so a second choice stacks on the first.
        const after = document.createRange();
        after.selectNodeContents(span);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(after);
      } catch {
        // A selection spanning partial elements can refuse to be surrounded.
        // Losing the format is acceptable; losing the text is not.
      }
      push();
    },
    [push, readOnly]
  );

  function link() {
    const el = ref.current;
    if (!el || readOnly) return;
    const selection = window.getSelection();
    const selected = selection?.toString().trim() ?? "";
    const href = window.prompt("Link to:", /^https?:\/\//i.test(selected) ? selected : "https://");
    if (!href) return;
    const safe = /^(https?:|mailto:)/i.test(href) ? href : `https://${href.replace(/^\/+/, "")}`;
    if (!selected) {
      run("insertHTML", `<a href="${safe}">${safe}</a>`);
      return;
    }
    run("createLink", safe);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <span className="section-label">Written response</span>

      {!readOnly && (
        <div className="response-toolbar" onMouseDown={(e) => e.stopPropagation()}>
          <Tool hint={"Bold  ⌘B"} onRun={() => run("bold")}>{<strong>B</strong>}</Tool>
          <Tool hint={"Italic  ⌘I"} onRun={() => run("italic")}>{<em style={{ fontFamily: "Georgia, serif" }}>I</em>}</Tool>
          <Tool hint={"Underline  ⌘U"} onRun={() => run("underline")}>{<span style={{ textDecoration: "underline" }}>U</span>}</Tool>
          <Tool hint={"Strikethrough"} onRun={() => run("strikeThrough")}>{<span style={{ textDecoration: "line-through" }}>S</span>}</Tool>

          <span className="response-sep" />

          <Picker
            open={menu === "font"}
            onOpen={() => setMenu(menu === "font" ? null : "font")}
            hint="Font"
            trigger={<span style={{ fontSize: 12 }}>Font</span>}
          >
            {FONTS.map((font) => (
              <button
                key={font.label}
                type="button"
                className="response-option"
                style={{ fontFamily: font.value || "inherit" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  style("fontFamily", font.value);
                  setMenu(null);
                }}
              >
                {font.label}
              </button>
            ))}
          </Picker>

          <Picker
            open={menu === "size"}
            onOpen={() => setMenu(menu === "size" ? null : "size")}
            hint="Text size"
            trigger={<span style={{ fontSize: 12 }}>Size</span>}
          >
            {SIZES.map((size) => (
              <button
                key={size.label}
                type="button"
                className="response-option"
                style={{ fontSize: size.value || "13px" }}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  style("fontSize", size.value);
                  setMenu(null);
                }}
              >
                {size.label}
              </button>
            ))}
          </Picker>

          <Picker
            open={menu === "color"}
            onOpen={() => setMenu(menu === "color" ? null : "color")}
            hint="Text colour"
            trigger={<span className="response-swatch" style={{ background: "#1d4ed8" }} />}
          >
            <span className="response-swatches">
              {COLORS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="response-swatch is-button"
                  style={{ background: color }}
                  aria-label={`Text colour ${color}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    run("foreColor", color);
                    setMenu(null);
                  }}
                />
              ))}
            </span>
          </Picker>

          <Picker
            open={menu === "highlight"}
            onOpen={() => setMenu(menu === "highlight" ? null : "highlight")}
            hint="Highlight"
            trigger={<span className="response-swatch" style={{ background: "#fef08a" }} />}
          >
            <span className="response-swatches">
              {HIGHLIGHTS.map((color) => (
                <button
                  key={color}
                  type="button"
                  className="response-swatch is-button"
                  style={{
                    background: color,
                    border: color === "transparent" ? "1px dashed var(--line-strong)" : undefined,
                  }}
                  aria-label={color === "transparent" ? "No highlight" : `Highlight ${color}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    run("hiliteColor", color);
                    setMenu(null);
                  }}
                />
              ))}
            </span>
          </Picker>

          <span className="response-sep" />

          <Tool hint={"Link  ⌘K"} onRun={link}>{<Icon path={ICON.external} size={13} />}</Tool>
          <Tool hint={"Bulleted list"} onRun={() => run("insertUnorderedList")}>{<Icon path={ICON.checklist} size={13} />}</Tool>
          <Tool hint={"Numbered list"} onRun={() => run("insertOrderedList")}>{<span style={{ fontSize: 11.5 }}>1.</span>}</Tool>

          <span className="response-sep" />

          <Tool hint={"Align left"} onRun={() => run("justifyLeft")}>{<Align lines={[10, 7, 10, 6]} />}</Tool>
          <Tool hint={"Centre"} onRun={() => run("justifyCenter")}>{<Align lines={[10, 7, 10, 6]} center />}</Tool>
          <Tool hint={"Clear formatting"} onRun={() => run("removeFormat")}>{<Icon path={ICON.close} size={12} />}</Tool>
        </div>
      )}

      <div
        ref={ref}
        className="response-rich prose"
        contentEditable={!readOnly}
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label="Type your response here"
        data-empty={!value.trim() || undefined}
        onInput={push}
        onBlur={linkifyAndPush}
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey)) return;
          const map: Record<string, string> = { b: "bold", i: "italic", u: "underline" };
          const key = e.key.toLowerCase();
          if (key === "k") {
            e.preventDefault();
            link();
          } else if (map[key]) {
            e.preventDefault();
            run(map[key]);
          }
        }}
        onPaste={(e) => {
          // Pasting from a web page drags its entire stylesheet along. Take the
          // HTML, put it through the same whitelist the submission uses, and
          // insert that — so a paste can never carry in more than a typed
          // character could.
          const html = e.clipboardData.getData("text/html");
          if (html) {
            e.preventDefault();
            run("insertHTML", linkifyHtml(sanitizeSubmissionHtml(html)));
            return;
          }

          /*
           * Plain text. The browser links a paste only when the clipboard is a
           * bare URL and nothing else, so "and: https://…" arrived unlinked —
           * which is how one link in a submission ended up live and the next
           * one dead. Escaped first: pasted text must never become markup.
           */
          const text = e.clipboardData.getData("text/plain");
          if (!text || !/https?:\/\/|www\.|@/.test(text)) return;
          e.preventDefault();
          const escaped = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\n/g, "<br>");
          run("insertHTML", linkifyHtml(escaped));
        }}
        style={{ opacity: readOnly ? 0.6 : 1 }}
      />

      {!readOnly && (
        <span className="response-note">
          Formatting is saved with your submission. Paste a link and it becomes clickable.
        </span>
      )}
    </div>
  );
}

/** One toolbar button. */
function Tool({
  hint,
  onRun,
  children,
}: {
  hint: string;
  onRun: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="response-tool"
      title={hint}
      aria-label={hint}
      // Keeps the selection alive: mousedown would otherwise blur the field.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onRun}
    >
      {children}
    </button>
  );
}

/** A toolbar button that opens a small panel under itself. */
function Picker({
  open,
  onOpen,
  hint,
  trigger,
  children,
}: {
  open: boolean;
  onOpen: () => void;
  hint: string;
  trigger: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span className="response-picker">
      <button
        type="button"
        className={`response-tool${open ? " is-on" : ""}`}
        title={hint}
        aria-label={hint}
        aria-expanded={open}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onOpen}
      >
        {trigger}
        <Icon path={ICON.chevronDown} size={9} style={{ opacity: 0.6 }} />
      </button>
      {open && <span className="response-menu">{children}</span>}
    </span>
  );
}

/** Three lines, aligned left or centred — the usual alignment glyph. */
function Align({ lines, center }: { lines: number[]; center?: boolean }) {
  return (
    <svg viewBox="0 0 14 12" width="14" height="12" aria-hidden>
      {lines.map((w, i) => (
        <rect
          key={i}
          x={center ? (14 - w) / 2 : 1}
          y={1 + i * 3}
          width={w}
          height="1.6"
          rx="0.8"
          fill="currentColor"
        />
      ))}
    </svg>
  );
}
