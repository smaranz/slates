"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { ChatEvent, HubMessage, Roster } from "@/lib/agent/types";

/** The Agent app's live state: the roster, the open chat, and one event stream for both. */

export async function agentApi<T = Record<string, unknown>>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok || data.error) throw new Error(data.error ?? `Request failed (${response.status}).`);
  return data;
}

function upsert(events: ChatEvent[], event: ChatEvent): ChatEvent[] {
  const at = events.findIndex((e) => e.id === event.id);
  if (at < 0) return [...events, event];
  const next = events.slice();
  next[at] = event;
  return next;
}

export function useAgentLive(openChat: string | null) {
  const [roster, setRoster] = useState<Roster | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chat, setChat] = useState<{ id: string | null; events: ChatEvent[] }>({ id: null, events: [] });
  const [unread, setUnread] = useState<Set<string>>(new Set());
  const [connected, setConnected] = useState(false);
  const openRef = useRef(openChat);
  const listeners = useRef(new Set<(chatId: string, event: ChatEvent) => void>());

  const refresh = useCallback(async () => {
    try {
      const response = await fetch("/api/agent", { cache: "no-store" });
      const data = (await response.json()) as Roster & { error?: string };
      if (!response.ok || data.error) throw new Error(data.error ?? `Couldn't load agents (${response.status}).`);
      setRoster(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    openRef.current = openChat;
    if (!openChat) return;
    let active = true;
    fetch(`/api/agent/chat?id=${encodeURIComponent(openChat)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ events?: ChatEvent[] }>)
      .then((data) => {
        if (active) setChat({ id: openChat, events: data.events ?? [] });
      })
      .catch(() => {
        if (active) setChat({ id: openChat, events: [] });
      });
    return () => {
      active = false;
    };
  }, [openChat]);

  const markRead = useCallback((chatId: string) => {
    setUnread((current) => {
      if (!current.has(chatId)) return current;
      const next = new Set(current);
      next.delete(chatId);
      return next;
    });
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refresh(), 0);
    let source: EventSource | null = null;
    let retry: number | undefined;
    const connect = () => {
      source = new EventSource("/api/agent/stream");
      source.onopen = () => setConnected(true);
      source.onerror = () => {
        setConnected(false);
        source?.close();
        retry = window.setTimeout(connect, 3000);
      };
      source.onmessage = (message) => {
        let data: HubMessage | { kind: "hello" };
        try {
          data = JSON.parse(message.data);
        } catch {
          return;
        }
        if (data.kind === "hello" || data.kind === "roster") {
          void refresh();
        } else if (data.kind === "state") {
          setRoster((current) => current && {
            ...current,
            agents: current.agents.map((agent) => agent.id === data.agentId ? { ...agent, state: data.state, queued: data.queued } : agent),
          });
        } else if (data.kind === "event") {
          for (const listener of listeners.current) listener(data.chatId, data.event);
          if (data.chatId === openRef.current) {
            setChat((current) => (current.id === data.chatId ? { ...current, events: upsert(current.events, data.event) } : current));
          } else if (data.event.type !== "user") {
            setUnread((current) => (current.has(data.chatId) ? current : new Set(current).add(data.chatId)));
          }
        }
      };
    };
    connect();
    return () => {
      window.clearTimeout(initial);
      window.clearTimeout(retry);
      source?.close();
    };
  }, [refresh]);

  const onEvent = useCallback((listener: (chatId: string, event: ChatEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const events = openChat && chat.id === openChat ? chat.events : [];
  const loadingChat = !!openChat && chat.id !== openChat;
  return { roster, error, events, loadingChat, unread, connected, refresh, onEvent, markRead };
}

export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}
