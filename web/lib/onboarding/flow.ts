import type { Mode } from "../mode";
import type { Answers, ProviderId, RunsOn, StepId } from "./types";

export const EMPTY_ANSWERS: Answers = {
  runsOn: null,
  host: null,
  paired: null,
  schoology: null,
  sync: null,
  rooms: [],
  name: "",
  avatar: null,
  providers: null,
  notifications: null,
};

export const ALL_ROOMS: readonly Mode[] = ["school", "counselor", "ui", "usage", "media", "agent", "health"];

export const PROVIDER_ROOMS: Record<ProviderId, readonly Mode[]> = {
  openai: ["school", "counselor", "health"],
  "claude-code": ["school"],
  "cursor-agent": ["school", "agent"],
  openrouter: ["school", "counselor", "health"],
  elevenlabs: ["school", "media"],
};

export function providersFor(rooms: readonly Mode[]): ProviderId[] {
  return (Object.keys(PROVIDER_ROOMS) as ProviderId[]).filter((id) => PROVIDER_ROOMS[id].some((room) => rooms.includes(room)));
}

export interface Path {
  runsOn: RunsOn | null;
  rooms: readonly Mode[];
}

export const HOST_ONLY: readonly StepId[] = ["prepare", "host", "pair"];
export const SCHOOL_ONLY: readonly StepId[] = ["schoology", "sync"];

export function stepsFor({ runsOn, rooms }: Path): StepId[] {
  return [
    "welcome",
    ...connectSteps({ runsOn, rooms }),
    ...yoursSteps({ runsOn, rooms }),
    "done",
  ];
}

function connectSteps({ runsOn, rooms }: Path): StepId[] {
  return ["rooms", "where", ...(runsOn === "host" ? HOST_ONLY : []), ...(rooms.includes("school") ? SCHOOL_ONLY : [])];
}

function yoursSteps({ rooms }: Path): StepId[] {
  return ["profile", ...(providersFor(rooms).length ? (["ai"] as const) : []), ...(rooms.includes("agent") ? (["notify"] as const) : [])];
}

export function nextStep(step: StepId, path: Path): StepId | null {
  const steps = stepsFor(path);
  return steps[steps.indexOf(step) + 1] ?? null;
}

export function previousStep(step: StepId, path: Path): StepId | null {
  const steps = stepsFor(path);
  const at = steps.indexOf(step);
  return at > 0 ? steps[at - 1] : null;
}

export type Phase = "connect" | "yours";

export const PHASE_LABEL: Record<Phase, string> = { connect: "Set up", yours: "Make it yours" };

export function progressOf(step: StepId, path: Path): { phase: Phase; index: number; total: number } | null {
  const connect = connectSteps(path);
  if (connect.includes(step)) return { phase: "connect", index: connect.indexOf(step) + 1, total: connect.length };
  const yours = yoursSteps(path);
  if (yours.includes(step)) return { phase: "yours", index: yours.indexOf(step) + 1, total: yours.length };
  return null;
}

export type HostUrlProblem = "empty" | "invalid" | "not-tailscale";

export function hostLabel(url: string): string {
  try {
    return new URL(url).hostname.split(".")[0] || url;
  } catch {
    return url;
  }
}

export function normalizeHostUrl(input: string): { ok: true; url: string; name: string } | { ok: false; problem: HostUrlProblem } {
  const raw = input.trim();
  if (!raw) return { ok: false, problem: "empty" };
  let parsed: URL;
  try {
    parsed = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, problem: "invalid" };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { ok: false, problem: "invalid" };
  const hostname = parsed.hostname.toLowerCase();
  if (!hostname.endsWith(".ts.net")) return { ok: false, problem: "not-tailscale" };
  const url = `https://${parsed.host.toLowerCase()}`;
  return { ok: true, url, name: hostLabel(url) };
}

export function normalizeSchoologyDomain(input: string): { ok: true; domain: string } | { ok: false; problem: "empty" | "invalid" } {
  const bare = input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[/?#].*$/, "")
    .replace(/\.$/, "");
  if (!bare) return { ok: false, problem: "empty" };
  const domain = bare.includes(".") ? bare : `${bare}.schoology.com`;
  const wellFormed = /^[a-z\d]([a-z\d-]*[a-z\d])?(\.[a-z\d]([a-z\d-]*[a-z\d])?)+$/.test(domain);
  if (!wellFormed || !domain.endsWith(".schoology.com")) return { ok: false, problem: "invalid" };
  return { ok: true, domain };
}

export function pairingDigits(input: string): string {
  return input.replace(/\D/g, "").slice(0, 8);
}

export function formatPairingCode(input: string): string {
  const digits = pairingDigits(input);
  return digits.length > 4 ? `${digits.slice(0, 4)} ${digits.slice(4)}` : digits;
}

export function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase();
}
