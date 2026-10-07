"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { vitalsFetch } from "@/lib/desktop-bridge";
import type { VitalsAction, VitalsActionResult, VitalsApp, VitalsSnapshot } from "@/lib/vitals/types";

/**
 * The room's feed: a reading every couple of seconds while the room is on
 * screen, nothing while it isn't. The readings so far live in the page alone,
 * for the charts; Vitals keeps no history, so they start again with the room.
 */

export const EVERY_MS = 2_500;
/** About five minutes of the Mac's own lines. */
const KEEP = 120;
/** And two of each app's. */
const KEEP_APP = 48;

export const METRICS = ["cpu", "mem", "power", "read", "write", "down", "up", "gpu"] as const;
export type Metric = (typeof METRICS)[number];

export interface Point {
  at: number;
  cpu: number;
  apps: number;
  mem: number;
  gpu: number;
  down: number;
  up: number;
  read: number;
  write: number;
  /** What the battery is giving, or failing that what the apps are drawing. */
  power: number;
  /** The hottest CPU and GPU sensors, °C, and the fans' mean rpm; 0 when unknown. */
  cpuTemp: number;
  gpuTemp: number;
  fan: number;
}

export interface Trail {
  points: Point[];
  apps: Map<string, Record<Metric, number[]>>;
}

const EMPTY: Trail = { points: [], apps: new Map() };

const appPower = (apps: VitalsApp[]) => apps.reduce((sum, a) => sum + (a.power ?? 0), 0);

function extend(trail: Trail, snap: VitalsSnapshot): Trail {
  const fans = snap.thermal?.fans ?? [];
  const point: Point = {
    at: snap.at,
    cpu: snap.cpu.total,
    apps: snap.cpu.apps,
    mem: snap.memory.used,
    gpu: snap.gpu?.busy ?? 0,
    down: snap.network.down,
    up: snap.network.up,
    read: snap.disk.read,
    write: snap.disk.write,
    power: snap.battery?.draw ?? appPower(snap.apps),
    cpuTemp: snap.thermal?.cpu?.max ?? 0,
    gpuTemp: snap.thermal?.gpu?.max ?? 0,
    fan: fans.length ? fans.reduce((sum, f) => sum + f.rpm, 0) / fans.length : 0,
  };
  const apps = new Map<string, Record<Metric, number[]>>();
  for (const app of snap.apps) {
    const before = trail.apps.get(app.key);
    const next = {} as Record<Metric, number[]>;
    for (const metric of METRICS) next[metric] = [...(before?.[metric] ?? []), app[metric] ?? 0].slice(-KEEP_APP);
    apps.set(app.key, next);
  }
  return { points: [...trail.points, point].slice(-KEEP), apps };
}

interface Feed {
  snap: VitalsSnapshot | null;
  trail: Trail;
  error: string | null;
  /** The portal answering isn't on a Mac. */
  unsupported: boolean;
}

export function useVitals() {
  const [feed, setFeed] = useState<Feed>({ snap: null, trail: EMPTY, error: null, unsupported: false });
  const [live, setLive] = useState(true);
  const wake = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!live) return;
    let stopped = false;
    let busy = false;
    let timer = 0;

    const tick = async () => {
      // Hidden, it waits for the room to be looked at again.
      if (stopped || busy || document.visibilityState !== "visible") return;
      busy = true;
      const started = Date.now();
      try {
        const res = await vitalsFetch("/api/vitals", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as VitalsSnapshot & { error?: string };
        if (stopped) return;
        if (res.ok) setFeed((f) => ({ snap: body, trail: extend(f.trail, body), error: null, unsupported: false }));
        else setFeed((f) => ({ ...f, error: body.error ?? `Couldn’t read this Mac (${res.status}).`, unsupported: res.status === 404 }));
      } catch (err) {
        if (!stopped) setFeed((f) => ({ ...f, error: err instanceof Error ? err.message : String(err) }));
      } finally {
        busy = false;
      }
      if (!stopped) timer = window.setTimeout(tick, Math.max(400, EVERY_MS - (Date.now() - started)));
    };

    const now = () => {
      window.clearTimeout(timer);
      void tick();
    };
    const onShow = () => {
      if (document.visibilityState === "visible") now();
    };
    wake.current = now;
    timer = window.setTimeout(tick, 0);
    document.addEventListener("visibilitychange", onShow);
    return () => {
      stopped = true;
      wake.current = null;
      window.clearTimeout(timer);
      document.removeEventListener("visibilitychange", onShow);
    };
  }, [live]);

  const act = useCallback(async (action: VitalsAction): Promise<VitalsActionResult> => {
    try {
      const res = await vitalsFetch("/api/vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
      const body = (await res.json().catch(() => ({}))) as Partial<VitalsActionResult> & { error?: string };
      return typeof body.ok === "boolean" ? (body as VitalsActionResult) : { ok: false, message: body.error ?? "That didn’t work." };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      wake.current?.();
    }
  }, []);

  return { ...feed, live, setLive, act };
}

/* ── app icons ─────────────────────────────────────────────────────────── */

const icons = new Map<string, string>();
const asked = new Set<string>();

/** Each app's own icon, fetched once a page, by its bundle. */
export function useAppIcons(bundles: (string | null)[]): (bundle: string | null) => string | null {
  const [, setLoaded] = useState(0);
  const wanted = [...new Set(bundles.filter((b): b is string => !!b && !asked.has(b)))].sort().join("\n");

  useEffect(() => {
    if (!wanted) return;
    const list = wanted.split("\n");
    list.forEach((b) => asked.add(b));
    vitalsFetch("/api/vitals", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "icons", apps: list }) })
      .then((res) => res.json() as Promise<{ icons?: Record<string, string> }>)
      .then((body) => {
        for (const [bundle, url] of Object.entries(body.icons ?? {})) icons.set(bundle, url);
        setLoaded((n) => n + 1);
      })
      // Asked again the next time they're on screen.
      .catch(() => list.forEach((b) => asked.delete(b)));
  }, [wanted]);

  return (bundle) => (bundle ? (icons.get(bundle) ?? null) : null);
}
