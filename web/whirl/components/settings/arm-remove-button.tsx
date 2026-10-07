"use client";

import { useEffect, useState } from "react";
import { IconTrash } from "@tabler/icons-react";

import { Button } from "@whirl/components/ui/button";

/* A trash glyph that arms into a real "Remove?" on the first tap and quietly
   disarms a few seconds later if the second tap never comes. The settings
   pane's answer to a confirm dialog for single-row deletions — cheap enough
   to undo that a modal would be overkill. */
export function ArmRemoveButton({
  label,
  confirmLabel = "Remove?",
  disabled,
  onRemove,
}: {
  /** What's being removed — becomes the icon button's accessible name. */
  label: string;
  confirmLabel?: string;
  disabled?: boolean;
  onRemove: () => void;
}) {
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 3500);
    return () => clearTimeout(id);
  }, [armed]);

  if (armed) {
    return (
      <Button
        variant="destructive"
        size="sm"
        disabled={disabled}
        onClick={() => {
          setArmed(false);
          onRemove();
        }}
      >
        {confirmLabel}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      aria-label={`Remove ${label}`}
      disabled={disabled}
      className="text-muted-foreground"
      onClick={() => setArmed(true)}
    >
      <IconTrash size={16} />
    </Button>
  );
}
