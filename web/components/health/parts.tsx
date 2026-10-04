"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { dayDate, daysBetween } from "@/lib/health/nutrition";
import { Icon, ICON } from "../ui";
import s from "./health.module.css";

/* ── icons (24×24, filled, in Slates' own style) ───────────────────────── */

export const H = {
  flame: "M12 2.5c3.5 3.6 6 6.9 6 10.5a6 6 0 0 1-12 0c0-2.4 1.1-4.4 2.8-6.3.2 1.7 1 2.9 2.2 3.3-.4-2.7.1-5.2 1-7.5z",
  camera:
    "M8.5 5 10 3h4l1.5 2H20a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zm3.5 3.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zm0 2a2.5 2.5 0 1 1 0 5 2.5 2.5 0 0 1 0-5z",
  dumbbell: "M2 10h2V8h3v8H4v-2H2zm20 0h-2V8h-3v8h3v-2h2zM8 11h8v2H8z",
  scale:
    "M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm0 2v14h14V5zm7 1.5a5.5 5.5 0 0 1 5.3 4H6.7a5.5 5.5 0 0 1 5.3-4zm-.6 1.5-.4 2.5h2l-.4-2.5z",
  drop: "M12 2.5s6.5 7 6.5 11.5a6.5 6.5 0 0 1-13 0C5.5 9.5 12 2.5 12 2.5z",
  meal: "M6 2h1.4v6.2c0 .6.4 1 .9 1.2V2h1.4v7.4c.5-.2.9-.6.9-1.2V2H12v6.4a3 3 0 0 1-2 2.8V22H8.3V11.2A3 3 0 0 1 6 8.4zm11.3 0C19 2 20 4.4 20 7.6c0 2.3-.8 3.7-2 4.2V22h-1.8V2z",
  ring: "M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm0 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13z",
  person: "M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zm0 10c4.4 0 8 2.2 8 5v3H4v-3c0-2.8 3.6-5 8-5z",
  heart: "M12 21s-8.5-5.2-8.5-11.2A4.8 4.8 0 0 1 12 6.9a4.8 4.8 0 0 1 8.5 2.9C20.5 15.8 12 21 12 21z",
  protein:
    "M15 3.5a5.5 5.5 0 0 1 3.9 9.4c-1.6 1.6-3.6 2.1-5.4 1.6l-3.1 3.1.3.3a1.8 1.8 0 1 1-2.6 2.5 1.8 1.8 0 1 1-2.5-2.6l.3.3 3.1-3.1c-.5-1.8 0-3.8 1.6-5.4A5.5 5.5 0 0 1 15 3.5z",
  carbs: "M7.5 4h9a4 4 0 0 1 1.5 7.7V20H6v-8.3A4 4 0 0 1 7.5 4z",
  fat: "M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z",
  chevronRight: "M9 6l6 6-6 6z",
  barcode: "M3 5h2v14H3zm4 0h1v14H7zm3 0h2v14h-2zm4 0h1v14h-1zm3 0h1v14h-1zm2 0h2v14h-2z",
} as const;

export function HIcon({ path, size = 18 }: { path: string; size?: number }) {
  return <Icon path={path} size={size} />;
}

/* ── formatting ────────────────────────────────────────────────────────── */

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const oneDecimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });

export const num = (value: number) => grouped.format(Math.round(value));
export const dec = (value: number) => oneDecimal.format(value);

/** "06:00" as "6:00 AM". */
export function clock(hhmm: string): string {
  const [h, m] = hhmm.split(":").map(Number);
  if (h === undefined || Number.isNaN(h)) return hhmm;
  return `${((h + 11) % 12) + 1}:${String(m ?? 0).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

export const timeOf = (at: number) => new Date(at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

export function dayLabel(day: string, today: string): string {
  const gap = daysBetween(today, day);
  if (gap === 0) return "Today";
  if (gap === -1) return "Yesterday";
  if (gap === 1) return "Tomorrow";
  return dayDate(day).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

export const weekdayShort = (day: string) => dayDate(day).toLocaleDateString("en-US", { weekday: "short" });
export const weekdayLetter = (day: string) => dayDate(day).toLocaleDateString("en-US", { weekday: "narrow" });
export const dateNumber = (day: string) => dayDate(day).getDate();
export const monthDay = (day: string) => dayDate(day).toLocaleDateString("en-US", { month: "short", day: "numeric" });

/* ── rings ─────────────────────────────────────────────────────────────── */

/**
 * A progress ring. Its sweep is drawn with the dash offset, which animates in
 * on mount and whenever the value moves, so a logged meal visibly fills it.
 */
export function Ring({
  value,
  size,
  stroke,
  color,
  children,
  label,
}: {
  value: number;
  size: number;
  stroke: number;
  color: string;
  children?: ReactNode;
  label?: string;
}) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(Math.max(0, Math.min(1, value))));
    return () => cancelAnimationFrame(frame);
  }, [value]);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <div className={s.ring} style={{ width: size, height: size }} role={label ? "img" : undefined} aria-label={label}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="oklch(1 0 0 / 0.08)" strokeWidth={stroke} />
        <circle
          className={s.ringArc}
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - shown)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      {children && <div className={s.ringCenter}>{children}</div>}
    </div>
  );
}

/* ── sheets ────────────────────────────────────────────────────────────── */

/**
 * A sub-task on top of the screen it came from: a bottom sheet on a phone, a
 * centred panel on the Mac. Escape and the backdrop close it, and focus goes
 * back where it was.
 */
export function Sheet({
  title,
  onClose,
  children,
  footer,
  bare,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** No title row: the content brings its own header (a photo, a workout's logo). */
  bare?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus({ preventScroll: true });
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
    <div className={s.backdrop} onClick={onClose}>
      <div className={s.sheet} role="dialog" aria-modal="true" aria-label={title} ref={panel} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <div className={s.handle} aria-hidden />
        {bare ? (
          <button type="button" className={`${s.close} ${s.closeFloat}`} onClick={onClose} aria-label="Close">
            <Icon path={ICON.close} size={16} />
          </button>
        ) : (
          <header className={s.sheetHead}>
            <h2>{title}</h2>
            <button type="button" className={s.close} onClick={onClose} aria-label="Close">
              <Icon path={ICON.close} size={16} />
            </button>
          </header>
        )}
        <div className={s.sheetBody}>{children}</div>
        {footer && <footer className={s.sheetFoot}>{footer}</footer>}
      </div>
    </div>
  );
}

/* ── controls ──────────────────────────────────────────────────────────── */

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  small,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  small?: boolean;
}) {
  return (
    <div className={`${s.segmented} ${small ? s.segmentedSmall : ""}`} role="radiogroup" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          className={s.segment}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ checked, onChange, label, detail }: { checked: boolean; onChange: (next: boolean) => void; label: string; detail?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={s.toggleRow} onClick={() => onChange(!checked)}>
      <span className={s.toggleText}>
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </span>
      <span className={s.switch} aria-hidden>
        <span />
      </span>
    </button>
  );
}

/**
 * A number field that holds what's typed until it reads as a number, so
 * "1." and an empty box are allowed on the way to "1.5".
 */
export function NumberField({
  value,
  onChange,
  label,
  unit,
  step = 1,
  min = 0,
  max = 100_000,
  decimals = 0,
  big,
  id,
  hideLabel,
  optional,
}: {
  value: number;
  onChange: (value: number) => void;
  label: string;
  unit?: string;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  big?: boolean;
  id?: string;
  /** Keeps the row aligned with its neighbour's label while saying it only to screen readers. */
  hideLabel?: boolean;
  /** Zero means "not given": the box stays empty, with a hint. */
  optional?: boolean;
}) {
  const auto = useId();
  const fieldId = id ?? auto;
  const round = (n: number) => Number(n.toFixed(decimals));
  const [text, setText] = useState(String(round(value)));
  const [focused, setFocused] = useState(false);
  const shown = focused ? text : optional && !value ? "" : String(round(value));
  return (
    <label className={`${s.numberField} ${big ? s.numberBig : ""}`} htmlFor={fieldId}>
      <span className={s.fieldLabel} aria-hidden={hideLabel || undefined}>
        {hideLabel ? "\u00a0" : label}
      </span>
      <span className={s.numberBox}>
        <input
          id={fieldId}
          inputMode={decimals ? "decimal" : "numeric"}
          value={shown}
          placeholder={optional ? "Optional" : undefined}
          onFocus={(e) => {
            setText(optional && !value ? "" : String(round(value)));
            setFocused(true);
            e.currentTarget.select();
          }}
          onBlur={() => setFocused(false)}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, "");
            setText(raw);
            const n = Number(raw);
            if (raw === "" && optional) onChange(0);
            else if (raw !== "" && Number.isFinite(n)) onChange(Math.min(max, Math.max(min, round(n))));
          }}
          aria-label={unit ? `${label} (${unit})` : label}
          data-step={step}
        />
        {unit && <span className={s.unit}>{unit}</span>}
      </span>
    </label>
  );
}

export function Stepper({
  value,
  onChange,
  step,
  min,
  max,
  format,
  label,
}: {
  value: number;
  onChange: (value: number) => void;
  step: number;
  min: number;
  max: number;
  format: (value: number) => string;
  label: string;
}) {
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / step) * step));
  return (
    <div className={s.stepper} role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(clamp(value - step))} disabled={value <= min} aria-label={`Less ${label.toLowerCase()}`}>
        <Icon path={ICON.minus} size={16} />
      </button>
      <output aria-live="polite">{format(value)}</output>
      <button type="button" onClick={() => onChange(clamp(value + step))} disabled={value >= max} aria-label={`More ${label.toLowerCase()}`}>
        <Icon path={ICON.plus} size={16} />
      </button>
    </div>
  );
}

/* ── F45 bits ──────────────────────────────────────────────────────────── */

const TYPE_TONE: Record<string, string> = { Cardio: s.typeCardio, Resistance: s.typeResistance, Hybrid: s.typeHybrid, Recovery: s.typeRecovery };

export function TypeChip({ type }: { type: string }) {
  if (!type) return null;
  return <span className={`${s.typeChip} ${TYPE_TONE[type] ?? ""}`}>{type}</span>;
}

/** The workout's own badge from F45, or its initials when it won't load. */
export function WorkoutLogo({ src, name, size = 48 }: { src: string | null; name: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className={s.logo} style={{ width: size, height: size }}>
      {src && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" width={size} height={size} loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        <span aria-hidden>{initials || "F45"}</span>
      )}
    </span>
  );
}
