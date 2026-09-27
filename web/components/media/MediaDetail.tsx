"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

import { MEDIA_KIND_LABEL } from "@/lib/media/types";
import { Icon, ICON } from "../ui";
import { clock, fileUrl, modelLabel } from "./MediaGallery";
import type { MediaEntry } from "./useMediaLibrary";

/** Full-window viewer for one library item, with the item's facts and actions beside it. */

function facts(item: MediaEntry, parent: MediaEntry | undefined): [string, string][] {
  const options = item.options;
  const rows: [string, string | null | undefined][] = [
    ["Model", modelLabel(item.model)],
    ["Voice", item.kind === "speech" ? item.voiceName ?? (typeof options.voice_id === "string" ? options.voice_id : null) : null],
    ["Length", item.durationSec !== undefined ? clock(item.durationSec) : null],
    ["Shape", typeof options.aspect_ratio === "string" ? (options.aspect_ratio === "auto" ? "Auto" : options.aspect_ratio) : null],
    ["Size", typeof options.resolution === "string" ? options.resolution : null],
    ["Quality", typeof options.quality === "string" ? (options.quality === "xhigh" ? "Extra high" : options.quality[0]!.toUpperCase() + options.quality.slice(1)) : null],
    ["Audio", typeof options.generate_audio === "boolean" ? (options.generate_audio ? "On" : "Off") : null],
    ["Loop", item.kind === "sfx" ? (options.loop === true ? "Yes" : "No") : null],
    ["Follow prompt", typeof options.prompt_influence === "number" ? `${Math.round(options.prompt_influence * 100)}%` : null],
    ["Vocals", item.kind === "music" ? (options.force_instrumental === true ? "None" : "If the prompt asks") : null],
    ["Avoid", typeof options.negative_prompt === "string" ? options.negative_prompt : null],
    ["Starts from", parent ? parent.prompt : item.parentId ?? null],
    ["Made", `${new Date(item.createdAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}${item.source === "mcp" ? " by an agent" : ""}`],
    ["File", item.bytes !== undefined ? `${(item.bytes / 1024 / 1024).toFixed(item.bytes < 1024 * 1024 ? 2 : 1)} MB` : null],
  ];
  return rows.filter((row): row is [string, string] => !!row[1]);
}

export default function MediaDetail({
  item,
  items,
  onNavigate,
  onClose,
  onReuse,
  onAnimate,
  onRetry,
  onDelete,
}: {
  item: MediaEntry;
  items: MediaEntry[];
  onNavigate: (item: MediaEntry) => void;
  onClose: () => void;
  onReuse: (item: MediaEntry) => void;
  onAnimate: (item: MediaEntry) => void;
  onRetry: (item: MediaEntry) => void;
  onDelete: (item: MediaEntry) => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const index = items.findIndex((entry) => entry.id === item.id);
  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 && index < items.length - 1 ? items[index + 1] : undefined;
  const parent = item.parentId ? items.find((entry) => entry.id === item.parentId) : undefined;
  const file = item.status === "completed" ? fileUrl(item) : null;

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(".media-viewer-close")?.focus();
    return () => opener?.focus();
  }, []);

  useEffect(() => {
    const root = dialog.current;
    const keydown = (event: KeyboardEvent) => {
      const typing = event.target instanceof HTMLElement && event.target.closest("input, textarea, select, video, audio");
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (!typing && event.key === "ArrowLeft" && previous) {
        event.preventDefault();
        onNavigate(previous);
      } else if (!typing && event.key === "ArrowRight" && next) {
        event.preventDefault();
        onNavigate(next);
      } else if (event.key === "Tab" && root) {
        const focusables = Array.from(root.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], video, audio"));
        if (!focusables.length) return;
        const first = focusables[0]!;
        const last = focusables.at(-1)!;
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [next, onClose, onNavigate, previous]);

  function copy(label: string, value: string) {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(label);
      window.setTimeout(() => setCopied((current) => (current === label ? null : current)), 1500);
    }).catch(() => {});
  }

  function askDelete() {
    if (confirming) {
      onDelete(item);
      return;
    }
    setConfirming(true);
    window.setTimeout(() => setConfirming(false), 4000);
  }

  return (
    <div ref={dialog} className="media-viewer" role="dialog" aria-modal="true" aria-label={`${MEDIA_KIND_LABEL[item.kind]}: ${item.prompt}`}>
      <div className="media-viewer-stage" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        {previous && (
          <button type="button" className="media-viewer-nav is-prev" aria-label="Previous" onClick={() => onNavigate(previous)}>
            <Icon path={ICON.chevronLeft} size={16} />
          </button>
        )}
        {file && item.kind === "image" && (
          <Image key={item.id} src={file} alt={item.prompt} width={1600} height={1600} unoptimized className="media-viewer-media" />
        )}
        {file && item.kind === "video" && <video key={item.id} src={file} controls playsInline className="media-viewer-media" />}
        {file && !["image", "video"].includes(item.kind) && (
          <div className="media-viewer-audio">
            <p>{item.prompt}</p>
            <audio key={item.id} src={file} controls />
          </div>
        )}
        {item.status === "generating" && <p className="media-viewer-status">Generating. This updates on its own.</p>}
        {item.status === "failed" && <p className="media-viewer-status">{item.error || "This one failed without a reason."}</p>}
        {next && (
          <button type="button" className="media-viewer-nav is-next" aria-label="Next" onClick={() => onNavigate(next)}>
            <Icon path={ICON.chevronLeft} size={16} />
          </button>
        )}
      </div>

      <aside className="media-viewer-side">
        <div className="media-viewer-head">
          <span>{MEDIA_KIND_LABEL[item.kind]}{item.status === "completed" ? "" : ` · ${item.status === "generating" ? "Generating" : "Failed"}`}</span>
          <button type="button" className="media-icon media-viewer-close" aria-label="Close" onClick={onClose}>
            <Icon path={ICON.close} size={13} />
          </button>
        </div>

        <p className="media-viewer-prompt">{item.prompt}</p>

        <dl className="media-facts">
          {facts(item, parent).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>

        {item.filePath && (
          <div className="media-path">
            <code>{item.filePath}</code>
            <button type="button" className="media-icon" aria-label="Copy file path" title="Copy file path" onClick={() => copy("path", item.filePath!)}>
              <Icon path={copied === "path" ? ICON.check : ICON.copy} size={12} />
            </button>
          </div>
        )}

        <div className="media-actions">
          {file && (
            <a className="media-action" href={fileUrl(item, true)}>
              <Icon path={ICON.download} size={13} /> Download
            </a>
          )}
          <button type="button" className="media-action" onClick={() => copy("id", item.id)}>
            <Icon path={copied === "id" ? ICON.check : ICON.copy} size={13} /> {copied === "id" ? "Copied" : "Copy ID for agents"}
          </button>
          <button type="button" className="media-action" onClick={() => onReuse(item)}>
            <Icon path={ICON.compose} size={13} /> Use this prompt
          </button>
          {item.kind === "image" && item.status === "completed" && item.remoteId && (
            <button type="button" className="media-action" onClick={() => onAnimate(item)}>
              <Icon path={ICON.play} size={13} /> Turn into a video
            </button>
          )}
          {item.status === "failed" && (
            <button type="button" className="media-action" onClick={() => onRetry(item)}>
              <Icon path={ICON.retry} size={13} /> Retry
            </button>
          )}
          <button type="button" className={`media-action is-danger${confirming ? " is-confirming" : ""}`} disabled={item.status === "generating"} onClick={askDelete}>
            <Icon path={ICON.trash} size={13} /> {confirming ? "Press again to delete" : "Delete"}
          </button>
        </div>
      </aside>
    </div>
  );
}
