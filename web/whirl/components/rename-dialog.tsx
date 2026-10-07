"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@whirl/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@whirl/components/ui/dialog";
import { Input } from "@whirl/components/ui/input";

/* One modal for every "type a name" moment: renaming threads and folders,
   and creating folders. Enter commits, Escape/backdrop closes; submitting
   an empty or unchanged value is a no-op. */
export function RenameDialog({
  open,
  onOpenChange,
  title,
  placeholder,
  submitLabel = "Save",
  initialValue = "",
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  placeholder: string;
  submitLabel?: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(initialValue);
    /* After the popup mounts, so focus + select land on the real input. */
    const id = requestAnimationFrame(() => inputRef.current?.select());
    return () => cancelAnimationFrame(id);
  }, [open, initialValue]);

  const trimmed = value.trim();
  const submittable = trimmed.length > 0 && trimmed !== initialValue.trim();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!submittable) return;
            onOpenChange(false);
            onSubmit(trimmed);
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          <Input
            ref={inputRef}
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
            maxLength={200}
            className="mt-3"
          />
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!submittable}>
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
