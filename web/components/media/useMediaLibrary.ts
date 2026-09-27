"use client";

import { useCallback, useEffect, useState } from "react";

import { DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_VOICE } from "@/lib/media/catalog";
import type { GenerateInput, MediaItem, MediaKind } from "@/lib/media/types";

/** Keep the browser's library and voice choices synchronized with the server. */

export type MediaEntry = MediaItem & { filePath?: string };

export interface VoiceOption {
  id: string;
  name: string;
  category: string;
  previewUrl: string | null;
}

async function responseBody(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status}).`);
  return body;
}

export function useMediaLibrary() {
  const [items, setItems] = useState<MediaEntry[]>([]);
  const [connected, setConnected] = useState(false);
  const [voices, setVoices] = useState<VoiceOption[]>([]);
  const [speechDefaultModel, setSpeechDefaultModel] = useState(DEFAULT_SPEECH_MODEL);
  const [speechDefaultVoice, setSpeechDefaultVoice] = useState(DEFAULT_SPEECH_VOICE);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [voicesLoading, setVoicesLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const body = await responseBody(await fetch("/api/media", { cache: "no-store" }));
      setItems(Array.isArray(body.items) ? body.items as MediaEntry[] : []);
      setConnected(body.connected === true);
      setListError(null);
    } catch (error) {
      setListError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshVoices = useCallback(async () => {
    setVoicesLoading(true);
    try {
      const body = await responseBody(await fetch("/api/media/voices", { cache: "no-store" }));
      setVoices(Array.isArray(body.voices) ? body.voices as VoiceOption[] : []);
      if (typeof body.defaultModel === "string") setSpeechDefaultModel(body.defaultModel);
      if (typeof body.defaultVoiceId === "string") setSpeechDefaultVoice(body.defaultVoiceId);
      setVoicesError(null);
    } catch (error) {
      setVoicesError(error instanceof Error ? error.message : String(error));
    } finally {
      setVoicesLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => {
      void refresh();
      void refreshVoices();
    }, 0);
    const focus = () => { void refresh(); };
    window.addEventListener("focus", focus);
    return () => {
      window.clearTimeout(initial);
      window.removeEventListener("focus", focus);
    };
  }, [refresh, refreshVoices]);

  const generating = items.some((item) => item.status === "generating");
  useEffect(() => {
    if (!generating) return;
    const timer = window.setInterval(() => { void refresh(); }, 2500);
    return () => window.clearInterval(timer);
  }, [generating, refresh]);

  const generate = useCallback(async (input: GenerateInput) => {
    const response = await fetch("/api/media", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    let body: Record<string, unknown>;
    try {
      body = await responseBody(response);
    } catch (error) {
      await refresh();
      throw error;
    }
    await refresh();
    return body.item as MediaEntry;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await responseBody(await fetch(`/api/media?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
    await refresh();
  }, [refresh]);

  const removeFailed = useCallback(async (id: string) => {
    await responseBody(await fetch(`/api/media?id=${encodeURIComponent(id)}`, { method: "DELETE" }));
    await refresh();
  }, [refresh]);

  return {
    items,
    connected,
    voices,
    speechDefaultModel,
    speechDefaultVoice,
    voicesError,
    voicesLoading,
    loading,
    listError,
    refresh,
    refreshVoices,
    generate,
    remove,
    removeFailed,
  };
}

export const MEDIA_KINDS: readonly MediaKind[] = ["image", "video", "speech", "sfx", "music"];
