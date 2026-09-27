"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useHiddenApps, useHostApps } from "@/lib/app-prefs";
import {
  DEFAULT_IMAGE_MODEL,
  DEFAULT_MUSIC_MODEL,
  DEFAULT_SPEECH_MODEL,
  DEFAULT_SPEECH_VOICE,
  DEFAULT_VIDEO_MODEL,
  IMAGE_MODELS,
  VIDEO_MODELS,
} from "@/lib/media/catalog";
import { MCP_COMMAND } from "@/lib/media/mcp-command";
import type { GenerateInput, MediaItem, MediaKind } from "@/lib/media/types";
import { useMode } from "@/lib/mode";
import { Icon, ICON } from "../ui";
import MediaComposer, { type MediaDraft } from "./MediaComposer";
import MediaDetail from "./MediaDetail";
import MediaGallery, { type MediaFilter } from "./MediaGallery";
import { useMediaLibrary, type MediaEntry } from "./useMediaLibrary";

/** The media studio shell joins the prompt composer to the persistent library. */

const MEDIA_TOOLS = [
  "list_media", "get_media", "save_media", "list_media_models", "generate_image", "generate_video",
  "generate_speech", "generate_sound_effect", "generate_music",
];

function newDraft(kind: MediaKind): MediaDraft {
  if (kind === "image") {
    const model = IMAGE_MODELS.find((entry) => entry.id === DEFAULT_IMAGE_MODEL)!;
    return {
      kind, prompt: "", model: model.id,
      aspectRatio: model.aspectRatio.values.includes("1:1") ? "1:1" : model.aspectRatio.default,
      resolution: model.resolution?.default ?? "1K", quality: model.quality?.default ?? "medium",
      durationSecs: 4, generateAudio: false, negativePrompt: "", voiceId: DEFAULT_SPEECH_VOICE,
      loop: false, promptInfluence: 0.3, lengthSecs: null, instrumental: false,
    };
  }
  if (kind === "video") {
    const model = VIDEO_MODELS.find((entry) => entry.id === DEFAULT_VIDEO_MODEL)!;
    const duration = "values" in model.duration ? model.duration.values[0]! : model.duration.min;
    return {
      kind, prompt: "", model: model.id, aspectRatio: model.aspectRatio.default,
      resolution: model.resolution.default, quality: "medium", durationSecs: duration,
      generateAudio: false, negativePrompt: "", voiceId: DEFAULT_SPEECH_VOICE,
      loop: false, promptInfluence: 0.3, lengthSecs: null, instrumental: false,
    };
  }
  if (kind === "speech") return {
    kind, prompt: "", model: DEFAULT_SPEECH_MODEL, aspectRatio: "1:1", resolution: "1K", quality: "medium",
    durationSecs: null, generateAudio: false, negativePrompt: "", voiceId: DEFAULT_SPEECH_VOICE,
    loop: false, promptInfluence: 0.3, lengthSecs: null, instrumental: false,
  };
  if (kind === "sfx") return {
    kind, prompt: "", model: "eleven_text_to_sound_v2", aspectRatio: "1:1", resolution: "1K", quality: "medium",
    durationSecs: null, generateAudio: false, negativePrompt: "", voiceId: DEFAULT_SPEECH_VOICE,
    loop: false, promptInfluence: 0.3, lengthSecs: null, instrumental: false,
  };
  return {
    kind, prompt: "", model: DEFAULT_MUSIC_MODEL, aspectRatio: "1:1", resolution: "1K", quality: "medium",
    durationSecs: null, generateAudio: false, negativePrompt: "", voiceId: DEFAULT_SPEECH_VOICE,
    loop: false, promptInfluence: 0.3, lengthSecs: null, instrumental: false,
  };
}

function inputFromDraft(draft: MediaDraft, startFrame: MediaItem | null): GenerateInput {
  switch (draft.kind) {
    case "image": {
      const model = IMAGE_MODELS.find((entry) => entry.id === draft.model);
      return {
        kind: "image", prompt: draft.prompt, model: draft.model, aspectRatio: draft.aspectRatio,
        resolution: model?.resolution ? draft.resolution : undefined,
        quality: model?.quality ? draft.quality : undefined,
      };
    }
    case "video": {
      const model = VIDEO_MODELS.find((entry) => entry.id === draft.model);
      return {
        kind: "video", prompt: draft.prompt, model: draft.model, durationSecs: draft.durationSecs ?? undefined,
        aspectRatio: draft.aspectRatio, resolution: draft.resolution, generateAudio: draft.generateAudio,
        negativePrompt: model?.negativePrompt ? draft.negativePrompt || undefined : undefined,
        startFrameId: startFrame?.id,
      };
    }
    case "speech":
      return { kind: "speech", prompt: draft.prompt, voiceId: draft.voiceId || undefined, model: draft.model };
    case "sfx":
      return {
        kind: "sfx", prompt: draft.prompt, durationSecs: draft.durationSecs ?? undefined,
        loop: draft.loop, promptInfluence: draft.promptInfluence,
      };
    case "music":
      return { kind: "music", prompt: draft.prompt, lengthSecs: draft.lengthSecs ?? undefined, instrumental: draft.instrumental, model: draft.model };
  }
}

function inputFromItem(item: MediaItem): GenerateInput {
  const options = item.options;
  if (item.kind === "image") return {
    kind: "image", prompt: item.prompt, model: item.model,
    aspectRatio: typeof options.aspect_ratio === "string" ? options.aspect_ratio : undefined,
    resolution: typeof options.resolution === "string" ? options.resolution : undefined,
    quality: typeof options.quality === "string" ? options.quality : undefined,
  };
  if (item.kind === "video") return {
    kind: "video", prompt: item.prompt, model: item.model,
    durationSecs: typeof options.duration_secs === "number" ? options.duration_secs : undefined,
    aspectRatio: typeof options.aspect_ratio === "string" ? options.aspect_ratio : undefined,
    resolution: typeof options.resolution === "string" ? options.resolution : undefined,
    generateAudio: options.generate_audio === true,
    negativePrompt: typeof options.negative_prompt === "string" ? options.negative_prompt : undefined,
    startFrameId: item.parentId,
  };
  if (item.kind === "speech") return {
    kind: "speech", prompt: item.prompt, model: item.model,
    voiceId: typeof options.voice_id === "string" ? options.voice_id : undefined,
  };
  if (item.kind === "sfx") return {
    kind: "sfx", prompt: item.prompt,
    durationSecs: typeof options.duration_seconds === "number" ? options.duration_seconds : undefined,
    loop: options.loop === true,
    promptInfluence: typeof options.prompt_influence === "number" ? options.prompt_influence : undefined,
  };
  return {
    kind: "music", prompt: item.prompt, model: item.model,
    lengthSecs: typeof options.music_length_ms === "number" ? options.music_length_ms / 1000 : undefined,
    instrumental: options.force_instrumental === true,
  };
}

function draftFromItem(item: MediaEntry): MediaDraft {
  const draft = newDraft(item.kind);
  const options = item.options;
  return {
    ...draft,
    prompt: item.prompt,
    model: item.model,
    aspectRatio: typeof options.aspect_ratio === "string" ? options.aspect_ratio : draft.aspectRatio,
    resolution: typeof options.resolution === "string" ? options.resolution : draft.resolution,
    quality: typeof options.quality === "string" ? options.quality : draft.quality,
    durationSecs: item.kind === "video" && typeof options.duration_secs === "number"
      ? options.duration_secs
      : item.kind === "sfx" && typeof options.duration_seconds === "number"
        ? options.duration_seconds
        : null,
    lengthSecs: typeof options.music_length_ms === "number" ? options.music_length_ms / 1000 : null,
    generateAudio: options.generate_audio === true,
    negativePrompt: typeof options.negative_prompt === "string" ? options.negative_prompt : "",
    voiceId: typeof options.voice_id === "string" ? options.voice_id : DEFAULT_SPEECH_VOICE,
    loop: options.loop === true,
    promptInfluence: typeof options.prompt_influence === "number" ? options.prompt_influence : 0.3,
    instrumental: options.force_instrumental === true,
  };
}

export default function MediaApp() {
  const { clear, openSettings, choose } = useMode();
  const [hiddenApps] = useHiddenApps();
  const host = useHostApps();
  const library = useMediaLibrary();
  const [draft, setDraft] = useState<MediaDraft>(() => newDraft("image"));
  const [startFrame, setStartFrame] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [commandCopied, setCommandCopied] = useState(false);
  const [filter, setFilter] = useState<MediaFilter>("all");
  const [query, setQuery] = useState("");
  const [speechModelTouched, setSpeechModelTouched] = useState(false);
  const [speechVoiceTouched, setSpeechVoiceTouched] = useState(false);
  const agents = useRef<HTMLDivElement>(null);
  const selected = useMemo(() => library.items.find((item) => item.id === selectedId) ?? null, [library.items, selectedId]);
  const visible = useMemo(() => {
    const words = query.trim().toLowerCase();
    return library.items.filter((item) => (filter === "all" || item.kind === filter)
      && (!words || `${item.prompt} ${item.model} ${item.voiceName ?? ""}`.toLowerCase().includes(words)));
  }, [filter, library.items, query]);

  useEffect(() => {
    if (navigator.userAgent.includes("Electron")) document.documentElement.dataset.desktop = "1";
  }, []);

  useEffect(() => {
    if (!agentsOpen) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !agents.current?.contains(event.target as Node)) setAgentsOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", close);
    };
  }, [agentsOpen]);

  const composerDraft = useMemo(() => {
    if (draft.kind !== "speech") return draft;
    return {
      ...draft,
      model: !speechModelTouched && draft.model === DEFAULT_SPEECH_MODEL ? library.speechDefaultModel : draft.model,
      voiceId: !speechVoiceTouched && draft.voiceId === DEFAULT_SPEECH_VOICE ? library.speechDefaultVoice : draft.voiceId,
    };
  }, [draft, library.speechDefaultModel, library.speechDefaultVoice, speechModelTouched, speechVoiceTouched]);

  const closeDetail = useCallback(() => setSelectedId(null), []);
  const scrollToComposer = () => {
    const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    document.querySelector(".media-compose")?.scrollIntoView({ block: "start", behavior });
    document.querySelector<HTMLTextAreaElement>(".media-prompt")?.focus({ preventScroll: true });
  };
  const changeKind = (kind: MediaKind) => {
    setSpeechModelTouched(false);
    setSpeechVoiceTouched(false);
    setDraft((current) => ({ ...newDraft(kind), prompt: current.prompt }));
    setStartFrame(kind === "video" ? startFrame : null);
    setComposerError(null);
  };

  async function submit() {
    if (busy || !draft.prompt.trim()) return;
    setBusy(true);
    setComposerError(null);
    try {
      await library.generate(inputFromDraft(composerDraft, startFrame));
      setStartFrame(null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  function reuse(item: MediaEntry) {
    setDraft(draftFromItem(item));
    const parent = item.parentId ? library.items.find((entry) => entry.id === item.parentId) ?? null : null;
    setStartFrame(item.kind === "video" ? parent : null);
    setSpeechModelTouched(item.kind === "speech");
    setSpeechVoiceTouched(item.kind === "speech");
    setComposerError(null);
    scrollToComposer();
  }

  function animate(item: MediaEntry) {
    if (item.kind !== "image" || !item.remoteId) return;
    const next = newDraft("video");
    setDraft({ ...next, prompt: item.prompt });
    setStartFrame(item);
    setComposerError(null);
    scrollToComposer();
  }

  async function retry(item: MediaEntry) {
    setBusy(true);
    setComposerError(null);
    try {
      await library.generate(inputFromItem(item));
      await library.removeFailed(item.id);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function remove(item: MediaEntry) {
    const after = visible[visible.findIndex((entry) => entry.id === item.id) + 1];
    try {
      await library.remove(item.id);
      setSelectedId(after?.id ?? null);
    } catch (error) {
      setComposerError(error instanceof Error ? error.message : String(error));
    }
  }

  const usageReachable = !hiddenApps.includes("usage") && !host.unavailable.includes("usage");
  const notice = library.voicesError ? (
    <div className="media-notice" role="status">
      <Icon path={ICON.alert} size={13} />
      <p>
        {library.voicesError}
        {usageReachable && <button type="button" className="media-link" onClick={() => choose("usage")}>Open AI Usage</button>}
        <button type="button" className="media-link" onClick={() => void library.refreshVoices()}>Try again</button>
      </p>
    </div>
  ) : library.listError ? (
    <div className="media-notice" role="alert">
      <Icon path={ICON.alert} size={13} />
      <p>
        {library.listError}
        <button type="button" className="media-link" onClick={() => void library.refresh()}>Try again</button>
      </p>
    </div>
  ) : null;

  return (
    <div className="shell ui-mode media-mode">
      <div className="main">
        <header className="ui-top media-top">
          <button type="button" className="ui-back" onClick={clear} aria-label="Back to Slates">
            <Icon path={ICON.chevronLeft} size={13} /> Slates
          </button>
          <span className="ui-top-title">Media Gen Studio</span>
          <span className="ui-top-sub">Images, video, voice, sound and music from ElevenLabs</span>
          <span style={{ flex: 1 }} />
          <div className="media-agents" ref={agents}>
            <button type="button" className="ui-back" aria-label="Agents" aria-expanded={agentsOpen} aria-haspopup="dialog" onClick={() => setAgentsOpen((open) => !open)}>
              <Icon path={ICON.external} size={13} /> <span className="media-top-label">Agents</span>
            </button>
            {agentsOpen && (
              <div className="media-pop" role="dialog" aria-label="Use from coding agents">
                <p>Coding agents can browse, save and generate media through the slates-ui MCP server.</p>
                <div className="app-settings-code">
                  <code>{MCP_COMMAND}</code>
                  <button type="button" className="btn btn--quiet" onClick={() => {
                    void navigator.clipboard?.writeText(MCP_COMMAND).then(() => {
                      setCommandCopied(true);
                      window.setTimeout(() => setCommandCopied(false), 1500);
                    }).catch(() => {});
                  }}>{commandCopied ? "Copied" : "Copy"}</button>
                </div>
                <p className="media-pop-tools">{MEDIA_TOOLS.join(", ")}</p>
              </div>
            )}
          </div>
          <button type="button" className="ui-back" onClick={openSettings} aria-label="Settings">
            <Icon path={ICON.settings} size={13} /> <span className="media-top-label">Settings</span>
          </button>
        </header>

        <div className="media-shell">
          <MediaComposer
            draft={composerDraft}
            startFrame={startFrame}
            voices={library.voices}
            voicesLoading={library.voicesLoading}
            busy={busy}
            error={composerError}
            onChange={(patch) => {
              if (draft.kind === "speech" && "model" in patch) setSpeechModelTouched(true);
              if (draft.kind === "speech" && "voiceId" in patch) setSpeechVoiceTouched(true);
              setDraft((current) => ({ ...current, ...patch }));
            }}
            onKindChange={changeKind}
            onStartFrameRemove={() => setStartFrame(null)}
            onSubmit={() => void submit()}
          />
          <MediaGallery
            items={library.items}
            visible={visible}
            filter={filter}
            query={query}
            loading={library.loading}
            notice={notice}
            onFilter={setFilter}
            onQuery={setQuery}
            onOpen={(item) => setSelectedId(item.id)}
            onRetry={(item) => void retry(item)}
          />
        </div>
      </div>
      {selected && (
        <MediaDetail
          item={selected}
          items={visible.some((entry) => entry.id === selected.id) ? visible : library.items}
          onNavigate={(item) => setSelectedId(item.id)}
          onClose={closeDetail}
          onReuse={(item) => { closeDetail(); reuse(item); }}
          onAnimate={(item) => { closeDetail(); animate(item); }}
          onRetry={(item) => { closeDetail(); void retry(item); }}
          onDelete={(item) => void remove(item)}
        />
      )}
    </div>
  );
}
