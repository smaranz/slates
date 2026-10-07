"use client";

import { useEffect, useState } from "react";
import {
  IconAlertTriangleFilled,
  IconArrowLeft,
  IconCheck,
  IconCopy,
  IconDownload,
  IconKey,
  IconLockFilled,
  IconServerOff,
  IconShieldCheckFilled,
} from "@tabler/icons-react";

import { Button } from "@whirl/components/ui/button";
import { Spinner } from "@whirl/components/ui/spinner";
import {
  StepHint,
  StepModal,
  StepModalCloseButton,
  StepModalIconButton,
  SuccessStep,
} from "@whirl/components/ui/step-modal";
import { ratePassword } from "@whirl/lib/locked/crypto";
import { downloadRecoveryKey } from "@whirl/lib/locked/recovery-file";
import { useLockActions } from "@whirl/lib/locked/thread-lock";
import { showToast } from "@whirl/lib/toasts";
import {
  LockPoint,
  PasswordField,
  RecoveryKeyBlock,
  StepError,
  StepHeading,
  StrengthMeter,
} from "./lock-bits";

/* Locking a chat, in four pages of one card:

     how it works → set a password → keep the recovery key → done

   The lock is minted at the end of the password step, so by the time the
   recovery key is on screen the chat is genuinely locked and the user still
   knows the password they just typed. That ordering is deliberate: it means
   walking away from the key step is survivable, which is what lets the key
   step be about saving the key rather than about not losing the chat. */

type Step = "intro" | "password" | "key" | "done";

const STEP_ORDER: Step[] = ["intro", "password", "key", "done"];

export function LockSetupModal({
  open,
  onOpenChange,
  /** The thread being locked. Absent starts a fresh locked chat instead —
   *  and converting an existing one is what the intro has to warn about. */
  threadId,
  /** Fires with the (possibly new) thread id once the lock is on. */
  onLocked,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  threadId?: string;
  onLocked?: (threadId: string) => void;
}) {
  const actions = useLockActions();

  const [step, setStep] = useState<Step>("intro");
  const [back, setBack] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [lockedThreadId, setLockedThreadId] = useState<string | null>(null);

  /* A fresh slate every time it opens — a password left in state from a
     dismissed run has no business being the start of the next one. */
  useEffect(() => {
    if (!open) return;
    setStep("intro");
    setBack(false);
    setPassword("");
    setConfirmation("");
    setBusy(false);
    setError(null);
    setRecoveryCode(null);
    setSaved(false);
    setLockedThreadId(null);
  }, [open]);

  const goTo = (next: Step) => {
    setBack(STEP_ORDER.indexOf(next) < STEP_ORDER.indexOf(step));
    setError(null);
    setStep(next);
  };

  const converting = Boolean(threadId);
  const matches = password.length > 0 && password === confirmation;
  /* Any password is allowed. A weak one is the user's call to make — this
     is their chat and their risk — so the meter and the line under the
     button say so plainly and then get out of the way. The only thing
     actually held back is a typo in the second field. */
  const weak = password.length > 0 && ratePassword(password).score <= 1;
  const canSubmit = password.length > 0 && matches && !busy;

  const mintLock = async () => {
    if (!matches) {
      setError("The two passwords are not the same.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (threadId) {
        setRecoveryCode(await actions.lock(threadId, password));
        setLockedThreadId(threadId);
      } else {
        const created = await actions.lockNewThread(password);
        setRecoveryCode(created.recoveryCode);
        setLockedThreadId(created.threadId);
      }
      /* The password has done its job and has no reason to sit in memory
         for the rest of the dialog. */
      setPassword("");
      setConfirmation("");
      goTo("key");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Whirl cannot lock this chat. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onOpenChange(false);
    if (lockedThreadId) onLocked?.(lockedThreadId);
  };

  return (
    <StepModal
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Lock this chat"
      step={step}
      back={back}
      /* The recovery key is shown exactly once. Escaping past it is the one
         click in this flow that can quietly cost something. */
      dismissible={step !== "key"}
      buttons={
        step === "password" ? (
          <>
            <StepModalIconButton
              label="Back"
              className="left-3"
              onClick={() => goTo("intro")}
            >
              <IconArrowLeft size={15} stroke={2} />
            </StepModalIconButton>
            <StepModalCloseButton onClose={() => onOpenChange(false)} />
          </>
        ) : step === "intro" ? (
          <StepModalCloseButton onClose={() => onOpenChange(false)} />
        ) : null
      }
    >
      {step === "intro" && (
        <div className="px-6 pt-9 pb-6">
          <StepHeading icon={IconLockFilled} tone="plain" title="Lock this chat">
            Your password encrypts this chat.
          </StepHeading>

          <ul className="mt-5 flex flex-col gap-3">
            <LockPoint
              icon={IconShieldCheckFilled}
              tone="safe"
              index={0}
              title="Whirl cannot read it"
            >
              Your device encrypts each message first.
            </LockPoint>
            <LockPoint
              icon={IconServerOff}
              tone="info"
              index={1}
              title="Whirl does not store files"
            >
              Your files go to the model only.
            </LockPoint>
            <LockPoint
              icon={IconAlertTriangleFilled}
              tone="care"
              index={2}
              title="You cannot reset the password"
            >
              Whirl gives you a recovery key.
            </LockPoint>
          </ul>

          <div className="mt-5 rounded-xl bg-well px-3.5 py-3 text-left shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
            <p className="text-[12px]/[1.5] text-muted-foreground">
              A locked chat has no search, tools, documents, images, or memory.
              You cannot share it. Replies stop if you close this tab.
            </p>
          </div>

          {converting && (
            <StepHint tone="warn">
              Whirl deletes the files and documents in this chat.
            </StepHint>
          )}

          <Button className="mt-4 h-10 w-full" onClick={() => goTo("password")}>
            Set a password
          </Button>
        </div>
      )}

      {step === "password" && (
        <div className="px-6 pt-9 pb-6">
          <StepHeading icon={IconKey} tone="info" title="Set a password">
            This password opens the chat. Whirl does not store it.
          </StepHeading>

          <div className="mt-5 flex flex-col gap-2">
            <PasswordField
              label="Password"
              placeholder="Password"
              value={password}
              onChange={(next) => {
                setPassword(next);
                setError(null);
              }}
              autoFocus
            />
            <StrengthMeter password={password} />
            <PasswordField
              label="Confirm password"
              placeholder="Enter the password again"
              value={confirmation}
              onChange={(next) => {
                setConfirmation(next);
                setError(null);
              }}
              onEnter={() => canSubmit && void mintLock()}
              invalid={confirmation.length > 0 && !matches}
            />
          </div>

          <StepError>{error}</StepError>

          <Button
            className="mt-4 h-10 w-full"
            disabled={!canSubmit}
            onClick={() => void mintLock()}
          >
            {busy ? (
              <>
                <Spinner size={15} />
                Locking…
              </>
            ) : (
              "Lock this chat"
            )}
          </Button>
          {/* One line, two jobs: advice while the password is decent, a
              warning while it is not. Kept as one node so the card morphs
              its height instead of swapping elements. */}
          <StepHint tone={weak ? "warn" : "muted"}>
            {weak
              ? "This password is weak. Whirl cannot reset it."
              : "Use a long password. A short sentence is better than a complex word."}
          </StepHint>
        </div>
      )}

      {step === "key" && recoveryCode && (
        <div className="px-6 pt-9 pb-6">
          <StepHeading icon={IconKey} tone="care" title="Save your recovery key">
            Use this key if you forget the password. Whirl shows it one time.
          </StepHeading>

          <div className="mt-5">
            <RecoveryKeyBlock code={recoveryCode} />
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <CopyKeyButton code={recoveryCode} onCopied={() => setSaved(true)} />
            <Button
              variant="outline"
              className="h-9"
              onClick={() => {
                downloadRecoveryKey({
                  code: recoveryCode,
                  threadName: "Locked chat",
                });
                setSaved(true);
              }}
            >
              <IconDownload size={15} stroke={2} />
              Download
            </Button>
          </div>

          <Button
            className="mt-4 h-10 w-full"
            disabled={!saved}
            onClick={() => goTo("done")}
          >
            {saved ? "I saved it" : "Save the key first"}
          </Button>
          <StepHint tone="warn">
            Any person with this key can read the chat.
          </StepHint>
        </div>
      )}

      {step === "done" && (
        <SuccessStep
          title="This chat is locked"
          body="The chat stays open in this tab. Whirl asks for the password again after you reload the page."
          doneLabel="Continue"
          onDone={finish}
        />
      )}
    </StepModal>
  );
}

/** Copy, and say so — the same beat the store's copy-link button uses. */
function CopyKeyButton({
  code,
  onCopied,
}: {
  code: string;
  onCopied: () => void;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(id);
  }, [copied]);

  return (
    <Button
      variant="outline"
      className="h-9"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          onCopied();
        } catch {
          showToast("Whirl cannot copy the key. Select it and copy it.");
        }
      }}
    >
      {copied ? (
        <IconCheck size={15} stroke={2.25} className="text-emerald-500" />
      ) : (
        <IconCopy size={15} stroke={2} />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
