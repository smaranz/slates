import { DEMO_ASSIGNMENTS, DEMO_COURSES } from "../demo";
import type { Mode } from "../mode";
import { EMPTY_ANSWERS, firstName, hostLabel, isAbort, stepsFor, type Path } from "./flow";
import type {
  Answers,
  BoardColumn,
  BoardItem,
  HostInfo,
  HostPlatform,
  OnboardingEnv,
  ProviderId,
  ProviderTest,
  SchoologySession,
  StepId,
  SyncSummary,
} from "./types";

export const PROVIDER_IDS: ProviderId[] = ["openai", "claude-code", "cursor-agent", "openrouter", "elevenlabs"];

export interface Scenario {
  tailscaleOnMac: boolean;
  host: "answers" | "slow" | "silent" | "other";
  hostPlatform: HostPlatform;
  hostSignedIn: boolean;
  pairing: "accepted" | "wrong" | "expired";
  signIn: "succeeds" | "idle" | "expired" | "replaced" | "no-service";
  sync: "finds-classes" | "signed-out" | "empty" | "service-down";
  providers: Record<ProviderId, boolean>;
  keysPass: boolean;
  notifications: "allow" | "deny";
  speed: number;
  prefill: boolean;
}

export const SPEEDS = [0.5, 1, 2, 5] as const;

export const DEFAULT_SCENARIO: Scenario = {
  tailscaleOnMac: false,
  host: "answers",
  hostPlatform: "win32",
  hostSignedIn: true,
  pairing: "accepted",
  signIn: "succeeds",
  sync: "finds-classes",
  providers: { openai: false, "claude-code": true, "cursor-agent": true, openrouter: false, elevenlabs: false },
  keysPass: true,
  notifications: "allow",
  speed: 1,
  prefill: true,
};

export type EffectKind = "bridge" | "api" | "storage" | "spawn" | "system";

export interface SimEffect {
  id: number;
  at: number;
  kind: EffectKind;
  text: string;
  missing?: boolean;
}

export type EmitEffect = (effect: Omit<SimEffect, "id" | "at">) => void;

export const SAMPLE = {
  rooms: ["school", "counselor", "agent", "health"] as Mode[],
  hostUrl: "https://gaming-pc.tail4a7e2.ts.net",
  domain: "northgate.schoology.com",
  code: "4718 2093",
  studentName: "Anika Raghavan",
};

const TEST_ERRORS: Record<ProviderId, string> = {
  openai: "OpenAI rejected the key.",
  "claude-code": "Claude Code answered, but its sign-in has expired.",
  "cursor-agent": "Cursor answered, but its sign-in has expired.",
  openrouter: "OpenRouter rejected the key.",
  elevenlabs: "ElevenLabs rejected the key.",
};

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  "claude-code": "Claude Code",
  "cursor-agent": "Cursor",
  openrouter: "OpenRouter",
  elevenlabs: "ElevenLabs",
};

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

export function sampleHost(platform: HostPlatform): HostInfo {
  return { url: SAMPLE.hostUrl, name: hostLabel(SAMPLE.hostUrl), platform };
}

export function sampleSummary(): SyncSummary {
  const board: BoardItem[] = DEMO_ASSIGNMENTS.map((a) => {
    const course = DEMO_COURSES.find((c) => c.id === a.courseId);
    return {
      id: a.id,
      title: a.title,
      course: course?.short ?? "",
      dot: course?.dot ?? "var(--muted)",
      due: a.due,
      column: (a.bucket === "overdue" ? "tonight" : a.bucket) as BoardColumn,
    };
  });
  return {
    courses: DEMO_COURSES.length,
    items: DEMO_ASSIGNMENTS.length,
    dated: DEMO_ASSIGNMENTS.filter((a) => a.bucket !== "done").length,
    dueThisWeek: DEMO_ASSIGNMENTS.filter((a) => a.bucket !== "done" && a.dateOffset !== null && a.dateOffset >= 0 && a.dateOffset <= 6).length,
    studentName: SAMPLE.studentName,
    board,
  };
}

export function answersBefore(step: StepId, path: Path, scenario: Scenario): Answers {
  const steps = stepsFor(path);
  const at = steps.indexOf(step);
  const past = (s: StepId) => steps.includes(s) && steps.indexOf(s) < at;
  return {
    ...EMPTY_ANSWERS,
    rooms: past("rooms") ? [...path.rooms] : [],
    runsOn: past("where") ? path.runsOn : null,
    host: past("host") ? sampleHost(scenario.hostPlatform) : null,
    paired: past("pair") ? (scenario.tailscaleOnMac ? "tailscale" : "code") : null,
    schoology: past("schoology") ? { domain: SAMPLE.domain, signedInAt: daysAgo(0) } : null,
    sync: past("sync") ? sampleSummary() : null,
    name: past("profile") || past("sync") ? firstName(SAMPLE.studentName) : "",
    providers: past("ai") ? PROVIDER_IDS.map((id) => ({ id, ready: scenario.providers[id] })) : null,
    notifications: past("notify") ? (scenario.notifications === "allow" ? "granted" : "denied") : null,
  };
}

function listOf(modes: Mode[]): string {
  return `[${modes.map((m) => `"${m}"`).join(", ")}]`;
}

export function createSimEnv(scenario: () => Scenario, emit: EmitEffect, seed: Answers = EMPTY_ANSWERS): OnboardingEnv {
  const state = {
    host: seed.runsOn === "host" && seed.paired ? seed.host : null,
    session: seed.schoology as SchoologySession | null,
    wrongCodes: 0,
    savedKeys: new Set<ProviderId>(),
  };
  const wait = (ms: number, signal?: AbortSignal) => sleep(ms / Math.max(scenario().speed, 0.01), signal);
  const at = (path: string) => `${state.host?.url ?? ""}${path}`;

  return {
    get prefill() {
      return scenario().prefill ? { rooms: SAMPLE.rooms, hostUrl: SAMPLE.hostUrl, domain: SAMPLE.domain, code: SAMPLE.code } : undefined;
    },

    async checkHost(url, { signal, onSlow }) {
      const name = hostLabel(url);
      const answer = scenario().host;
      if (answer === "answers" || answer === "other") {
        await wait(900, signal);
      } else {
        await wait(8000, signal);
        onSlow();
        emit({ kind: "system", text: `No answer from ${name} after 8 s, so setup says it's still trying, as the splash does (waitForRemote)` });
        if (answer === "silent") {
          await wait(7000, signal);
          emit({ kind: "api", text: `GET ${url}/api/host → no answer. The real app waits 45 s before it gives up` });
          return { ok: false, problem: "unreachable" };
        }
        await wait(1800, signal);
      }
      if (answer === "other") {
        emit({ kind: "api", text: `GET ${url}/api/host → 404 from something that isn't Slates` });
        return { ok: false, problem: "not-slates" };
      }
      const platform = scenario().hostPlatform;
      emit({ kind: "api", text: `GET ${url}/api/host → 200 { platform: "${platform}" }` });
      return { ok: true, host: { url, name, platform } };
    },

    async pair(host, code, signal) {
      const s = scenario();
      if (code === null) {
        await wait(700, signal);
        if (s.tailscaleOnMac) {
          emit({ kind: "api", text: `First load of ${host.url} over Tailscale pairs this Mac: proxy.ts enrolls it and sets the device key cookie` });
          return { ok: true, via: "tailscale" };
        }
        emit({ kind: "api", text: `GET ${host.url}/ → 401 "This device isn't paired with Slates yet" (no device key, and Tailscale is off)` });
        return { ok: false, problem: "needs-code" };
      }
      await wait(900, signal);
      const post = `POST ${host.url}/api/devices/pair { code: "•••• ••••" }`;
      if (state.wrongCodes >= 5 || s.pairing === "expired") {
        emit({ kind: "api", text: `${post} → 303 /?pairing=expired` });
        return { ok: false, problem: state.wrongCodes >= 5 ? "too-many" : "expired" };
      }
      if (s.pairing === "accepted") {
        emit({ kind: "api", text: `${post} → 303 / with the device key cookie, kept by this window's session` });
        return { ok: true, via: "code" };
      }
      state.wrongCodes += 1;
      if (state.wrongCodes >= 5) {
        emit({ kind: "api", text: `${post} → wrong for the 5th time, so the code is spent` });
        return { ok: false, problem: "too-many" };
      }
      emit({ kind: "api", text: `${post} → 303 /?pairing=wrong (try ${state.wrongCodes} of 5)` });
      return { ok: false, problem: "wrong" };
    },

    async connect(choice) {
      await wait(400);
      if (choice.runsOn === "mac") {
        state.host = null;
        emit({ kind: "bridge", text: "Runs on this Mac: SLATES_HOST stays unset, and the sync service main.mjs started at launch keeps running" });
        return;
      }
      state.host = choice.host;
      emit({ kind: "bridge", missing: true, text: `Write SLATES_HOST=${choice.host.url} to ~/.slates/.env` });
      emit({ kind: "bridge", text: `Copy this window's slates.* storage to ${choice.host.name} (migrateStorageToRemote)` });
      emit({
        kind: "bridge",
        missing: true,
        text: `Stop the portal and sync service on this Mac, load ${choice.host.url} in the window, and carry on with setup there`,
      });
    },

    async schoologySession(signal) {
      await wait(600, signal);
      if (state.host && scenario().hostSignedIn && !state.session) {
        state.session = { domain: SAMPLE.domain, signedInAt: daysAgo(8) };
      }
      emit({
        kind: "api",
        text: state.session
          ? `GET ${at("/api/scrape")} → running, signed in to ${state.session.domain}`
          : `GET ${at("/api/scrape")} → running, with no Schoology session in the Slates Chrome profile yet`,
      });
      return state.session;
    },

    async signIn(domain, signal) {
      const outcome = scenario().signIn;
      const where = state.host?.name ?? "this Mac";
      const start = `POST ${at("/api/scrape/signin/start")} { domain: "${domain}" }`;
      try {
        await wait(outcome === "no-service" ? 900 : 600, signal);
        if (outcome === "no-service") {
          emit({ kind: "api", text: `${start} → 503: the sync service isn't running on ${where}, so there's no browser to sign in with` });
          return { ok: false, problem: "no-service" };
        }
        emit({ kind: "api", text: `${start} → the sync browser on ${where} opens Schoology` });
        emit({ kind: "api", text: `GET ${at("/api/scrape/signin/stream")} → its page streams into the window; clicks and keys go back through /signin/input` });
        if (outcome === "idle" || outcome === "expired" || outcome === "replaced") {
          await wait(outcome === "replaced" ? 3500 : 8000, signal);
          emit({ kind: "api", text: `GET ${at("/api/scrape/signin/status")} → { active: false, reason: "${outcome}" }` });
          return { ok: false, problem: outcome };
        }
        await wait(6500, signal);
        const session = { domain, signedInAt: new Date().toISOString() };
        state.session = session;
        emit({ kind: "api", text: `GET ${at("/api/scrape/signin/status")} → { signedIn: true }. config.json gets loggedInAt, and a sync starts` });
        return { ok: true, session };
      } catch (error) {
        if (isAbort(error)) emit({ kind: "api", text: `Cancelled: POST ${at("/api/scrape/signin/stop")} closes the sync browser's sign-in page` });
        throw error;
      }
    },

    async sync(onProgress, signal) {
      const outcome = scenario().sync;
      const board = sampleSummary().board;
      onProgress({ course: null, courses: 0, items: 0, dated: 0, found: [] });
      await wait(1400, signal);
      emit({ kind: "api", text: `POST ${at("/api/scrape?fresh=1")} → the sync service reads the Schoology home page, then each class` });
      emit({ kind: "system", missing: true, text: "Progress class by class. Today /api/scrape answers once, when the whole sync is done" });
      if (outcome === "service-down") {
        await wait(1600, signal);
        emit({ kind: "api", text: "← no answer from the sync service on :7529" });
        return { ok: false, problem: "service-down" };
      }
      if (outcome === "empty") {
        emit({ kind: "api", text: "← the home page lists no classes" });
        return { ok: false, problem: "empty" };
      }
      const progress = { courses: 0, items: 0, dated: 0, found: [] as BoardItem[] };
      for (const [index, course] of DEMO_COURSES.entries()) {
        onProgress({ course: course.name, ...progress });
        await wait(850, signal);
        if (outcome === "signed-out" && index === 2) {
          emit({ kind: "api", text: `← Schoology answered ${course.name} with its sign-in page: the session expired` });
          return { ok: false, problem: "signed-out" };
        }
        const work = DEMO_ASSIGNMENTS.filter((a) => a.courseId === course.id);
        progress.courses += 1;
        progress.items += work.length;
        progress.dated += work.filter((a) => a.bucket !== "done").length;
        progress.found = [...progress.found, ...board.filter((item) => work.some((a) => a.id === item.id))];
        onProgress({ course: course.name, ...progress });
      }
      const summary = sampleSummary();
      emit({ kind: "api", text: `← ${summary.courses} classes, ${summary.items} assignments, ${summary.dueThisWeek} due this week` });
      emit({ kind: "storage", text: "slates.state.v1 ← the synced board" });
      return { ok: true, summary };
    },

    async providers(signal) {
      await wait(700, signal);
      const ready = scenario().providers;
      const list = PROVIDER_IDS.map((id) => ({ id, ready: ready[id] || state.savedKeys.has(id) }));
      emit({ kind: "api", text: `GET ${at("/api/providers")} → ${list.filter((p) => p.ready).length} of ${list.length} set up` });
      return list;
    },

    async testProvider(id, signal): Promise<ProviderTest> {
      await wait(1000, signal);
      const ok = scenario().keysPass;
      emit({ kind: "api", text: `POST ${at("/api/providers")} { backend: "${id}" } → ${ok ? "ok" : TEST_ERRORS[id]}` });
      return ok ? { ok: true } : { ok: false, error: TEST_ERRORS[id] };
    },

    async saveKey(id) {
      await wait(600);
      state.savedKeys.add(id);
      emit({
        kind: "api",
        text: `POST ${at("/api/usage")} { action: "link", provider: "${id}", kind: "api", label: "${PROVIDER_LABEL[id]}", secret: "••••" }`,
      });
    },

    saveProfile({ name, avatar }) {
      emit({ kind: "storage", text: `slates.profile.v1 ← { name: "${name}", avatar: ${avatar ? "a photo" : "none"} }` });
    },

    saveRooms(hidden) {
      emit({
        kind: "storage",
        text: hidden.length ? `slates.apps.hidden.v1 ← ${listOf(hidden)}` : "slates.apps.hidden.v1 removed: every room shows",
      });
    },

    async requestNotifications() {
      emit({ kind: "bridge", missing: true, text: "Post a first notification now, so macOS asks during setup rather than mid-week" });
      await wait(900);
      const answer = scenario().notifications === "allow" ? "granted" : "denied";
      emit({ kind: "system", text: `macOS: "Slates" would like to send you notifications → ${answer === "granted" ? "Allow" : "Don't Allow"}` });
      if (answer === "granted") emit({ kind: "storage", text: 'slates.desktop.receiveFiles ← "1"' });
      return answer;
    },

    finish(answers, how, open) {
      emit({
        kind: "storage",
        missing: true,
        text:
          how === "done"
            ? `slates.onboarding.v1 ← { finishedAt, runsOn: "${answers.runsOn ?? "mac"}", rooms: ${listOf(answers.rooms)} }`
            : "slates.onboarding.v1 ← { skippedAt }",
      });
      emit(
        open
          ? { kind: "storage", text: `slates.mode.v1 ← "${open}", so the window opens on that room` }
          : { kind: "storage", text: "slates.mode.v1 stays unset, so the window opens on the launcher" }
      );
      emit({ kind: "bridge", missing: true, text: 'Tell main.mjs setup is done, so the next launch says "Opening Slates" instead of "Opening setup"' });
    },
  };
}
