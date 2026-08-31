"use client";

import type { CSSProperties } from "react";
import { useEffect, useRef, useState } from "react";

import {
  CREATOR_LABEL,
  GROK_THINKING_LEVELS,
  TUTOR_MODELS,
  composerModelId,
  grokModelId,
  tutorModelBackend,
  tutorModelComposer,
  tutorModelCreator,
  tutorModelGrok,
  tutorModelLabel,
  type GrokThinking,
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
    case "openai":
    default:
      return <OpenAILogo size={size} style={style} />;
  }
}

/** Trigger-button label — spells out the picked Grok/Composer combo. */
function triggerLabel(id: TutorModelId): string {
  const grok = tutorModelGrok(id);
  if (grok) {
    const level = GROK_THINKING_LEVELS.find((l) => l.id === grok.thinking)?.label ?? grok.thinking;
    return `Grok 4.6 · ${level}${grok.fast ? " Fast" : ""}`;
  }
  const composer = tutorModelComposer(id);
  if (composer) return `Composer 2.5${composer.fast ? " · Fast" : ""}`;
  return tutorModelLabel(id);
}

/**
 * A dropdown of its own, opening on hover (with a short close-out grace
 * period) so it reads like a submenu instead of a second click target —
 * used for Grok's thinking-level pick.
 */
function MiniDropdown<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearCloseTimer() {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
  }
  function openNow() {
    clearCloseTimer();
    setOpen(true);
  }
  function closeSoon() {
    clearCloseTimer();
    closeTimer.current = setTimeout(() => setOpen(false), 150);
  }

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  useEffect(() => () => clearCloseTimer(), []);

  const current = options.find((o) => o.id === value)?.label ?? value;

  return (
    <div
      ref={ref}
      onMouseEnter={openNow}
      onMouseLeave={closeSoon}
      style={{ position: "relative", flex: 1, minWidth: 0 }}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          width: "100%",
          border: "1px solid var(--line)",
          borderRadius: 9999,
          background: open ? "var(--hover)" : "transparent",
          padding: "4px 8px",
          font: "inherit",
          fontSize: 11.5,
          color: "var(--text-2)",
          cursor: "pointer",
        }}
      >
        <span style={{ color: "var(--muted)" }}>{label}</span>
        <span style={{ flex: 1, minWidth: 0, textAlign: "left", color: "var(--text)" }}>
          {current}
        </span>
        <Icon path={ICON.chevronDown} size={10} style={{ color: "var(--muted)" }} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 30,
            minWidth: 130,
            borderRadius: 10,
            border: "1px solid var(--line)",
            background: "var(--surface)",
            boxShadow: "var(--shadow-menu)",
            padding: 4,
          }}
        >
          {options.map((o) => {
            const selected = o.id === value;
            return (
              <button
                key={o.id}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(o.id);
                  setOpen(false);
                }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  width: "100%",
                  borderRadius: 7,
                  border: 0,
                  background: selected ? "var(--hover)" : "transparent",
                  padding: "5px 8px",
                  font: "inherit",
                  fontSize: 12,
                  color: "var(--text)",
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                <span style={{ flex: 1 }}>{o.label}</span>
                {selected && <Icon path={ICON.check} size={11} style={{ color: "var(--text-2)" }} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function GrokRow({
  value,
  onChange,
}: {
  value: TutorModelId;
  onChange: (id: TutorModelId) => void;
}) {
  const [draft, setDraft] = useState<{ thinking: GrokThinking; fast: boolean }>({
    thinking: "medium",
    fast: false,
  });
  const current = tutorModelGrok(value) ?? draft;
  const selected = tutorModelCreator(value) === "xai";

  function pick(next: Partial<{ thinking: GrokThinking; fast: boolean }>) {
    const combo = { ...current, ...next };
    setDraft(combo);
    onChange(grokModelId(combo.thinking, combo.fast) as TutorModelId);
  }

  return (
    <div
      style={{
        borderRadius: 11,
        background: selected ? "var(--hover)" : "transparent",
        padding: "8px 10px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <XaiLogo size={15} style={{ color: "var(--text-2)" }} />
        <span style={{ flex: 1, fontSize: 13, color: "var(--text)" }}>Grok 4.6</span>
        {selected && <Icon path={ICON.check} size={13} style={{ color: "var(--text-2)" }} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
        <MiniDropdown
          label="Thinking"
          options={GROK_THINKING_LEVELS}
          value={current.thinking}
          onChange={(thinking) => pick({ thinking })}
        />
        <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" }}>
          Fast
          <Toggle
            on={current.fast}
            onClick={() => pick({ fast: !current.fast })}
            label="Grok fast mode"
          />
        </span>
      </div>
    </div>
  );
}

function ComposerRow({
  value,
  onChange,
}: {
  value: TutorModelId;
  onChange: (id: TutorModelId) => void;
}) {
  const [draft, setDraft] = useState<{ fast: boolean }>({ fast: false });
  const current = tutorModelComposer(value) ?? draft;
  const selected = tutorModelComposer(value) !== undefined;

  function pick(fast: boolean) {
    setDraft({ fast });
    onChange(composerModelId(fast) as TutorModelId);
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        borderRadius: 11,
        background: selected ? "var(--hover)" : "transparent",
        padding: "8px 10px",
      }}
    >
      <CursorLogo size={15} style={{ color: "var(--text-2)" }} />
      <button
        type="button"
        role="menuitemradio"
        aria-checked={selected}
        onClick={() => onChange(composerModelId(current.fast) as TutorModelId)}
        style={{
          flex: 1,
          minWidth: 0,
          textAlign: "left",
          border: 0,
          background: "transparent",
          font: "inherit",
          fontSize: 13,
          color: "var(--text)",
          cursor: "pointer",
          padding: 0,
        }}
      >
        Composer 2.5
      </button>
      {selected && <Icon path={ICON.check} size={13} style={{ color: "var(--text-2)" }} />}
      <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "var(--muted)" }}>
        Fast
        <Toggle on={current.fast} onClick={() => pick(!current.fast)} label="Composer fast mode" />
      </span>
    </div>
  );
}

function ModelRow({
  id,
  selected,
  onSelect,
}: {
  id: TutorModelId;
  selected: boolean;
  onSelect: () => void;
}) {
  const creator = tutorModelCreator(id);
  const backend = tutorModelBackend(id);
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
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
        {(backend === "openai" || backend === "claude-code") && (
          <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>
            Medium thinking
          </span>
        )}
      </span>
      {selected && <Icon path={ICON.check} size={13} style={{ color: "var(--text-2)" }} />}
    </button>
  );
}

export default function ModelPicker({
  value,
  onChange,
}: {
  value: TutorModelId;
  onChange: (id: TutorModelId) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape, the way a native menu would.
  useEffect(() => {
    if (!open) return;

    function onPointerDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={wrapRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Model: ${triggerLabel(value)}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          height: 30,
          borderRadius: 9999,
          border: "1px solid var(--line)",
          background: open ? "var(--hover)" : "transparent",
          padding: "0 10px",
          font: "inherit",
          fontSize: 12.5,
          color: "var(--text-2)",
          cursor: "pointer",
        }}
      >
        <CreatorLogo creator={tutorModelCreator(value)} size={13} />
        {triggerLabel(value)}
        <Icon path={ICON.chevronDown} size={12} style={{ color: "var(--muted)" }} />
      </button>

      {open && (
        <div
          role="menu"
          style={{
            position: "absolute",
            bottom: "calc(100% + 6px)",
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
          {CREATOR_ORDER.map((creator, i) => (
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
              {creator === "xai" ? (
                <GrokRow value={value} onChange={onChange} />
              ) : creator === "cursor" ? (
                <ComposerRow value={value} onChange={onChange} />
              ) : (
                TUTOR_MODELS.filter((m) => m.creator === creator).map((m) => (
                  <ModelRow
                    key={m.id}
                    id={m.id}
                    selected={m.id === value}
                    onSelect={() => {
                      onChange(m.id);
                      setOpen(false);
                    }}
                  />
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
