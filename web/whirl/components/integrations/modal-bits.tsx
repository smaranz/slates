"use client";

import { IntegrationLogo } from "@whirl/components/integration-logo";
import {
  StepModal,
  StepModalCloseButton,
  StepModalIconButton,
} from "@whirl/components/ui/step-modal";
import { VerifiedBadge } from "./verified-badge";

/* The store's own dressing for a multi-step modal. The shell itself —
   the sliding pages, the height morph, the overlay buttons, the success
   step — is v2's shared StepModal (components/ui/step-modal.tsx); what
   stays here is the part that's specifically a listing: who it's by, its
   logo, its meta chips. */

export { Spinner } from "@whirl/components/ui/spinner";
export {
  CopyLinkButton,
  StepHint,
  SuccessStep,
} from "@whirl/components/ui/step-modal";

export const StoreModal = StepModal;
export const ModalIconButton = StepModalIconButton;
export const ModalCloseButton = StepModalCloseButton;

/** A small meta capsule under the description ("6 tools", "Sign in"). */
export function ListingChip({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-well px-2.5 py-1 text-[11.5px] font-medium text-muted-foreground shadow-[inset_0_0_0_1px_var(--well-outline),inset_0_1px_0_0_var(--well-highlight)]">
      {children}
    </span>
  );
}

/** The details step's top half: who this listing is. */
export function ListingIdentity({
  name,
  author,
  verified,
  logoUrl,
  iconSvg,
  description,
  chips,
}: {
  name: string;
  author?: string;
  verified: boolean;
  logoUrl: string | null;
  iconSvg?: string;
  description?: string;
  chips?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center px-6 pt-9 text-center">
      <IntegrationLogo name={name} logoUrl={logoUrl} iconSvg={iconSvg} size={64} />
      {/* w-full, not shrink-to-fit: a centered column sizes its children to
          their content, so an un-widthed row would grow to the full name and
          carry it out of the card — truncate never getting a say. */}
      <div className="mt-3.5 flex w-full items-center justify-center gap-1.5">
        <h2 className="truncate text-[16px] font-semibold tracking-tight">
          {name}
        </h2>
        {verified && <VerifiedBadge size={16} />}
      </div>
      {author && (
        <p className="mt-0.5 w-full truncate text-xs text-muted-foreground/70">
          by {author}
        </p>
      )}
      {description && (
        <p className="mt-2.5 line-clamp-4 w-full break-words text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {chips && (
        <div className="mt-3.5 flex flex-wrap items-center justify-center gap-1.5">
          {chips}
        </div>
      )}
    </div>
  );
}
