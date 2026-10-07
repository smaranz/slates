"use client";

import { useEffect, useRef, useState } from "react";
import {
  IconArrowLeft,
  IconFileUpload,
  IconKey,
  IconLockFilled,
} from "@tabler/icons-react";
import { motion } from "motion/react";

import { Button } from "@whirl/components/ui/button";
import { Input } from "@whirl/components/ui/input";
import { Spinner } from "@whirl/components/ui/spinner";
import {
  StepHint,
  StepModal,
  StepModalCloseButton,
  StepModalIconButton,
} from "@whirl/components/ui/step-modal";
import {
  formatRecoveryCode,
  normalizeRecoveryCode,
  RECOVERY_CODE_LENGTH,
} from "@whirl/lib/locked/crypto";
import { readRecoveryKeyFromFile } from "@whirl/lib/locked/recovery-file";
import { useLockActions, useThreadLock } from "@whirl/lib/locked/thread-lock";
import { EASE_OUT } from "@whirl/lib/motion";
import { ANALYTICS_EVENTS, captureEvent } from "@whirl/lib/posthog";
import { NO_CAPTURE } from "@whirl/lib/replay-guard";
import { cn } from "@whirl/lib/utils";
import { PasswordField, StepError, StepHeading } from "./lock-bits";

/* Getting back into a locked chat. Two doors, one card:

     password  ⇄  recovery key

   The chat's real name is sealed along with everything else, so there is
   nothing to greet the user with here — deliberately. A locked row gives
   away nothing until it's open. */

type Step = "password" | "recovery";

export function UnlockModal({
  threadId,
  open,
  onOpenChange,
  onUnlocked,
}: {
  threadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUnlocked?: () => void;
}) {
  const actions = useLockActions();
  const lock = useThreadLock(threadId, open);

  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setStep("password");
    setPassword("");
    setCode("");
    setBusy(false);
    setError(null);
  }, [open, threadId]);

  const envelope = lock?.lock ?? null;

  const attempt = async (unlock: () => Promise<void>, via: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await unlock();
      onOpenChange(false);
      onUnlocked?.();
    } catch (cause) {
      captureEvent(ANALYTICS_EVENTS.threadUnlockFailed, { via });
      setError(
        cause instanceof Error
          ? cause.message
          : "Whirl cannot open the chat. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const submitPassword = () => {
    if (!envelope || !threadId || password.length === 0) return;
    void attempt(
      () => actions.unlockWithPassword(threadId, envelope, password),
      "password",
    );
  };

  const submitCode = () => {
    if (!envelope || !threadId || code.trim().length === 0) return;
    void attempt(
      () => actions.unlockWithRecoveryCode(threadId, envelope, code),
      "recovery_key",
    );
  };

  const readFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    const found = readRecoveryKeyFromFile(
      await file.text(),
      RECOVERY_CODE_LENGTH,
    );
    if (!found) {
      setError("This file does not contain a recovery key.");
      return;
    }
    setCode(formatRecoveryCode(found));
  };

  const typed = normalizeRecoveryCode(code);
  const codeComplete = typed.length === RECOVERY_CODE_LENGTH;

  return (
    <StepModal
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Unlock this chat"
      step={step}
      back={step === "password"}
      buttons={
        step === "recovery" ? (
          <>
            <StepModalIconButton
              label="Back"
              className="left-3"
              onClick={() => {
                setError(null);
                setStep("password");
              }}
            >
              <IconArrowLeft size={15} stroke={2} />
            </StepModalIconButton>
            <StepModalCloseButton onClose={() => onOpenChange(false)} />
          </>
        ) : (
          <StepModalCloseButton onClose={() => onOpenChange(false)} />
        )
      }
    >
      {step === "password" && (
        <div className="px-6 pt-9 pb-6">
          <StepHeading
            icon={IconLockFilled}
            tone="plain"
            title="This chat is locked"
          >
            Enter your password to open it.
          </StepHeading>

          <div className="mt-5">
            <PasswordField
              label="Password"
              placeholder="Password"
              value={password}
              autoFocus
              autoComplete="current-password"
              onChange={(next) => {
                setPassword(next);
                setError(null);
              }}
              onEnter={submitPassword}
              invalid={Boolean(error)}
            />
          </div>

          <StepError>{error}</StepError>

          <Button
            className="mt-4 h-10 w-full"
            disabled={busy || password.length === 0 || !envelope}
            onClick={submitPassword}
          >
            {busy ? (
              <>
                <Spinner size={15} />
                Unlocking…
              </>
            ) : (
              "Unlock"
            )}
          </Button>

          <button
            type="button"
            onClick={() => {
              setError(null);
              setStep("recovery");
            }}
            className="mt-3 w-full cursor-pointer text-center text-[12.5px] text-muted-foreground transition-colors duration-100 hover:text-foreground"
          >
            Use a recovery key
          </button>
        </div>
      )}

      {step === "recovery" && (
        <div className="px-6 pt-9 pb-6">
          <StepHeading icon={IconKey} tone="info" title="Use your recovery key">
            Upload the key file, or enter the key.
          </StepHeading>

          <DropZone onFile={readFile} onBrowse={() => fileRef.current?.click()} />
          <input
            ref={fileRef}
            type="file"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(event) => {
              void readFile(event.target.files?.[0]);
              // Same file twice in a row still fires.
              event.target.value = "";
            }}
          />

          <Input
            value={code}
            spellCheck={false}
            autoComplete="off"
            placeholder="XXXXX-XXXXX-XXXXX-…"
            aria-label="Recovery key"
            onChange={(event) => {
              setCode(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              submitCode();
            }}
            className={cn(
              "mt-2.5 h-10 text-center font-mono text-[12.5px] tracking-[0.06em]",
              NO_CAPTURE,
            )}
          />

          <StepError>{error}</StepError>

          <Button
            className="mt-4 h-10 w-full"
            disabled={busy || !codeComplete || !envelope}
            onClick={submitCode}
          >
            {busy ? (
              <>
                <Spinner size={15} />
                Unlocking…
              </>
            ) : (
              "Unlock"
            )}
          </Button>
          <StepHint>
            {code.length > 0 && !codeComplete
              ? `${typed.length} of ${RECOVERY_CODE_LENGTH} characters.`
              : "Dashes, spaces, and capital letters are not important."}
          </StepHint>
        </div>
      )}
    </StepModal>
  );
}

/** Drop the recovery file, or click to pick one. Highlights while a file is
 *  over it — the only state it has. */
function DropZone({
  onFile,
  onBrowse,
}: {
  onFile: (file: File | undefined) => void;
  onBrowse: () => void;
}) {
  const [over, setOver] = useState(false);
  return (
    <motion.button
      type="button"
      onClick={onBrowse}
      onDragOver={(event) => {
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        onFile(event.dataTransfer.files?.[0]);
      }}
      initial={false}
      animate={{ scale: over ? 1.015 : 1 }}
      transition={{ duration: 0.14, ease: EASE_OUT }}
      className={cn(
        "mt-5 flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-xl border border-dashed px-4 py-5 transition-colors duration-150",
        over
          ? "border-foreground/40 bg-accent"
          : "border-border hover:bg-accent",
      )}
    >
      <IconFileUpload
        size={20}
        stroke={1.75}
        className="text-sky-600 dark:text-sky-400"
      />
      <span className="text-[12.5px] font-medium">Drop the key file here</span>
      <span className="text-[11.5px] text-muted-foreground">
        Or click to select a file
      </span>
    </motion.button>
  );
}
