"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import {
  CREATOR_LABEL,
  THINKING_LEVELS,
  TUTOR_MODELS,
  backendSupportsThinking,
  composerModelId,
  grokModelId,
  tutorModelBackend,
  tutorModelComposer,
  tutorModelCreator,
  tutorModelGrok,
  tutorModelLabel,
  type ThinkingLevel,
  type TutorModelCreator,
  type TutorModelId,
} from "@/lib/tutor-models";
import {
  AnthropicLogo,
  CursorLogo,
  DeepSeekLogo,
  GeminiLogo,
  Icon,
  ICON,
  MiniMaxLogo,
  OpenAILogo,
  QwenLogo,
  Toggle,
  XaiLogo,
  ZaiLogo,
} from "./ui";

/** Creators appear in the menu in the order their first model shows up in TUTOR_MODELS. */
const CREATOR_ORDER: TutorModelCreator[] = [];
for (const m of TUTOR_MODELS) {
  if (!CREATOR_ORDER.includes(m.creator)) CREATOR_ORDER.push(m.creator);
}

const THINKING_LABEL: Record<ThinkingLevel, string> = Object.fromEntries(
  THINKING_LEVELS.map((l) => [l.id, l.label])
) as Record<ThinkingLevel, string>;

function CreatorLogo({
  creator,
  size,
  style,
}: {
  creator: TutorModelCreator;
  size: number;
  style?: CSSProperties;
}) {
  switch (creator) {
    case "anthropic":
      return <AnthropicLogo size={size} style={style} />;
    case "xai":
      return <XaiLogo size={size} style={style} />;
    case "cursor":
      return <CursorLogo size={size} style={style} />;
    case "deepseek":
      return <DeepSeekLogo size={size} style={style} />;
    case "zai":
      return <ZaiLogo size={size} style={style} />;
    case "qwen":
      return <QwenLogo size={size} style={style} />;
    case "google":
      return <GeminiLogo size={size} style={style} />;
    case "minimax":
      return <MiniMaxLogo size={size} style={style} />;
    case "openai":
    default:
      return <OpenAILogo size={size} style={style} />;
  }
}

/** Trigger-button label — spells out the picked Grok/Composer combo. */
function triggerLabel(id: TutorModelId, thinking: ThinkingLevel): string {
  const grok = tutorModelGrok(id);
  if (grok) {
    return `Grok 4.7 · ${THINKING_LABEL[grok.thinking]}${grok.fast ? " Fast" : ""}`;
  }
  const composer = tutorModelComposer(id);
  if (composer) return `Composer 2.5${composer.fast ? " · Fast" : ""}`;
  const backend = tutorModelBackend(id);
  return backendSupportsThinking(backend)
    ? `${tutorModelLabel(id)} · ${THINKING_LABEL[thinking]}`
    : tutorModelLabel(id);
}

type HoverKind = "thinking" | "grok" | "composer";

const FLYOUT_WIDTH = 168;
const FLYOUT_GAP = 8;
/** Breathing room kept between a flyout and the edge of the window. */
const FLYOUT_MARGIN = 12;

const pillStyle = (active: boolean): CSSProperties => ({
  display: "block",
  width: "100%",
  textAlign: "left",
  border: 0,
  borderRadius: 8,
  background: active ? "var(--hover)" : "transparent",
  padding: "6px 8px",
  font: "inherit",
  fontSize: 12.5,
  color: active ? "var(--text)" : "var(--text-2)",
  cursor: "pointer",
});

function FlyoutPanel({
  rect,
  children,
  onMouseEnter,
  onMouseLeave,
}: {
  rect: DOMRect;
  children: React.ReactNode;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
}) {
  const vw = typeof window === "undefined" ? 0 : window.innerWidth;
  const vh = typeof window === "undefined" ? 0 : window.innerHeight;

  const fitsRight = !vw || rect.right + FLYOUT_GAP + FLYOUT_WIDTH < vw;
  const left = fitsRight ? rect.right + FLYOUT_GAP : rect.left - FLYOUT_GAP - FLYOUT_WIDTH;

  /*
   * Anchored to whichever edge of the row keeps the panel on screen. Hanging
   * everything off the row's top ran the panel straight out of the bottom of
   * the window for rows in the lower half of the menu — and this menu opens
   * upward from a composer that sits near the bottom, so that was most of them.
   * Rows down there hang the panel's *bottom* edge off the row instead, so it
   * grows upward. The max-height is a backstop for a window too short for
   * either direction: the panel scrolls rather than spilling.
   */
  const flipUp = vh > 0 && rect.top > vh / 2;
  const vertical: CSSProperties = flipUp
    ? { bottom: Math.max(FLYOUT_MARGIN, vh - rect.bottom), maxHeight: rect.bottom - FLYOUT_MARGIN }
    : { top: rect.top, maxHeight: vh ? vh - rect.top - FLYOUT_MARGIN : undefined };

  return (
    <div
      role="group"
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      style={{
        position: "fixed",
        left,
        ...vertical,
        width: FLYOUT_WIDTH,
        overflowY: "auto",
        zIndex: 40,
        borderRadius: 12,
        border: "1px solid var(--line)",
        background: "var(--surface)",
        boxShadow: "var(--shadow-menu)",
        padding: 8,
      }}
    >
      {children}
    </div>
  );
}

function ThinkingFlyoutContent({
  thinking,
  onThinkingChange,
}: {
  thinking: ThinkingLevel;
  onThinkingChange: (t: ThinkingLevel) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--muted)", padding: "2px 8px 4px" }}>
        Thinking
      </div>
      {THINKING_LEVELS.map((l) => (
        <button key={l.id} type="button" style={pillStyle(thinking === l.id)} onClick={() => onThinkingChange(l.id)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

function GrokFlyoutContent({
  value,
  draft,
  onChange,
}: {
  value: TutorModelId;
  draft: { thinking: ThinkingLevel; fast: boolean };
  onChange: (id: TutorModelId) => void;
}) {
  const current = tutorModelGrok(value) ?? draft;

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.02em", textTransform: "uppercase", color: "var(--muted)", padding: "2px 8px 4px" }}>
          Thinking
        </div>
        {THINKING_LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            style={pillStyle(current.thinking === l.id)}
            onClick={() => onChange(grokModelId(l.id, current.fast) as TutorModelId)}
          >
            {l.label}
          </button>
        ))}
      </div>
      {/* Ruled off from the thinking levels above it — it's a separate switch,
          not a fifth level, and the divider gives the panel a readable bottom. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 6,
          borderTop: "1px solid var(--line)",
          padding: "8px 8px 2px",
          fontSize: 12.5,
          color: "var(--text-2)",
        }}
      >
        Fast
        <Toggle
          on={current.fast}
          onClick={() => onChange(grokModelId(current.thinking, !current.fast) as TutorModelId)}
          label="Grok fast mode"
        />
      </div>
    </div>
  );
}

function ComposerFlyoutContent({
  value,
  draft,
  onChange,
}: {
  value: TutorModelId;
  draft: { fast: boolean };
  onChange: (id: TutorModelId) => void;
}) {
  const current = tutorModelComposer(value) ?? draft;
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "2px 8px", fontSize: 12.5, color: "var(--text-2)" }}>
      Fast
      <Toggle
        on={current.fast}
        onClick={() => onChange(composerModelId(!current.fast) as TutorModelId)}
        label="Composer fast mode"
      />
    </div>
  );
}

function ModelRow({
  id,
  selected,
  thinking,
  onSelect,
  onHover,
  onLeave,
}: {
  id: TutorModelId;
  selected: boolean;
  thinking: ThinkingLevel;
  onSelect: () => void;
  onHover: (kind: HoverKind, rect: DOMRect) => void;
  onLeave: () => void;
}) {
  const creator = tutorModelCreator(id);
  const backend = tutorModelBackend(id);
  const hasThinking = backendSupportsThinking(backend);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      onMouseEnter={(e) => hasThinking && onHover("thinking", e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onLeave}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        borderRadius: 11,
        border: 0,
        background: selected ? "var(--hover)" : "transparent",
        padding: "8px 10px",
        font: "inherit",
        fontSize: 13,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <CreatorLogo creator={creator} size={15} style={{ color: "var(--text-2)" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        {tutorModelLabel(id)}
        {hasThinking && (
          <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
            {THINKING_LABEL[thinking]} thinking
          </span>
        )}
      </span>
      {selected && <Icon path={ICON.check} size={13} style={{ color: "var(--text-2)" }} />}
    </button>
  );
}

function GrokRow({
  value,
  draft,
  onSelect,
  onHover,
  onLeave,
}: {
  value: TutorModelId;
  draft: { thinking: ThinkingLevel; fast: boolean };
  onSelect: () => void;
  onHover: (kind: HoverKind, rect: DOMRect) => void;
  onLeave: () => void;
}) {
  const selected = tutorModelGrok(value) !== undefined;
  const current = tutorModelGrok(value) ?? draft;

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      onMouseEnter={(e) => onHover("grok", e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onLeave}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        borderRadius: 11,
        border: 0,
        background: selected ? "var(--hover)" : "transparent",
        padding: "8px 10px",
        font: "inherit",
        fontSize: 13,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <CursorLogo size={15} style={{ color: "var(--text-2)" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        Grok 4.7
        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
          {THINKING_LABEL[current.thinking]} thinking{current.fast ? ", fast" : ""}
        </span>
      </span>
      {selected && <Icon path={ICON.check} size={13} style={{ color: "var(--text-2)" }} />}
    </button>
  );
}

function ComposerRow({
  value,
  draft,
  onSelect,
  onHover,
  onLeave,
}: {
  value: TutorModelId;
  draft: { fast: boolean };
  onSelect: () => void;
  onHover: (kind: HoverKind, rect: DOMRect) => void;
  onLeave: () => void;
}) {
  const selected = tutorModelComposer(value) !== undefined;
  const current = tutorModelComposer(value) ?? draft;

  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
      onMouseEnter={(e) => onHover("composer", e.currentTarget.getBoundingClientRect())}
      onMouseLeave={onLeave}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        borderRadius: 11,
        border: 0,
        background: selected ? "var(--hover)" : "transparent",
        padding: "8px 10px",
        font: "inherit",
        fontSize: 13,
        color: "var(--text)",
        cursor: "pointer",
        textAlign: "left",
      }}
    >
      <CursorLogo size={15} style={{ color: "var(--text-2)" }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        Composer 2.5
        <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
          {current.fast ? "Fast" : "Standard"}
        </span>
      </span>
      {selected && <Icon path={ICON.check} size={13} style={{ color: "var(--text-2)" }} />}
    </button>
  );
}

export default function ModelPicker({
  value,
  onChange,
  thinking,
  onThinkingChange,
  placement = "up",
  variant = "outline",
  allowedModels,
}: {
  value: TutorModelId;
  onChange: (id: TutorModelId) => void;
  thinking: ThinkingLevel;
  onThinkingChange: (t: ThinkingLevel) => void;
  /**
   * Which way the menu opens. The composer sits at the bottom of the window so
   * its picker grows upward; the tutor's header sits at the top and grows down.
   */
  placement?: "up" | "down";
  /** "bare" drops the pill outline — the header wears the model name as a title. */
  variant?: "outline" | "bare";
  /** Restrict the menu to models whose route supports this product's tools. */
  allowedModels?: readonly TutorModelId[];
}) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState<{ kind: HoverKind; rect: DOMRect } | null>(null);
  const [grokDraft, setGrokDraft] = useState<{ thinking: ThinkingLevel; fast: boolean }>({
    thinking: "medium",
    fast: false,
  });
  const [composerDraft, setComposerDraft] = useState<{ fast: boolean }>({ fast: false });
  const wrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const models = allowedModels
    ? TUTOR_MODELS.filter((model) => allowedModels.includes(model.id))
    : TUTOR_MODELS;
  const creators = CREATOR_ORDER.filter((creator) => models.some((model) => model.creator === creator));

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function handleHover(kind: HoverKind, rect: DOMRect) {
    clearCloseTimer();
    setHover({ kind, rect });
  }
  function scheduleClose() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setHover(null), 150);
  }
  function closeMenu() {
    setOpen(false);
    setHover(null);
    clearCloseTimer();
  }

  function handleGrokChange(id: TutorModelId) {
    onChange(id);
    // Keep the draft in sync so the flyout reflects the pick even if the
    // student later switches to a different model and comes back to Grok.
    const parts = tutorModelGrok(id);
    if (parts) setGrokDraft(parts);
  }
  function handleComposerChange(id: TutorModelId) {
    onChange(id);
    setComposerDraft({ fast: id.endsWith("-fast") });
  }

  // Close on an outside click or Escape, the way a native menu would.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false);
        setHover(null);
      }
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setHover(null);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Scroll invalidates the captured row rect, so just close the flyout.
  useEffect(() => {
    if (!open) return;
    function onScroll() {
      setHover(null);
    }
    document.addEventListener("scroll", onScroll, true);
    return () => document.removeEventListener("scroll", onScroll, true);
  }, [open]);

  useEffect(() => () => clearCloseTimer(), []);

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => (open ? closeMenu() : setOpen(true))}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model: ${triggerLabel(value, thinking)}`}
        className="model-trigger"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: variant === "bare" ? 34 : 30,
          borderRadius: 9999,
          border: variant === "bare" ? 0 : "1px solid var(--line)",
          background: open ? "var(--hover)" : "transparent",
          padding: variant === "bare" ? "0 8px" : "0 10px",
          font: "inherit",
          fontSize: variant === "bare" ? 15 : 12.5,
          fontWeight: variant === "bare" ? 600 : 400,
          letterSpacing: variant === "bare" ? "-0.01em" : undefined,
          color: variant === "bare" ? "var(--text)" : "var(--text-2)",
          cursor: "pointer",
        }}
      >
        <CreatorLogo creator={tutorModelCreator(value)} size={13} />
        {triggerLabel(value, thinking)}
        <Icon path={ICON.chevronDown} size={12} style={{ color: "var(--muted)" }} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            ...(placement === "down"
              ? { top: "calc(100% + 6px)" }
              : { bottom: "calc(100% + 6px)" }),
            left: 0,
            zIndex: 20,
            minWidth: 220,
            maxHeight: "min(70vh, 520px)",
            overflowY: "auto",
            borderRadius: 16,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-menu)",
            padding: 6,
          }}
        >
          {creators.map((creator, i) => (
            <div key={creator}>
              <div
                style={{
                  padding: i > 0 ? "10px 10px 4px" : "4px 10px 4px",
                  fontSize: 11,
                  fontWeight: 600,
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  color: "var(--muted)",
                }}
              >
                {CREATOR_LABEL[creator]}
              </div>
              {creator === "cursor" ? (
                <>
                  {models.some((m) => tutorModelGrok(m.id)) && (
                    <GrokRow
                      value={value}
                      draft={grokDraft}
                      onSelect={() => {
                        handleGrokChange(grokModelId(grokDraft.thinking, grokDraft.fast) as TutorModelId);
                        closeMenu();
                      }}
                      onHover={handleHover}
                      onLeave={scheduleClose}
                    />
                  )}
                  {models.some((m) => tutorModelComposer(m.id)) && (
                    <ComposerRow
                      value={value}
                      draft={composerDraft}
                      onSelect={() => {
                        handleComposerChange(composerModelId(composerDraft.fast) as TutorModelId);
                        closeMenu();
                      }}
                      onHover={handleHover}
                      onLeave={scheduleClose}
                    />
                  )}
                </>
              ) : (
                models.filter((m) => m.creator === creator).map((m) => (
                  <ModelRow
                    key={m.id}
                    id={m.id}
                    selected={m.id === value}
                    thinking={thinking}
                    onSelect={() => {
                      onChange(m.id);
                      closeMenu();
                    }}
                    onHover={handleHover}
                    onLeave={scheduleClose}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}

      {open && hover && (
        <FlyoutPanel rect={hover.rect} onMouseEnter={clearCloseTimer} onMouseLeave={scheduleClose}>
          {hover.kind === "thinking" && (
            <ThinkingFlyoutContent thinking={thinking} onThinkingChange={onThinkingChange} />
          )}
          {hover.kind === "grok" && (
            <GrokFlyoutContent value={value} draft={grokDraft} onChange={handleGrokChange} />
          )}
          {hover.kind === "composer" && (
            <ComposerFlyoutContent value={value} draft={composerDraft} onChange={handleComposerChange} />
          )}
        </FlyoutPanel>
      )}
    </div>
  );
}
