"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";

import type { VitalsApp } from "@/lib/vitals/types";
import { Icon, ICON } from "../ui";
import s from "./vitals.module.css";

/** 24×24, filled, in Slates' own style. */
export const V = {
  chip: "M8 2h2v2h4V2h2v2h1a3 3 0 0 1 3 3v1h2v2h-2v4h2v2h-2v1a3 3 0 0 1-3 3h-1v2h-2v-2h-4v2H8v-2H7a3 3 0 0 1-3-3v-1H2v-2h2v-4H2V8h2V7a3 3 0 0 1 3-3h1zM7 6a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zm2 3h6v6H9z",
  memory: "M3 6h18a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1v2h-2v-2h-3v2h-2v-2H9v2H7v-2H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1zm1 2v6h16V8zm2 1h2v4H6zm4 0h2v4h-2zm4 0h2v4h-2z",
  disk: "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v9h14V5zm0 11v3h14v-3zm11 .5a1 1 0 1 1 0 2 1 1 0 0 1 0-2z",
  network: "M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18zm-1.9 2.2A7 7 0 0 0 5.1 11h3c.1-2.2.7-4.2 1.9-5.8zm3.8 0c1.2 1.6 1.8 3.6 1.9 5.8h3a7 7 0 0 0-4.9-5.8zM12 5.6c-1.1 1.3-1.8 3.2-1.9 5.4h3.8c-.1-2.2-.8-4.1-1.9-5.4zM5.1 13a7 7 0 0 0 5 5.8c-1.2-1.6-1.9-3.6-2-5.8zm5 0c.1 2.2.8 4.1 1.9 5.4 1.1-1.3 1.8-3.2 1.9-5.4zm5.8 0c-.1 2.2-.8 4.2-2 5.8a7 7 0 0 0 5-5.8z",
  gpu: "M2 6h18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3v2h-2v-2H7v2H5v-2H2zm2 2v8h16V8zm7 1a3 3 0 1 1 0 6 3 3 0 0 1 0-6zm0 2a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm5-2h2v6h-2z",
  battery: "M4 6h13a2 2 0 0 1 2 2v1h1a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm0 2v8h13V8zm1 1h8v6H5z",
  bolt: "M13 2 4 14h6l-1 8 9-12h-6z",
  heat: "M15 13V5a3 3 0 0 0-6 0v8a5 5 0 1 0 6 0zm-3-9a1 1 0 0 1 1 1v3h-2V5a1 1 0 0 1 1-1z",
  fan: "M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zm.5-9c4.5 0 4.61 3.57 2.25 4.75-.99.49-1.43 1.54-1.62 2.47.48.2.9.51 1.22.91 3.7-2 7.68-1.21 7.68 2.37 0 4.5-3.57 4.6-4.75 2.23-.5-.99-1.56-1.43-2.49-1.62-.2.48-.51.89-.91 1.23 1.99 3.69 1.2 7.66-2.38 7.66-4.5 0-4.59-3.58-2.23-4.76.98-.49 1.42-1.53 1.62-2.45-.49-.2-.92-.52-1.24-.92C5.96 15.85 2 15.07 2 11.5 2 7 5.56 6.89 6.74 9.26c.5.99 1.55 1.42 2.48 1.61.19-.48.51-.9.92-1.22C8.15 5.96 8.94 2 12.5 2z",
  folder: "M2 5a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2zm2 0v13h16V7h-9.8l-2-2z",
  laptop: "M5 4h14a2 2 0 0 1 2 2v9h2v2a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-2h2V6a2 2 0 0 1 2-2zm0 2v9h14V6z",
  prompt: "M4.3 6.3 9.99 12l-5.7 5.7-1.4-1.4 4.29-4.3L2.9 7.7zM11 17h10v2H11z",
  down: "M11 4h2v11.2l4.6-4.6 1.4 1.4-7 7-7-7 1.4-1.4 4.6 4.6z",
  up: "M11 20h2V8.8l4.6 4.6 1.4-1.4-7-7-7 7 1.4 1.4L11 8.8z",
  chevronRight: "M9 6l6 6-6 6z",
} as const;

/* ── charts ────────────────────────────────────────────────────────────── */

const W = 100;
const H = 36;

/**
 * A line of recent readings, newest at the right edge. It fills in from the
 * right as the session goes, against a fixed number of slots, so its speed
 * doesn't change as it fills.
 */
export function Spark({
  values,
  second,
  slots,
  max,
  className,
  area = true,
}: {
  values: number[];
  /** A second line on the same scale (upload against download). */
  second?: number[];
  slots: number;
  /** The scale's top; the largest reading when not given. */
  max?: number;
  className?: string;
  area?: boolean;
}) {
  const top = Math.max(max ?? 0, ...values, ...(second ?? []), 1e-9);
  const step = W / Math.max(1, slots - 1);
  const line = (vs: number[]) => vs.map((v, i) => `${(W - (vs.length - 1 - i) * step).toFixed(2)},${(H - (Math.min(v, top) / top) * (H - 2) - 1).toFixed(2)}`);
  const main = line(values);
  return (
    <svg className={`${s.spark} ${className ?? ""}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden>
      <line x1="0" x2={W} y1={H - 0.5} y2={H - 0.5} className={s.sparkBase} vectorEffect="non-scaling-stroke" />
      {main.length > 1 && (
        <>
          {area && <path className={s.sparkArea} d={`M${main[0]!.split(",")[0]},${H} L${main.join(" L")} L${W},${H} Z`} />}
          <polyline className={s.sparkLine} points={main.join(" ")} vectorEffect="non-scaling-stroke" />
        </>
      )}
      {second && second.length > 1 && <polyline className={s.sparkSecond} points={line(second).join(" ")} vectorEffect="non-scaling-stroke" />}
    </svg>
  );
}

/** A thin bar for a share of something; tone from good to bad as it fills, when asked. */
export function Meter({ value, max = 100, tone, label }: { value: number; max?: number; tone?: "auto" | "accent" | "muted"; label?: string }) {
  const share = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const color = tone === "auto" ? (share >= 0.9 ? "bad" : share >= 0.75 ? "warn" : "good") : (tone ?? "accent");
  return (
    <span className={s.meter} data-tone={color} role={label ? "meter" : undefined} aria-label={label} aria-valuenow={label ? Math.round(share * 100) : undefined} aria-valuemin={label ? 0 : undefined} aria-valuemax={label ? 100 : undefined}>
      <span style={{ transform: `scaleX(${share})` }} />
    </span>
  );
}

/** Parts of one whole, side by side: memory's app, wired, compressed, cached and free. */
export function Stack({ parts, label }: { parts: { key: string; value: number }[]; label: string }) {
  const total = parts.reduce((sum, p) => sum + p.value, 0) || 1;
  return (
    <div className={s.stack} role="img" aria-label={label}>
      {parts.map((p) => (
        <span key={p.key} data-part={p.key} style={{ flexGrow: p.value / total }} />
      ))}
    </div>
  );
}

/* ── apps ──────────────────────────────────────────────────────────────── */

/** The app's own icon; macOS and command-line tools get a mark of their own. */
export function AppIcon({ app, src, size = 28 }: { app: Pick<VitalsApp, "kind" | "name">; src: string | null; size?: number }) {
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- a data URL made on this Mac; nothing for next/image to optimise
    return <img className={s.appIcon} src={src} alt="" width={size} height={size} />;
  }
  const glyph = app.kind === "macos" ? V.laptop : app.kind === "tool" ? V.prompt : null;
  return (
    <span className={s.appGlyph} data-kind={app.kind} style={{ width: size, height: size }} aria-hidden>
      {glyph ? <Icon path={glyph} size={Math.round(size * 0.55)} /> : app.name.slice(0, 1).toUpperCase()}
    </span>
  );
}

/* ── confirming ────────────────────────────────────────────────────────── */

/**
 * Before anything stops: what it is, what goes with it, and what comes back.
 * Cancel holds the focus, so Return never quits something by accident.
 */
export function Confirm({
  title,
  children,
  action,
  busy,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  action: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const close = useRef(onCancel);
  useEffect(() => {
    close.current = onCancel;
  }, [onCancel]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    cancel.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      before?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div className={s.backdrop} onMouseDown={busy ? undefined : onCancel}>
      <section className={s.dialog} role="alertdialog" aria-modal="true" aria-labelledby={`${id}-title`} aria-describedby={`${id}-body`} onMouseDown={(e) => e.stopPropagation()}>
        <h2 id={`${id}-title`}>{title}</h2>
        <div id={`${id}-body`} className={s.dialogBody}>
          {children}
        </div>
        <div className={s.dialogActions}>
          <button ref={cancel} type="button" className="btn btn--quiet" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="btn btn--danger" onClick={onConfirm} disabled={busy}>
            {busy ? "Working…" : action}
          </button>
        </div>
      </section>
    </div>
  );
}

export function Toast({ message, tone, onDismiss }: { message: string; tone: "good" | "bad"; onDismiss: () => void }) {
  return (
    <div className={s.toast} data-tone={tone} role="status">
      <Icon path={tone === "good" ? ICON.check : ICON.alert} size={15} />
      <span>{message}</span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss">
        <Icon path={ICON.close} size={13} />
      </button>
    </div>
  );
}
