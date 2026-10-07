import type { ComponentType } from "react";

import type { Mode } from "../mode";

export type StepId =
  | "welcome"
  | "rooms"
  | "where"
  | "prepare"
  | "host"
  | "pair"
  | "schoology"
  | "sync"
  | "profile"
  | "ai"
  | "notify"
  | "done";

export type RunsOn = "mac" | "host";

export type HostPlatform = "darwin" | "win32" | "linux";

export interface HostInfo {
  url: string;
  name: string;
  platform: HostPlatform;
}

export type HostCheck = { ok: true; host: HostInfo } | { ok: false; problem: "unreachable" | "not-slates" };

export type PairProblem = "needs-code" | "wrong" | "expired" | "too-many";

export type PairResult = { ok: true; via: "tailscale" | "code" } | { ok: false; problem: PairProblem };

export interface SchoologySession {
  domain: string;
  signedInAt: string;
}

export type SignInProblem = "idle" | "expired" | "replaced" | "no-service";

export type SignInResult = { ok: true; session: SchoologySession } | { ok: false; problem: SignInProblem };

export type BoardColumn = "tonight" | "soon" | "week" | "done";

export interface SyncProgress {
  course: string | null;
  courses: number;
  items: number;
  dated: number;
  found: BoardItem[];
}

export interface BoardItem {
  id: string;
  title: string;
  course: string;
  dot: string;
  due: string;
  column: BoardColumn;
}

export interface SyncSummary {
  courses: number;
  items: number;
  dated: number;
  dueThisWeek: number;
  studentName: string | null;
  board: BoardItem[];
}

export type SyncProblem = "signed-out" | "empty" | "service-down";

export type SyncResult = { ok: true; summary: SyncSummary } | { ok: false; problem: SyncProblem };

export type ProviderId = "openai" | "claude-code" | "cursor-agent" | "openrouter" | "elevenlabs";

export interface ProviderState {
  id: ProviderId;
  ready: boolean;
}

export type ProviderTest = { ok: true } | { ok: false; error: string };

export type NotifyChoice = "granted" | "denied" | "later";

export interface Answers {
  runsOn: RunsOn | null;
  host: HostInfo | null;
  paired: "tailscale" | "code" | null;
  schoology: SchoologySession | null;
  sync: SyncSummary | null;
  rooms: Mode[];
  name: string;
  avatar: string | null;
  providers: ProviderState[] | null;
  notifications: NotifyChoice | null;
}

export type FinishHow = "done" | "skipped";

export interface SignInSurfaceProps {
  domain: string;
  hostName: string | null;
  onCancel: () => void;
}

export interface OnboardingEnv {
  prefill?: { rooms?: Mode[]; hostUrl?: string; domain?: string; code?: string };
  SignInSurface?: ComponentType<SignInSurfaceProps>;
  checkHost(url: string, options: { signal: AbortSignal; onSlow: () => void }): Promise<HostCheck>;
  pair(host: HostInfo, code: string | null, signal: AbortSignal): Promise<PairResult>;
  connect(choice: { runsOn: "mac" } | { runsOn: "host"; host: HostInfo }): Promise<void>;
  schoologySession(signal: AbortSignal): Promise<SchoologySession | null>;
  signIn(domain: string, signal: AbortSignal): Promise<SignInResult>;
  sync(onProgress: (progress: SyncProgress) => void, signal: AbortSignal): Promise<SyncResult>;
  providers(signal: AbortSignal): Promise<ProviderState[]>;
  testProvider(id: ProviderId, signal: AbortSignal): Promise<ProviderTest>;
  saveKey(id: ProviderId, key: string): Promise<void>;
  saveProfile(profile: { name: string; avatar: string | null }): void;
  saveRooms(hidden: Mode[]): void;
  requestNotifications(): Promise<"granted" | "denied">;
  finish(answers: Answers, how: FinishHow, open: Mode | null): void;
}
