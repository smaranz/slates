"use client";

import { useId, useState, type ComponentType, type ReactNode } from "react";
import { IconEye, IconEyeOff } from "@tabler/icons-react";
import { motion } from "motion/react";

import { Input } from "@whirl/components/ui/input";
import { formatRecoveryCode, ratePassword } from "@whirl/lib/locked/crypto";
import { EASE_OUT } from "@whirl/lib/motion";
import { NO_CAPTURE } from "@whirl/lib/replay-guard";
import { cn } from "@whirl/lib/utils";

/* The pieces the lock dialogs are built from. Shared so the setup
   walkthrough, the unlock prompt and the change-password step all speak the
   same visual language.

   The explainer's icons carry color and no chip behind them — the one place
   in v2 where an icon is allowed a hue, because these screens are explaining
   a safety model and the color IS the meaning: green is what's protected,
   amber is what you have to be careful with, red is what can't be undone.
   The padlock is not one of those; it's the feature's mark and stays in the
   app's own ink wherever it appears. */

export type LockTone = "plain" | "safe" | "care" | "grave" | "info";

const TONE_INK: Record<LockTone, string> = {
  /* The padlock itself, wherever it appears: it's the feature's mark, not
     one of the explainer's points, so it wears the app's ink like every
     other glyph in the chrome. Color here is reserved for meaning. */
  plain: "text-foreground",
  safe: "text-emerald-600 dark:text-emerald-400",
  care: "text-amber-600 dark:text-amber-400",
  grave: "text-rose-600 dark:text-rose-400",
  info: "text-sky-600 dark:text-sky-400",
};

/** The glyph at the top of a step: big and unadorned, colored only when
 *  the color is carrying meaning. */
export function StepGlyph({
  icon: Icon,
  tone = "plain",
}: {
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
  tone?: LockTone;
}) {
  return (
    <motion.span
      initial={{ scale: 0.7, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: "spring", stiffness: 420, damping: 24 }}
      className={cn("inline-flex", TONE_INK[tone])}
    >
      <Icon size={38} stroke={1.75} />
    </motion.span>
  );
}

/** One line of the explainer: a glyph, a claim, and the detail. */
export function LockPoint({
  icon: Icon,
  tone = "plain",
  title,
  children,
  index = 0,
}: {
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
  tone?: LockTone;
  title: string;
  children: ReactNode;
  /** Staggers the entrance so the three points arrive as a sentence. */
  index?: number;
}) {
  return (
    <motion.li
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.24, ease: EASE_OUT, delay: 0.05 + index * 0.06 }}
      className="flex gap-3 text-left"
    >
      <Icon
        size={18}
        stroke={2}
        className={cn("mt-px shrink-0", TONE_INK[tone])}
      />
      <span className="min-w-0">
        <span className="block text-[13.5px]/5 font-medium">{title}</span>
        <span className="mt-0.5 block text-[12.5px]/[1.45] text-muted-foreground">
          {children}
        </span>
      </span>
    </motion.li>
  );
}

/** A password box with a reveal toggle. Autofocuses on request, and reports
 *  Enter so a step can be finished without reaching for the button. */
export function PasswordField({
  value,
  onChange,
  onEnter,
  placeholder,
  label,
  autoFocus = false,
  autoComplete = "new-password",
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onEnter?: () => void;
  placeholder: string;
  label: string;
  autoFocus?: boolean;
  autoComplete?: string;
  invalid?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);
  const id = useId();
  return (
    /* A revealed password is plain text in the DOM, so the mask goes on the
       wrapper rather than trusting the input's type attribute. */
    <div className={cn("relative", NO_CAPTURE)}>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        type={revealed ? "text" : "password"}
        value={value}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        spellCheck={false}
        placeholder={placeholder}
        aria-invalid={invalid || undefined}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          onEnter?.();
        }}
        className="h-10 pr-10"
      />
      <button
        type="button"
        aria-label={revealed ? "Hide password" : "Show password"}
        title={revealed ? "Hide password" : "Show password"}
        onClick={() => setRevealed((current) => !current)}
        className="absolute top-1/2 right-1 flex size-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors duration-100 hover:text-foreground"
      >
        {revealed ? <IconEyeOff size={16} /> : <IconEye size={16} />}
      </button>
    </div>
  );
}

/* Four segments, filling left to right. The label morphs with the score, so
   the meter reads as one thing changing rather than a row of lights. */
const STRENGTH_INK = [
  "bg-rose-500",
  "bg-rose-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-emerald-500",
] as const;

export function StrengthMeter({ password }: { password: string }) {
  const { score, label, hint } = ratePassword(password);
  const lit = password ? score + 1 : 0;
  return (
    <div className="mt-2.5">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((segment) => (
          <motion.span
            key={segment}
            initial={false}
            animate={{ opacity: segment < lit ? 1 : 0.14 }}
            transition={{ duration: 0.18, ease: EASE_OUT }}
            className={cn(
              "h-1 flex-1 rounded-full",
              segment < lit ? STRENGTH_INK[score] : "bg-foreground",
            )}
          />
        ))}
      </div>
      <p className="mt-1.5 flex items-baseline justify-between gap-3 text-[11.5px] leading-snug">
        <span className="font-medium text-muted-foreground">
          {password ? label : " "}
        </span>
        <span className="min-w-0 truncate text-right text-muted-foreground/70">
          {password ? (hint ?? "") : ""}
        </span>
      </p>
    </div>
  );
}

/** The recovery key itself, set to be read off a screen and typed back. */
export function RecoveryKeyBlock({ code }: { code: string }) {
  return (
    <div
      className={cn(
        "rounded-xl bg-well px-3 py-3 text-center shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]",
        NO_CAPTURE,
      )}
    >
      <code className="block font-mono text-[13px]/6 font-medium tracking-[0.08em] break-all select-all">
        {formatRecoveryCode(code)}
      </code>
    </div>
  );
}

/** A step's heading block: glyph, title, and a line of why. */
export function StepHeading({
  icon,
  tone,
  title,
  children,
}: {
  icon: ComponentType<{ size?: number; stroke?: number; className?: string }>;
  tone?: LockTone;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center text-center">
      <StepGlyph icon={icon} tone={tone} />
      <h2 className="mt-3 text-[16px] font-semibold tracking-tight">{title}</h2>
      {children && (
        <p className="mt-1.5 max-w-[17rem] text-[13px]/[1.5] text-muted-foreground">
          {children}
        </p>
      )}
    </div>
  );
}

/** Inline failure, in the place the thing failed. Never a toast — a wrong
 *  password belongs under the field it was typed into. */
export function StepError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <motion.p
      initial={{ opacity: 0, y: -3 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.16, ease: EASE_OUT }}
      role="alert"
      className="mt-2 text-center text-[12px]/[1.45] text-destructive"
    >
      {children}
    </motion.p>
  );
}
