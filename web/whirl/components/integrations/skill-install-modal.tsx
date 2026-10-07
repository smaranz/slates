"use client";

import { useEffect, useRef, useState } from "react";
import { useAction } from "@whirl/backend/react";
import { IconBulbFilled } from "@tabler/icons-react";

import { api } from "@whirl/backend/convex/_generated/api";
import { Button } from "@whirl/components/ui/button";
import { errorText } from "@whirl/lib/integrations-data";
import { useModelAccess } from "@whirl/lib/model-access";
import type { StoreSkill } from "@whirl/lib/skills-data";
import { useView } from "@whirl/lib/view";
import {
  CopyLinkButton,
  ListingChip,
  ListingIdentity,
  ModalCloseButton,
  Spinner,
  StepHint,
  StoreModal,
  SuccessStep,
} from "./modal-bits";

/* The skill install journey is the integration modal's little sibling:
   details → done, no auth steps, no quota — a skill is just text. */
type Step = "details" | "done";

export function SkillInstallModal({
  skill,
  onClose,
  /** Signed-out mode: set to intercept installs with the sign-in modal. */
  onRequireAuth,
}: {
  skill: StoreSkill | null;
  onClose: () => void;
  onRequireAuth?: () => void;
}) {
  const install = useAction(api.skillStore.install);
  const { isPaid } = useModelAccess();
  const { openPricing } = useView();

  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = skill !== null;
  /* Latch the last listing so the dialog's exit animation never blanks.
     On commit, not during render — it's only read once `skill` is null,
     which is a commit later, and a discarded render must not get a say in
     what the closing dialog shows. */
  const lastRef = useRef<StoreSkill | null>(null);
  useEffect(() => {
    if (skill) lastRef.current = skill;
  }, [skill]);
  const listing = skill ?? lastRef.current;

  // Fresh slate whenever a different listing opens.
  useEffect(() => {
    if (!open) return;
    setStep("details");
    setBusy(false);
    setError(null);
  }, [open, skill?.id]);

  const onInstall = async () => {
    if (!listing || busy) return;
    if (onRequireAuth) {
      onRequireAuth();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await install({ id: listing.id });
      setStep("done");
    } catch (cause) {
      setError(errorText(cause, "Couldn't install that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!listing) return null;

  const locked = isPaid === false && !listing.installed;

  return (
    <StoreModal
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      ariaLabel={listing.name}
      step={step}
      buttons={
        <>
          {step === "details" && (
            <CopyLinkButton
              url={`${window.location.origin}/integrations?s=${encodeURIComponent(listing.id)}`}
            />
          )}
          <ModalCloseButton onClose={onClose} />
        </>
      }
    >
      {step === "details" ? (
        <div className="flex flex-col">
          <ListingIdentity
            name={listing.name}
            author={listing.author}
            verified={listing.verified}
            logoUrl={listing.logoUrl}
            iconSvg={listing.iconSvg}
            description={listing.description}
            chips={
              <ListingChip>
                <IconBulbFilled size={12} />
                Skill — instructions Whirl picks up mid-chat
              </ListingChip>
            }
          />
          <div className="px-6 pt-5 pb-6">
            {locked ? (
              <Button
                className="h-10 w-full"
                onClick={() => {
                  onClose();
                  openPricing();
                }}
              >
                See plans
              </Button>
            ) : (
              <Button
                className="h-10 w-full"
                disabled={busy || listing.installed}
                onClick={() => void onInstall()}
              >
                {busy && <Spinner />}
                {listing.installed ? "Installed" : "Install"}
              </Button>
            )}
            {error ? (
              <StepHint tone="warn">{error}</StepHint>
            ) : locked ? (
              <StepHint>Skills are part of the paid plan.</StepHint>
            ) : listing.installed ? (
              <StepHint>
                Whirl studies up whenever a chat calls for it.
              </StepHint>
            ) : (
              <StepHint>No setup — one click and Whirl knows it.</StepHint>
            )}
          </div>
        </div>
      ) : (
        <SuccessStep
          title={`${listing.name} is in!`}
          body="Whirl will study up whenever a chat calls for it. Manage it anytime from the Installed tab."
          onDone={onClose}
        />
      )}
    </StoreModal>
  );
}
