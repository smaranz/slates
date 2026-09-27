"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

import { IMAGE_MODELS, MUSIC_MODELS, SPEECH_MODELS, VIDEO_MODELS } from "@/lib/media/catalog";
import { MEDIA_KIND_LABEL, type MediaKind } from "@/lib/media/types";
import { Icon, ICON, Spinner } from "../ui";
import type { MediaEntry } from "./useMediaLibrary";

/** The library: visual work as a justified grid, audio as a track list, both by day. */

export type MediaFilter = MediaKind | "all";

const FILTERS: MediaFilter[] = ["all", "image", "video", "speech", "sfx", "music"];
const VISUAL: MediaKind[] = ["image", "video"];

const MODEL_LABEL = new Map<string, string>(
  [...IMAGE_MODELS, ...VIDEO_MODELS, ...SPEECH_MODELS, ...MUSIC_MODELS].map((model) => [model.id, model.label]),
);

export function modelLabel(id: string): string {
  return MODEL_LABEL.get(id) ?? id;
}

export function fileUrl(item: MediaEntry, download = false): string {
  return `/api/media/file?id=${encodeURIComponent(item.id)}${download ? "&download=1" : ""}`;
}

export function clock(seconds?: number): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

export function isVisual(item: MediaEntry): boolean {
  return VISUAL.includes(item.kind);
}

export function trackMeta(item: MediaEntry): string {
  if (item.status === "failed") return `Failed · ${item.error || "no reason given"}`;
  if (item.status === "generating") return "Generating";
  if (item.kind === "speech") return [item.voiceName ?? "Default voice", modelLabel(item.model)].join(" · ");
  if (item.kind === "sfx") return item.options.loop === true ? "Loops" : "One shot";
  return [modelLabel(item.model), item.options.force_instrumental === true ? "Instrumental" : null].filter(Boolean).join(" · ");
}

function ratioOf(item: MediaEntry, measured: Record<string, number>): number {
  if (measured[item.id]) return measured[item.id]!;
  const value = item.options.aspect_ratio;
  if (typeof value === "string" && /^\d+:\d+$/.test(value)) {
    const [w, h] = value.split(":").map(Number);
    if (w && h) return w / h;
  }
  return item.kind === "video" ? 16 / 9 : 1;
}

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function dayLabel(day: number, now: number): string {
  if (now) {
    const diff = Math.round((startOfDay(now) - day) / 86_400_000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
  }
  const date = new Date(day);
  const sameYear = !now || new Date(now).getFullYear() === date.getFullYear();
  return date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function VideoPreview({ item, onRatio }: { item: MediaEntry; onRatio: (ratio: number) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [length, setLength] = useState<number | undefined>(item.durationSec);
  return (
    <>
      <video
        ref={video}
        src={fileUrl(item)}
        muted
        loop
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const el = event.currentTarget;
          if (el.videoWidth && el.videoHeight) onRatio(el.videoWidth / el.videoHeight);
          if (Number.isFinite(el.duration)) setLength(el.duration);
        }}
        onMouseEnter={() => {
          if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) void video.current?.play().catch(() => {});
        }}
        onMouseLeave={() => {
          if (!video.current) return;
          video.current.pause();
          video.current.currentTime = 0;
        }}
      />
      {length !== undefined && <span className="media-badge">{clock(length)}</span>}
    </>
  );
}

export default function MediaGallery({
  items,
  visible,
  filter,
  query,
  loading,
  notice,
  onFilter,
  onQuery,
  onOpen,
  onRetry,
}: {
  items: MediaEntry[];
  visible: MediaEntry[];
  filter: MediaFilter;
  query: string;
  loading: boolean;
  notice: ReactNode;
  onFilter: (filter: MediaFilter) => void;
  onQuery: (query: string) => void;
  onOpen: (item: MediaEntry) => void;
  onRetry: (item: MediaEntry) => void;
}) {
  const [now, setNow] = useState(0);
  const [measured, setMeasured] = useState<Record<string, number>>({});
  const [playing, setPlaying] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [player, setPlayer] = useState<HTMLAudioElement | null>(null);
  const generating = items.some((item) => item.status === "generating");

  useEffect(() => {
    const first = window.setTimeout(() => setNow(Date.now()), 0);
    if (!generating) return () => window.clearTimeout(first);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [generating, items]);

  useEffect(() => () => player?.pause(), [player]);

  function measure(id: string, ratio: number) {
    setMeasured((current) => (current[id] && Math.abs(current[id]! - ratio) < 0.01 ? current : { ...current, [id]: ratio }));
  }

  useEffect(() => {
    if (!player) return;
    if (!playing) {
      player.pause();
      return;
    }
    void player.play().catch(() => setPlaying(null));
  }, [player, playing]);

  function play(item: MediaEntry) {
    setProgress(0);
    setPlaying((current) => (current === item.id ? null : item.id));
  }

  const days = new Map<number, MediaEntry[]>();
  for (const item of visible) {
    const key = startOfDay(item.createdAt);
    days.set(key, [...(days.get(key) ?? []), item]);
  }

  const elapsed = (item: MediaEntry) => clock(now ? Math.max(0, (now - item.createdAt) / 1000) : 0);

  return (
    <section className="media-library" aria-label="Library">
      <audio
        ref={setPlayer}
        src={playing ? `/api/media/file?id=${encodeURIComponent(playing)}` : undefined}
        preload="none"
        onTimeUpdate={(event) => {
          const el = event.currentTarget;
          if (el.duration) setProgress(el.currentTime / el.duration);
        }}
        onEnded={() => setPlaying(null)}
        onError={() => setPlaying(null)}
      />

      <div className="media-bar">
        <div className="useg" role="tablist" aria-label="Show">
          {FILTERS.map((option) => (
            <button key={option} type="button" role="tab" aria-selected={filter === option} className={filter === option ? "is-on" : undefined} onClick={() => onFilter(option)}>
              {option === "all" ? "All" : MEDIA_KIND_LABEL[option]}
            </button>
          ))}
        </div>
        <input type="search" className="ui-search media-search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search prompts" aria-label="Search prompts" />
        <span className="ui-count">{visible.length.toLocaleString()}</span>
      </div>

      {notice}

      <div className="media-scroll">
        {loading && items.length === 0 ? (
          <p className="media-empty">Loading…</p>
        ) : items.length === 0 ? (
          <p className="media-empty">Nothing generated yet. Write a prompt and press Generate.</p>
        ) : visible.length === 0 ? (
          <p className="media-empty">
            No matches.{" "}
            <button type="button" className="media-link" onClick={() => { onFilter("all"); onQuery(""); }}>Show everything</button>
          </p>
        ) : (
          [...days.entries()].map(([day, entries]) => {
            const visual = entries.filter(isVisual);
            const tracks = entries.filter((item) => !isVisual(item));
            return (
              <section className="media-day" key={day} aria-label={dayLabel(day, now)}>
                <h3>{dayLabel(day, now)}</h3>
                {visual.length > 0 && (
                  <div className="media-rows">
                    {visual.map((item) => (
                      <figure key={item.id} className={`media-tile is-${item.status}`} style={{ "--r": ratioOf(item, measured) } as CSSProperties}>
                        {item.status === "completed" && item.kind === "image" && (
                          <Image
                            src={fileUrl(item)}
                            alt={item.prompt}
                            fill
                            unoptimized
                            sizes="(max-width: 767px) 50vw, 360px"
                            onLoad={(event) => {
                              const img = event.currentTarget;
                              if (img.naturalWidth && img.naturalHeight) measure(item.id, img.naturalWidth / img.naturalHeight);
                            }}
                          />
                        )}
                        {item.status === "completed" && item.kind === "video" && <VideoPreview item={item} onRatio={(ratio) => measure(item.id, ratio)} />}
                        {item.status === "generating" && (
                          <div className="media-wait" aria-live="polite">
                            <span>Generating</span>
                            <span className="tabular">{elapsed(item)}</span>
                          </div>
                        )}
                        {item.status === "failed" && (
                          <div className="media-fail">
                            <strong>Failed</strong>
                            <span>{item.error || "No reason given."}</span>
                          </div>
                        )}
                        <button type="button" className="media-tile-hit" aria-label={`Open ${MEDIA_KIND_LABEL[item.kind].toLowerCase()}: ${item.prompt}`} onClick={() => onOpen(item)} />
                        <figcaption className="media-tile-over">
                          <span>{item.prompt}</span>
                          {item.status === "completed" && (
                            <a className="media-icon" href={fileUrl(item, true)} aria-label="Download" title="Download">
                              <Icon path={ICON.download} size={13} />
                            </a>
                          )}
                          {item.status === "failed" && <button type="button" className="media-link" onClick={() => onRetry(item)}>Retry</button>}
                        </figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {tracks.length > 0 && (
                  <ul className="media-tracks">
                    {tracks.map((item) => {
                      const isPlaying = playing === item.id;
                      return (
                        <li key={item.id} className={`media-track is-${item.status}${isPlaying ? " is-playing" : ""}`}>
                          {item.status === "completed" ? (
                            <button type="button" className="media-play" aria-label={isPlaying ? "Pause" : "Play"} onClick={() => play(item)}>
                              <Icon path={isPlaying ? ICON.stop : ICON.play} size={11} />
                            </button>
                          ) : (
                            <span className="media-play" aria-hidden="true">
                              {item.status === "generating" ? <Spinner size={12} /> : <Icon path={ICON.alert} size={12} />}
                            </span>
                          )}
                          <button type="button" className="media-track-main" onClick={() => onOpen(item)}>
                            <span className="media-track-title">{item.prompt}</span>
                            <span className="media-track-meta">{MEDIA_KIND_LABEL[item.kind]} · {trackMeta(item)}</span>
                          </button>
                          <span className="media-track-time tabular" aria-live={item.status === "generating" ? "polite" : undefined}>
                            {item.status === "completed" ? clock(item.durationSec) : item.status === "generating" ? elapsed(item) : ""}
                          </span>
                          {item.status === "completed" && (
                            <a className="media-icon" href={fileUrl(item, true)} aria-label="Download" title="Download">
                              <Icon path={ICON.download} size={13} />
                            </a>
                          )}
                          {item.status === "failed" && <button type="button" className="media-link" onClick={() => onRetry(item)}>Retry</button>}
                          {isPlaying && <span className="media-track-bar" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </section>
  );
}
