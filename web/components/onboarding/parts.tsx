"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";

import { Icon, ICON, Spinner } from "@/components/ui";

import styles from "./onboarding.module.css";

export const EASE = [0.22, 1, 0.36, 1] as const;

export function useAttempts() {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), []);
  const start = useCallback(() => {
    current.current?.abort();
    current.current = new AbortController();
    return current.current.signal;
  }, []);
  const cancel = useCallback(() => current.current?.abort(), []);
  return useMemo(() => ({ start, cancel }), [start, cancel]);
}

export function Reveal({ i = 0, className, children }: { i?: number; className?: string; children: ReactNode }) {
  return (
    <motion.div
      className={className}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: EASE, delay: 0.05 + i * 0.05 }}
    >
      {children}
    </motion.div>
  );
}

export function StepHead({ title, children }: { title: ReactNode; children?: ReactNode }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <header>
      <Reveal i={1}>
        <h1 ref={heading} tabIndex={-1} className={styles.title}>
          {title}
        </h1>
      </Reveal>
      {children && (
        <Reveal i={2} className={styles.lede}>
          {children}
        </Reveal>
      )}
    </header>
  );
}

export function Body({ children }: { children: ReactNode }) {
  return (
    <Reveal i={3} className={styles.body}>
      {children}
    </Reveal>
  );
}

export function Actions({ children, note, sticky = false }: { children: ReactNode; note?: ReactNode; sticky?: boolean }) {
  return (
    <Reveal i={4} className={sticky ? styles.stickyActions : undefined}>
      <div className={styles.actions}>{children}</div>
      {note && <p className={styles.note}>{note}</p>}
    </Reveal>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { busy?: boolean };

export function Primary({ busy, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={`btn btn--primary ${styles.cta} ${busy ? "btn--busy" : ""} ${className ?? ""}`} aria-busy={busy || undefined} {...rest}>
      {busy && <Spinner size={13} />}
      {children}
    </button>
  );
}

export function Quiet({ className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`btn btn--quiet ${styles.ghost} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}

export function Small({ className, children, type = "button", ...rest }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type={type} className={`btn btn--quiet ${styles.small} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-note`} className={styles.error} role="alert">
          {error}
        </p>
      ) : (
        hint && (
          <p id={`${id}-note`} className={styles.hint}>
            {hint}
          </p>
        )
      )}
    </div>
  );
}

export type Tone = "busy" | "good" | "warn" | "bad" | "idle";

export function Status({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={styles.status} data-tone={tone} role="status">
      <span className={styles.glyph}>
        {tone === "busy" ? (
          <Spinner size={13} />
        ) : tone === "good" ? (
          <Icon path={ICON.check} size={15} />
        ) : tone === "idle" ? (
          <span className={styles.dot} />
        ) : (
          <Icon path={ICON.alert} size={13} />
        )}
      </span>
      <div>{children}</div>
    </div>
  );
}

export function Code({ children }: { children: ReactNode }) {
  return <code className={styles.code}>{children}</code>;
}

export function LaptopIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="4" y="5" width="16" height="11" rx="2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2.5 19h19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function TowerIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="2.75" width="10" height="18.5" rx="2.25" stroke="currentColor" strokeWidth="1.6" />
      <path d="M10 7h4M10 10h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="12" cy="16.5" r="1.3" fill="currentColor" />
    </svg>
  );
}

export function PhoneIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="7" y="2.75" width="10" height="18.5" rx="2.6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M11 18.2h2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function LockIcon({ size = 14, open = false }: { size?: number; open?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="5" y="10.5" width="14" height="10" rx="2.5" stroke="currentColor" strokeWidth="1.8" />
      <path d={open ? "M8.5 10.5V7.8a3.5 3.5 0 0 1 6.8-1.2" : "M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7"} stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
