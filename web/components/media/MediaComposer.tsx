"use client";

import Image from "next/image";
import { useRef } from "react";

import { estimatePrice } from "@/lib/ai-usage/rates";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  MUSIC_MODELS,
  SFX_MODEL,
  SPEECH_MODELS,
  VIDEO_MODELS,
} from "@/lib/media/catalog";
import { MEDIA_KIND_LABEL, type MediaItem, type MediaKind } from "@/lib/media/types";
import { Icon, ICON, Spinner, Toggle } from "../ui";
import type { VoiceOption } from "./useMediaLibrary";

/** Compose one media request; the server remains authoritative for model limits. */

export interface MediaDraft {
  kind: MediaKind;
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution: string;
  quality: string;
  durationSecs: number | null;
  generateAudio: boolean;
  negativePrompt: string;
  voiceId: string;
  loop: boolean;
  promptInfluence: number;
  lengthSecs: number | null;
  instrumental: boolean;
}

interface Props {
  draft: MediaDraft;
  startFrame: MediaItem | null;
  voices: VoiceOption[];
  voicesLoading: boolean;
  busy: boolean;
  error: string | null;
  onChange: (patch: Partial<MediaDraft>) => void;
  onKindChange: (kind: MediaKind) => void;
  onStartFrameRemove: () => void;
  onSubmit: () => void;
}

const KINDS: MediaKind[] = ["image", "video", "speech", "sfx", "music"];

const PLACEHOLDER: Record<MediaKind, string> = {
  image: "A glass greenhouse in the rain, lit from inside",
  video: "A paper boat drifting across a rain puddle, low angle",
  speech: "Text to speak",
  sfx: "A distant bell across a frozen lake",
  music: "Warm felt piano, slow and reflective",
};

function Choice<T extends string | number>({
  label,
  value,
  values,
  onChange,
  format = String,
}: {
  label: string;
  value: T;
  values: readonly T[];
  onChange: (next: T) => void;
  format?: (value: T) => string;
}) {
  if (values.length > 4) {
    return (
      <select className="input media-select" aria-label={label} value={String(value)} onChange={(event) => {
        const picked = values.find((choice) => String(choice) === event.target.value);
        if (picked !== undefined) onChange(picked);
      }}>
        {values.map((choice) => <option key={String(choice)} value={String(choice)}>{format(choice)}</option>)}
      </select>
    );
  }
  return (
    <div className="useg media-useg" role="radiogroup" aria-label={label}>
      {values.map((choice) => (
        <button
          key={String(choice)}
          type="button"
          role="radio"
          aria-checked={choice === value}
          className={choice === value ? "is-on" : undefined}
          onClick={() => onChange(choice)}
        >
          {format(choice)}
        </button>
      ))}
    </div>
  );
}

function Row({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="media-prop">
      {htmlFor ? <label htmlFor={htmlFor}>{label}</label> : <span>{label}</span>}
      <div className="media-prop-control">{children}</div>
    </div>
  );
}

function dollars(value: number): string {
  return value < 0.005 ? "under $0.01" : `$${value.toFixed(2)}`;
}

/** What this request should cost, from the same list prices AI Usage records. */
function estimate(draft: MediaDraft): string {
  if (draft.kind === "video") return "Charged to your ElevenLabs plan credits";
  if (draft.kind === "image") return `About ${dollars(estimatePrice({ model: draft.model, inputTokens: 1, unit: "images" }).listUsd)}`;
  if (draft.kind === "speech") {
    const chars = draft.prompt.length;
    return chars
      ? `About ${dollars(estimatePrice({ model: draft.model, inputTokens: chars, unit: "characters" }).listUsd)}`
      : `${draft.model.includes("flash") || draft.model.includes("turbo") ? "$0.05" : "$0.10"} per 1,000 characters`;
  }
  const seconds = draft.kind === "sfx" ? draft.durationSecs : draft.lengthSecs;
  const model = draft.kind === "sfx" ? SFX_MODEL : draft.model;
  if (seconds === null) return draft.kind === "sfx" ? "$0.12 a minute, priced by length" : "$0.15 a minute, priced by length";
  return `About ${dollars(estimatePrice({ model, inputTokens: seconds, unit: "seconds" }).listUsd)}`;
}

export default function MediaComposer({
  draft,
  startFrame,
  voices,
  voicesLoading,
  busy,
  error,
  onChange,
  onKindChange,
  onStartFrameRemove,
  onSubmit,
}: Props) {
  const previewAudio = useRef<HTMLAudioElement | null>(null);
  const selectedVoice = voices.find((voice) => voice.id === draft.voiceId) ?? voices[0];
  const imageSpec = draft.kind === "image"
    ? IMAGE_MODELS.find((model) => model.id === draft.model) ?? IMAGE_MODELS.find((model) => model.id === DEFAULT_IMAGE_MODEL)!
    : undefined;
  const videoSpec = draft.kind === "video"
    ? VIDEO_MODELS.find((model) => model.id === draft.model) ?? VIDEO_MODELS.find((model) => model.id === DEFAULT_VIDEO_MODEL)!
    : undefined;
  const promptLimit = draft.kind === "speech"
    ? (SPEECH_MODELS.find((model) => model.id === draft.model) ?? SPEECH_MODELS.find((model) => model.id === DEFAULT_SPEECH_MODEL)!).maxPromptLength
    : draft.kind === "music"
      ? (MUSIC_MODELS.find((model) => model.id === draft.model) ?? MUSIC_MODELS.find((model) => model.id === DEFAULT_MUSIC_MODEL)!).maxPromptLength
      : undefined;

  function changeModel(model: string) {
    const patch: Partial<MediaDraft> = { model };
    const nextImage = draft.kind === "image" ? IMAGE_MODELS.find((entry) => entry.id === model) : undefined;
    if (nextImage) {
      if (!nextImage.aspectRatio.values.includes(draft.aspectRatio)) {
        patch.aspectRatio = nextImage.aspectRatio.values.includes("1:1") ? "1:1" : nextImage.aspectRatio.default;
      }
      if (nextImage.resolution && !nextImage.resolution.values.includes(draft.resolution)) patch.resolution = nextImage.resolution.default;
      if (nextImage.quality && !nextImage.quality.values.includes(draft.quality)) patch.quality = nextImage.quality.default;
    }
    const nextVideo = draft.kind === "video" ? VIDEO_MODELS.find((entry) => entry.id === model) : undefined;
    if (nextVideo) {
      if (!nextVideo.aspectRatio.values.includes(draft.aspectRatio)) patch.aspectRatio = nextVideo.aspectRatio.default;
      if (!nextVideo.resolution.values.includes(draft.resolution)) patch.resolution = nextVideo.resolution.default;
      const duration = draft.durationSecs;
      const fits = duration !== null && ("values" in nextVideo.duration
        ? nextVideo.duration.values.includes(duration)
        : duration >= nextVideo.duration.min && duration <= nextVideo.duration.max);
      if (!fits) patch.durationSecs = "values" in nextVideo.duration ? nextVideo.duration.values[0]! : nextVideo.duration.min;
    }
    onChange(patch);
  }

  function previewVoice() {
    if (!selectedVoice?.previewUrl) return;
    previewAudio.current?.pause();
    previewAudio.current = new Audio(selectedVoice.previewUrl);
    void previewAudio.current.play().catch(() => {});
  }

  const models: readonly { id: string; label: string; needsApproval?: boolean }[] = draft.kind === "image" ? IMAGE_MODELS
    : draft.kind === "video" ? VIDEO_MODELS
      : draft.kind === "speech" ? SPEECH_MODELS
        : draft.kind === "music" ? MUSIC_MODELS : [];

  return (
    <form className="media-compose" onSubmit={(event) => { event.preventDefault(); onSubmit(); }}>
      <div className="media-compose-body">
        <div className="useg media-kinds" role="tablist" aria-label="What to make">
          {KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              role="tab"
              aria-selected={draft.kind === kind}
              className={draft.kind === kind ? "is-on" : undefined}
              onClick={() => onKindChange(kind)}
            >
              {MEDIA_KIND_LABEL[kind]}
            </button>
          ))}
        </div>

        {draft.kind === "video" && startFrame && (
          <div className="media-frame">
            {startFrame.status === "completed" && (
              <Image src={`/api/media/file?id=${encodeURIComponent(startFrame.id)}`} alt="" width={36} height={36} unoptimized />
            )}
            <span>Starts from <strong>{startFrame.prompt}</strong></span>
            <button type="button" className="media-icon" aria-label="Remove start frame" onClick={onStartFrameRemove}>
              <Icon path={ICON.close} size={12} />
            </button>
          </div>
        )}

        <div className="media-prompt-wrap">
          <textarea
            className="media-prompt"
            aria-label={draft.kind === "speech" ? "Text to speak" : "Prompt"}
            value={draft.prompt}
            maxLength={promptLimit}
            placeholder={PLACEHOLDER[draft.kind]}
            rows={6}
            onChange={(event) => onChange({ prompt: event.target.value })}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
          />
          {promptLimit !== undefined && draft.kind === "speech" && (
            <span className="media-count">{draft.prompt.length.toLocaleString()} / {promptLimit.toLocaleString()}</span>
          )}
        </div>

        <div className="media-props">
          {models.length > 1 && (
            <Row label="Model" htmlFor="media-model">
              <select id="media-model" className="input media-select" value={draft.model} onChange={(event) => changeModel(event.target.value)}>
                {models.map((model) => (
                  <option key={model.id} value={model.id}>{model.label}{model.needsApproval ? " (needs approval)" : ""}</option>
                ))}
              </select>
            </Row>
          )}

          {draft.kind === "speech" && (
            <Row label="Voice" htmlFor="media-voice">
              <select
                id="media-voice"
                className="input media-select"
                value={selectedVoice?.id ?? draft.voiceId}
                disabled={voicesLoading || voices.length === 0}
                onChange={(event) => onChange({ voiceId: event.target.value })}
              >
                {voices.map((voice) => <option key={voice.id} value={voice.id}>{voice.name}</option>)}
                {!voices.length && <option value={draft.voiceId}>{voicesLoading ? "Loading voices" : "Default voice"}</option>}
              </select>
              <button type="button" className="media-icon" aria-label="Hear a sample of this voice" disabled={!selectedVoice?.previewUrl} onClick={previewVoice}>
                <Icon path={ICON.play} size={12} />
              </button>
            </Row>
          )}

          {imageSpec && (
            <>
              <Row label="Shape"><Choice label="Aspect ratio" value={draft.aspectRatio} values={imageSpec.aspectRatio.values} onChange={(aspectRatio) => onChange({ aspectRatio })} format={(v) => v === "auto" ? "Auto" : v} /></Row>
              {imageSpec.resolution && imageSpec.resolution.values.length > 1 && (
                <Row label="Size"><Choice label="Resolution" value={draft.resolution} values={imageSpec.resolution.values} onChange={(resolution) => onChange({ resolution })} /></Row>
              )}
              {imageSpec.quality && (
                <Row label="Quality"><Choice label="Quality" value={draft.quality} values={imageSpec.quality.values} onChange={(quality) => onChange({ quality })} format={(v) => v === "xhigh" ? "Extra high" : v[0]!.toUpperCase() + v.slice(1)} /></Row>
              )}
            </>
          )}

          {videoSpec && (
            <>
              <Row label="Length">
                {"values" in videoSpec.duration ? (
                  <Choice label="Duration" value={draft.durationSecs ?? videoSpec.duration.default} values={videoSpec.duration.values} onChange={(durationSecs) => onChange({ durationSecs })} format={(v) => `${v} s`} />
                ) : (
                  <span className="media-range">
                    <input type="range" min={videoSpec.duration.min} max={videoSpec.duration.max} step={1} value={draft.durationSecs ?? videoSpec.duration.default} aria-label="Duration in seconds" onChange={(event) => onChange({ durationSecs: Number(event.target.value) })} />
                    <output>{draft.durationSecs ?? videoSpec.duration.default} s</output>
                  </span>
                )}
              </Row>
              <Row label="Shape"><Choice label="Aspect ratio" value={draft.aspectRatio} values={videoSpec.aspectRatio.values} onChange={(aspectRatio) => onChange({ aspectRatio })} format={(v) => v === "auto" ? "Auto" : v} /></Row>
              <Row label="Size"><Choice label="Resolution" value={draft.resolution} values={videoSpec.resolution.values} onChange={(resolution) => onChange({ resolution })} /></Row>
              {videoSpec.generateAudio && (
                <Row label="Audio"><Toggle label="Generate audio with the video" on={draft.generateAudio} onClick={() => onChange({ generateAudio: !draft.generateAudio })} /></Row>
              )}
              {videoSpec.negativePrompt && (
                <Row label="Avoid" htmlFor="media-avoid">
                  <input id="media-avoid" className="input media-avoid" value={draft.negativePrompt} placeholder="Optional" onChange={(event) => onChange({ negativePrompt: event.target.value })} />
                </Row>
              )}
            </>
          )}

          {draft.kind === "sfx" && (
            <>
              <Row label="Length">
                <Toggle label="Pick the length myself" on={draft.durationSecs !== null} onClick={() => onChange({ durationSecs: draft.durationSecs === null ? 3 : null })} />
                {draft.durationSecs === null ? <span className="media-hint">Auto</span> : (
                  <span className="media-range">
                    <input type="range" min={0.5} max={30} step={0.5} value={draft.durationSecs} aria-label="Length in seconds" onChange={(event) => onChange({ durationSecs: Number(event.target.value) })} />
                    <output>{draft.durationSecs.toFixed(1)} s</output>
                  </span>
                )}
              </Row>
              <Row label="Loop"><Toggle label="Loop seamlessly" on={draft.loop} onClick={() => onChange({ loop: !draft.loop })} /></Row>
              <Row label="Follow prompt">
                <span className="media-range">
                  <input type="range" min={0} max={1} step={0.05} value={draft.promptInfluence} aria-label="How closely to follow the prompt" onChange={(event) => onChange({ promptInfluence: Number(event.target.value) })} />
                  <output>{Math.round(draft.promptInfluence * 100)}%</output>
                </span>
              </Row>
            </>
          )}

          {draft.kind === "music" && (
            <>
              <Row label="Length">
                <Toggle label="Pick the length myself" on={draft.lengthSecs !== null} onClick={() => onChange({ lengthSecs: draft.lengthSecs === null ? 30 : null })} />
                {draft.lengthSecs === null ? <span className="media-hint">Auto</span> : (
                  <span className="media-range">
                    <input type="range" min={3} max={300} step={1} value={draft.lengthSecs} aria-label="Length in seconds" onChange={(event) => onChange({ lengthSecs: Number(event.target.value) })} />
                    <output>{draft.lengthSecs} s</output>
                  </span>
                )}
              </Row>
              <Row label="Vocals"><Toggle label="Instrumental only" on={draft.instrumental} onClick={() => onChange({ instrumental: !draft.instrumental })} /><span className="media-hint">{draft.instrumental ? "None" : "If the prompt asks"}</span></Row>
            </>
          )}
        </div>
      </div>

      <div className="media-compose-foot">
        {error && <p className="media-error" role="alert">{error}</p>}
        <button type="submit" className="btn btn--primary media-go" disabled={busy || !draft.prompt.trim()}>
          {busy ? <><Spinner size={13} /> Starting</> : <>Generate<kbd>⌘↵</kbd></>}
        </button>
        <p className="media-estimate">{estimate(draft)}</p>
      </div>
    </form>
  );
}
