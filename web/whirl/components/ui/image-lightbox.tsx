"use client";

import { IconX } from "@tabler/icons-react";

import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@whirl/components/ui/dialog";

/* A large-view image preview: the picture floats centered on a dimmed,
   frosted scrim, sized to itself. Click anywhere outside (or the X, or
   Escape) to dismiss. Shared by attachment thumbs and generated images —
   anything image-shaped that deserves a closer look. */

export function ImageLightbox({
  src,
  alt,
  open,
  onOpenChange,
}: {
  src: string;
  alt: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={alt}
        backdropClassName="bg-black/70 backdrop-blur-sm"
        className="top-1/2 w-auto max-w-[calc(100vw-3rem)] -translate-y-1/2 rounded-2xl bg-transparent p-0 ring-0"
      >
        <DialogTitle className="sr-only">{alt}</DialogTitle>
        {/* eslint-disable-next-line @next/next/no-img-element -- Convex storage URL */}
        <img
          src={src}
          alt={alt}
          className="max-h-[85vh] w-auto max-w-full rounded-2xl object-contain"
        />
        <DialogClose
          aria-label="Close image"
          className="absolute top-3 right-3 flex size-9 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors duration-150 hover:bg-black/60"
        >
          <IconX size={17} stroke={2.2} />
        </DialogClose>
      </DialogContent>
    </Dialog>
  );
}
