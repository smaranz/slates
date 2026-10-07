"use client";

import { useEffect, useState } from "react";
import { IconKey } from "@tabler/icons-react";

import { Button } from "@whirl/components/ui/button";
import { Spinner } from "@whirl/components/ui/spinner";
import {
  StepHint,
  StepModal,
  StepModalCloseButton,
  SuccessStep,
} from "@whirl/components/ui/step-modal";
import { ratePassword } from "@whirl/lib/locked/crypto";
import { useLockActions, useThreadLock } from "@whirl/lib/locked/thread-lock";
import {
  PasswordField,
  StepError,
  StepHeading,
  StrengthMeter,
} from "./lock-bits";

/* Changing a locked chat's password. Short, because the work is small: the
   content key doesn't move, so nothing is re-encrypted and the recovery key
   the user printed keeps working. Only reachable on a chat that's already
   open in this tab — without the key there's nothing to re-wrap. */

type Step = "password" | "done";

export function ChangePasswordModal({
  threadId,
  open,
  onOpenChange,
}: {
  threadId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const actions = useLockActions();
  const lock = useThreadLock(threadId, open);

  const [step, setStep] = useState<Step>("password");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep("password");
    setPassword("");
    setConfirmation("");
    setBusy(false);
    setError(null);
  }, [open, threadId]);

  const matches = password.length > 0 && password === confirmation;
  /* Any password, same as when the lock was first set. */
  const weak = password.length > 0 && ratePassword(password).score <= 1;
  const canSubmit =
    password.length > 0 && matches && Boolean(lock?.lock) && !busy;

  const submit = async () => {
    if (!canSubmit || !threadId || !lock?.lock) return;
    setBusy(true);
    setError(null);
    try {
      await actions.changePassword(threadId, lock.lock, password);
      setPassword("");
      setConfirmation("");
      setStep("done");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Whirl cannot change the password. Try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <StepModal
      open={open}
      onOpenChange={onOpenChange}
      ariaLabel="Change this chat's password"
      step={step}
      buttons={
        step === "password" ? (
          <StepModalCloseButton onClose={() => onOpenChange(false)} />
        ) : null
      }
    >
      {step === "password" && (
        <div className="px-6 pt-9 pb-6">
          <StepHeading icon={IconKey} tone="info" title="New password">
            Your recovery key continues to work.
          </StepHeading>

          <div className="mt-5 flex flex-col gap-2">
            <PasswordField
              label="New password"
              placeholder="New password"
              value={password}
              autoFocus
              onChange={(next) => {
                setPassword(next);
                setError(null);
              }}
            />
            <StrengthMeter password={password} />
            <PasswordField
              label="Confirm new password"
              placeholder="Enter the password again"
              value={confirmation}
              onChange={(next) => {
                setConfirmation(next);
                setError(null);
              }}
              onEnter={() => void submit()}
              invalid={confirmation.length > 0 && !matches}
            />
          </div>

          <StepError>{error}</StepError>

          <Button
            className="mt-4 h-10 w-full"
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {busy ? (
              <>
                <Spinner size={15} />
                Changing…
              </>
            ) : (
              "Change password"
            )}
          </Button>
          <StepHint tone={weak ? "warn" : "muted"}>
            {weak
              ? "This password is weak. Whirl cannot reset it."
              : "The old password stops immediately."}
          </StepHint>
        </div>
      )}

      {step === "done" && (
        <SuccessStep
          title="Password changed"
          body="Use the new password the next time this chat asks. The recovery key does not change."
          onDone={() => onOpenChange(false)}
        />
      )}
    </StepModal>
  );
}
