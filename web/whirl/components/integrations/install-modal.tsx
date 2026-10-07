"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAction } from "@whirl/backend/react";
import { IconArrowLeft, IconKeyFilled, IconTool } from "@tabler/icons-react";

import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";
import { IntegrationLogo } from "@whirl/components/integration-logo";
import { Button } from "@whirl/components/ui/button";
import { Input } from "@whirl/components/ui/input";
import {
  errorText,
  openAuthPopup,
  useOAuthResult,
  type StoreIntegration,
} from "@whirl/lib/integrations-data";
import { useModelAccess } from "@whirl/lib/model-access";
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

/* The install journey, one card, several steps — each step is a full page
   of the card and the card slides between them:
     details → (apiKey: fill fields) or (oauth: wait for the popup) → done.
   "none" integrations hop straight from details to done. Errors land
   inline on the step they belong to, never in a toast you might miss. */
type Step = "details" | "apiKey" | "oauth" | "done";

export function IntegrationInstallModal({
  integration,
  onClose,
  /** Signed-out mode: set to intercept installs with the sign-in modal. */
  onRequireAuth,
}: {
  integration: StoreIntegration | null;
  onClose: () => void;
  onRequireAuth?: () => void;
}) {
  const install = useAction(api.integrationStore.install);
  const startOAuth = useAction(api.mcpOAuthFlow.startOAuth);
  const startComposio = useAction(api.integrationStore.startComposioConnect);
  const { isPaid } = useModelAccess();
  const { openPricing } = useView();

  const [step, setStep] = useState<Step>("details");
  const [busy, setBusy] = useState(false);
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [serverId, setServerId] = useState<Id<"mcpServers"> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = integration !== null;
  /* The dialog's exit animation still shows content after the caller nulls
     the listing — latch the last one so the card never blanks mid-close.
     Latched on commit, not during render: the latch is only ever read once
     `integration` has gone null, which is at least a commit later, so an
     effect is early enough — and a render React discards can't leave the
     wrong listing behind to flash on the way out. */
  const lastRef = useRef<StoreIntegration | null>(null);
  useEffect(() => {
    if (integration) lastRef.current = integration;
  }, [integration]);
  const listing = integration ?? lastRef.current;

  // Fresh slate whenever a different listing opens.
  useEffect(() => {
    if (!open) return;
    setStep("details");
    setBusy(false);
    setSecrets({});
    setServerId(null);
    setError(null);
  }, [open, integration?.id]);

  // The OAuth popup posts back through its opener; while the waiting step
  // is up, that message is ours.
  useOAuthResult(({ ok, error: message }) => {
    if (step !== "oauth") return;
    if (ok) setStep("done");
    else setError(message ?? "The sign-in didn't finish. Try again.");
  });

  const beginOAuth = useCallback(
    async (id: Id<"mcpServers">) => {
      setError(null);
      // Composio-backed listings sign in through Composio's hosted link
      // flow; everything else runs MCP-spec OAuth. Same popup, same
      // callback dialect.
      await openAuthPopup(async () =>
        listing?.composioConnect
          ? (await startComposio({ id })).redirectUrl
          : (await startOAuth({ id })).authorizationUrl,
      );
    },
    [listing, startOAuth, startComposio],
  );

  const onInstall = async () => {
    if (!listing || busy) return;
    if (onRequireAuth) {
      onRequireAuth();
      return;
    }
    setError(null);
    if (listing.authMode === "apiKey") {
      setStep("apiKey");
      return;
    }
    setBusy(true);
    try {
      // An install abandoned mid-sign-in resumes with its existing row
      // instead of installing again.
      const id =
        listing.installedServerId ??
        (await install({ id: listing.id })).serverId;
      if (listing.authMode === "oauth" || listing.composioConnect) {
        setServerId(id);
        setStep("oauth");
        // A failed launch surfaces on the waiting step, where retry lives.
        try {
          await beginOAuth(id);
        } catch (cause) {
          setError(errorText(cause, "Couldn't start the sign-in. Try again."));
        }
      } else {
        setStep("done");
      }
    } catch (cause) {
      setError(errorText(cause, "Couldn't install that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  const onSubmitSecrets = async () => {
    if (!listing || busy) return;
    const filled = listing.authFields.map((field) => ({
      key: field.key,
      value: (secrets[field.key] ?? "").trim(),
    }));
    if (filled.some((field) => !field.value)) {
      setError("Fill in every field first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await install({ id: listing.id, secrets: filled });
      setStep("done");
    } catch (cause) {
      setError(errorText(cause, "Couldn't install that. Try again."));
    } finally {
      setBusy(false);
    }
  };

  if (!listing) return null;

  const installed = listing.installedConnected;
  // An OAuth install that never finished signing in: offer to pick it up.
  const pendingAuth = listing.installedServerId !== null && !installed;
  const locked = isPaid === false && !installed;
  const needsSignInFlow =
    listing.authMode === "oauth" || listing.composioConnect;

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
              url={`${window.location.origin}/integrations?i=${encodeURIComponent(listing.id)}`}
            />
          )}
          <ModalCloseButton onClose={onClose} />
        </>
      }
    >
      {step === "details" && (
        <div className="flex flex-col">
          <ListingIdentity
            name={listing.name}
            author={listing.author}
            verified={listing.verified}
            logoUrl={listing.logoUrl}
            iconSvg={listing.iconSvg}
            description={listing.description}
            chips={
              <>
                {listing.toolCount > 0 && (
                  <ListingChip>
                    <IconTool size={12} stroke={2} />
                    {listing.toolCount}{" "}
                    {listing.toolCount === 1 ? "tool" : "tools"}
                  </ListingChip>
                )}
                {(listing.authMode !== "none" || listing.composioConnect) && (
                  <ListingChip>
                    <IconKeyFilled size={12} />
                    {listing.authMode === "apiKey"
                      ? "Needs an API key"
                      : "Sign in to connect"}
                  </ListingChip>
                )}
              </>
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
                disabled={busy || installed}
                onClick={() => void onInstall()}
              >
                {busy && <Spinner />}
                {installed
                  ? "Installed"
                  : pendingAuth
                    ? "Finish connecting"
                    : "Install"}
              </Button>
            )}
            {error ? (
              <StepHint tone="warn">{error}</StepHint>
            ) : locked ? (
              <StepHint>Integrations are part of the paid plan.</StepHint>
            ) : installed ? (
              <StepHint>Mention it in any chat to put it to work.</StepHint>
            ) : needsSignInFlow ? (
              <StepHint>
                The only window that opens is their own sign-in.
              </StepHint>
            ) : listing.authMode === "apiKey" ? (
              <StepHint>You'll paste a key on the next step.</StepHint>
            ) : (
              <StepHint>No sign-in needed — one click and it's yours.</StepHint>
            )}
          </div>
        </div>
      )}

      {step === "apiKey" && (
        <div className="px-6 pt-8 pb-6">
          <div className="flex items-center gap-3">
            <IntegrationLogo
              name={listing.name}
              logoUrl={listing.logoUrl}
              iconSvg={listing.iconSvg}
              size={36}
            />
            <div className="min-w-0">
              <h2 className="truncate text-[15px] font-semibold tracking-tight">
                Connect {listing.name}
              </h2>
              <p className="text-xs text-muted-foreground/70">
                One quick step and it's yours
              </p>
            </div>
          </div>

          {listing.authInstructions && (
            <p className="mt-3.5 rounded-lg bg-well px-3 py-2.5 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
              {listing.authInstructions}
            </p>
          )}

          <form
            className="mt-4 flex flex-col gap-3 text-left"
            onSubmit={(event) => {
              event.preventDefault();
              void onSubmitSecrets();
            }}
          >
            {listing.authFields.map((field, index) => (
              <label key={field.key} className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {field.label}
                </span>
                <Input
                  type="password"
                  autoComplete="off"
                  autoFocus={index === 0}
                  value={secrets[field.key] ?? ""}
                  onChange={(event) => {
                    setError(null);
                    setSecrets((prev) => ({
                      ...prev,
                      [field.key]: event.target.value,
                    }));
                  }}
                  placeholder="Paste it here"
                />
              </label>
            ))}
            {error && (
              <p className="text-[12.5px] break-words text-destructive">
                {error}
              </p>
            )}
            <div className="mt-1 flex items-center gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  setStep("details");
                }}
              >
                <IconArrowLeft size={14} stroke={2} />
                Back
              </Button>
              <Button type="submit" disabled={busy} className="h-9 flex-1">
                {busy && <Spinner />}
                Connect
              </Button>
            </div>
          </form>
          <StepHint>
            Stored encrypted, never shown to anyone — not even you.
          </StepHint>
        </div>
      )}

      {step === "oauth" && (
        <div className="flex flex-col items-center px-6 pt-10 pb-6 text-center">
          <IntegrationLogo
            name={listing.name}
            logoUrl={listing.logoUrl}
            iconSvg={listing.iconSvg}
            size={52}
          />
          {error ? (
            <>
              <h2 className="mt-4 text-[15px] font-semibold tracking-tight">
                That didn't go through
              </h2>
              <p className="mt-1.5 max-w-xs break-words text-[13px] leading-relaxed text-muted-foreground">
                {error}
              </p>
              <Button
                className="mt-5 h-10 w-full"
                onClick={() => {
                  if (serverId)
                    void beginOAuth(serverId).catch((cause: unknown) =>
                      setError(
                        errorText(
                          cause,
                          "Couldn't start the sign-in. Try again.",
                        ),
                      ),
                    );
                }}
              >
                Try signing in again
              </Button>
            </>
          ) : (
            <>
              <span className="mt-5 text-muted-foreground">
                <Spinner size={20} />
              </span>
              <h2 className="mt-4 text-[15px] font-semibold tracking-tight">
                Waiting for you to sign in
              </h2>
              <p className="mt-1.5 max-w-xs break-words text-[13px] leading-relaxed text-muted-foreground">
                Finish connecting {listing.name} in the popup window. We'll take
                it from there.
              </p>
            </>
          )}
        </div>
      )}

      {step === "done" && (
        <SuccessStep
          title={`${listing.name} is in!`}
          body="Whirl can now use its tools in any chat. Manage it anytime from the Installed tab."
          onDone={onClose}
        />
      )}
    </StoreModal>
  );
}
