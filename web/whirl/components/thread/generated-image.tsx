"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { IconCheck, IconCopy, IconDownload } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";

import { BorderBeam } from "border-beam";

import { ImageLightbox } from "@whirl/components/ui/image-lightbox";
import { isTerminal, type ChatMessage } from "@whirl/lib/messages";
import { EASE_OUT, pinRasterPath, SHED_BLUR } from "@whirl/lib/motion";
import { useIsDark } from "@whirl/lib/theme";
import { showToast } from "@whirl/lib/toasts";

/* Generated images in the thread (ported from the main app): while the
   model paints, a square shimmer placeholder holds the space; the moment
   the picture lands it spring-morphs to the real aspect ratio and blooms
   in. Click opens the large view; glassy copy/download buttons float in
   the corner. Used by both the Image-tier slot (assistant attachments)
   and the paint tool's phase card. */

export const IMAGE_PLACEHOLDER_SIZE = 240;
const MAX_WIDTH = 360;
const MAX_HEIGHT = 400;

function fitDims(
  width: number,
  height: number,
  maxWidth: number,
  maxHeight: number,
) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {
    width: Math.max(120, Math.round(width * scale)),
    height: Math.max(120, Math.round(height * scale)),
  };
}

export const imageFrameClass =
  "relative block overflow-hidden rounded-2xl bg-black/[0.03] ring-1 ring-black/[0.06] dark:bg-white/[0.05] dark:ring-white/[0.08]";

/** The quiet square that holds an image's spot while it's painted: a
 * still base with one gleam sweeping across. The gleam is a CSS keyframe
 * (.image-shimmer-gleam) — the row re-renders on every reactive update,
 * which would restart a motion loop each time. */
export function ImageShimmer({ label }: { label: string }) {
  return (
    <div role="status" aria-label={label} className="absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-black/[0.05] dark:bg-white/[0.07]" />
      <div
        aria-hidden
        className="image-shimmer-gleam absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-white/50 to-transparent dark:via-white/[0.14]"
      />
    </div>
  );
}

/** The breathing border-beam that means "the model is working on this".
 * One tuning for every surface that paints, so a Kirkify on the marketing
 * page pulses exactly like a paint in the thread. */
export function GeneratingBeam({
  children,
  radius = 16,
}: {
  children: ReactNode;
  radius?: number;
}) {
  const dark = useIsDark();
  return (
    <BorderBeam
      size="pulse-inner"
      colorVariant="colorful"
      theme={dark ? "dark" : "light"}
      borderRadius={radius}
      brightness={1.7}
      saturation={1.5}
    >
      {children}
    </BorderBeam>
  );
}

/** The placeholder square for a picture still being *painted* (as opposed
 * to one merely loading its bytes): a still base wrapped in a breathing
 * border-beam, with the word itself shimmering in the center. The beam is
 * the whole "the model is working" tell — no gleam sweep competing with
 * it; loading states keep the plain ImageShimmer. */
export function GeneratingImageFrame({
  label,
  size = IMAGE_PLACEHOLDER_SIZE,
}: {
  label: string;
  size?: number;
}) {
  return (
    <GeneratingBeam>
      <div className={imageFrameClass} style={{ width: size, height: size }}>
        <div
          role="status"
          aria-label={label}
          className="absolute inset-0 bg-black/[0.05] dark:bg-white/[0.07]"
        />
        <div
          aria-hidden
          className="absolute inset-0 flex items-center justify-center"
        >
          <span className="text-shimmer text-[13.5px]/5 font-medium [--shimmer-dur:1600ms]">
            Generating...
          </span>
        </div>
      </div>
    </GeneratingBeam>
  );
}

async function fetchImageBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`fetch failed (${response.status})`);
  return await response.blob();
}

/** Clipboards only take PNG — re-encode anything else on the fly. */
async function toPngBlob(blob: Blob): Promise<Blob> {
  if (blob.type === "image/png") return blob;
  const bitmap = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  return await canvas.convertToBlob({ type: "image/png" });
}

/** A frosted icon button floating on top of the picture. */
function GlassButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 cursor-pointer items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-[background-color,scale] duration-150 hover:bg-black/60 active:scale-[0.92]"
    >
      {children}
    </button>
  );
}

/**
 * One generated image: starts as the shimmer square (or `initialSize`, for
 * a caller that already knows the shape), then spring-morphs to the
 * picture's natural aspect ratio within `maxWidth` x `maxHeight` and
 * reveals it with a blur-bloom once the bytes have arrived.
 */
export function MorphingImage({
  src,
  alt,
  downloadName = "generated-image.png",
  maxWidth = MAX_WIDTH,
  maxHeight = MAX_HEIGHT,
  initialSize,
  className = "",
}: {
  src: string;
  alt: string;
  downloadName?: string;
  maxWidth?: number;
  maxHeight?: number;
  /** The box to hold before the picture's own size is known. */
  initialSize?: { width: number; height: number };
  className?: string;
}) {
  const [dims, setDims] = useState<{ width: number; height: number } | null>(
    null,
  );
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyResetRef = useRef<number | null>(null);
  const display = dims
    ? fitDims(dims.width, dims.height, maxWidth, maxHeight)
    : (initialSize ?? {
        width: IMAGE_PLACEHOLDER_SIZE,
        height: IMAGE_PLACEHOLDER_SIZE,
      });
  const revealed = dims !== null;

  useEffect(
    () => () => {
      if (copyResetRef.current != null) {
        window.clearTimeout(copyResetRef.current);
      }
    },
    [],
  );

  const copyImage = () => {
    /* Flip to the check the instant the button is pressed — the
       confirmation answers the click, not the network. Handing the
       clipboard a *promise* of the PNG keeps the write inside the user
       gesture (Safari insists) while the bytes fetch behind it. */
    setCopied(true);
    if (copyResetRef.current != null) {
      window.clearTimeout(copyResetRef.current);
    }
    copyResetRef.current = window.setTimeout(() => setCopied(false), 1500);
    const png = fetchImageBlob(src).then(toPngBlob);
    navigator.clipboard
      .write([new ClipboardItem({ "image/png": png })])
      .catch(() => {
        if (copyResetRef.current != null) {
          window.clearTimeout(copyResetRef.current);
        }
        setCopied(false);
        showToast("Couldn't copy the image.");
      });
  };

  const downloadImage = async () => {
    try {
      /* The storage URL is cross-origin, where the download attribute is
         ignored — pull the bytes and hand over an object URL instead. */
      const blob = await fetchImageBlob(src);
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = downloadName;
      anchor.click();
      URL.revokeObjectURL(objectUrl);
    } catch {
      showToast("Couldn't download the image.");
    }
  };

  return (
    <>
      <motion.div
        initial={false}
        animate={{ width: display.width, height: display.height }}
        transition={{ type: "spring", stiffness: 420, damping: 28 }}
        className={`group/genimg ${imageFrameClass} ${className}`}
      >
        <AnimatePresence>
          {!revealed && (
            <motion.div
              key="shimmer"
              exit={{ opacity: 0 }}
              transition={{ duration: 0.25, ease: EASE_OUT }}
              className="absolute inset-0"
            >
              <ImageShimmer label="Generating image" />
            </motion.div>
          )}
        </AnimatePresence>
        <motion.img
          src={src}
          alt={alt}
          onLoad={(event) => {
            const img = event.currentTarget;
            if (img.naturalWidth > 0 && img.naturalHeight > 0) {
              setDims({ width: img.naturalWidth, height: img.naturalHeight });
            }
          }}
          initial={{ opacity: 0, scale: 1.06, filter: "blur(14px)" }}
          animate={
            revealed
              ? {
                  opacity: 1,
                  scale: 1,
                  filter: "blur(0px)",
                  transitionEnd: SHED_BLUR,
                }
              : undefined
          }
          transition={{ duration: 0.5, ease: EASE_OUT }}
          transformTemplate={pinRasterPath}
          className="absolute inset-0 h-full w-full object-cover"
        />
        {revealed && (
          <>
            {/* Full-bleed click target under the action cluster. */}
            <button
              type="button"
              aria-label={`View ${alt}`}
              onClick={() => setOpen(true)}
              className="absolute inset-0 cursor-zoom-in"
            />
            <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-100 transition-opacity duration-150 md:opacity-0 md:group-hover/genimg:opacity-100 md:group-focus-within/genimg:opacity-100">
              <GlassButton
                label={copied ? "Copied" : "Copy image"}
                onClick={copyImage}
              >
                {copied ? (
                  <IconCheck size={14} stroke={2.5} />
                ) : (
                  <IconCopy size={14} stroke={2} />
                )}
              </GlassButton>
              <GlassButton label="Download image" onClick={downloadImage}>
                <IconDownload size={14} stroke={2} />
              </GlassButton>
            </div>
          </>
        )}
      </motion.div>
      <ImageLightbox src={src} alt={alt} open={open} onOpenChange={setOpen} />
    </>
  );
}

/**
 * The whole slot for an Image-model reply: shimmer placeholder while
 * generating, morphing image(s) once they land as attachments on the
 * assistant row, nothing when the turn stopped or errored before any
 * paint. Renders above the (usually empty) prose.
 */
export function GeneratedImageSlot({ message }: { message: ChatMessage }) {
  const images = (message.attachments ?? []).filter(
    (attachment) => attachment.type.startsWith("image/") && attachment.url,
  );
  const generating = images.length === 0 && !isTerminal(message.status);

  if (!generating && images.length === 0) return null;

  return (
    <div className="mb-1.5 flex min-w-0 flex-wrap gap-1.5">
      {generating ? (
        <GeneratingImageFrame label="Generating image" />
      ) : (
        images.map((image) => (
          <MorphingImage
            key={image.id}
            src={image.url!}
            alt={image.name}
            downloadName={image.name || "generated-image.png"}
          />
        ))
      )}
    </div>
  );
}
