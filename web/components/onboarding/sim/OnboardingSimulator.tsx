"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Toggle } from "@/components/ui";
import { APPS } from "@/lib/app-prefs";
import type { Mode } from "@/lib/mode";
import { ALL_ROOMS, EMPTY_ANSWERS, HOST_ONLY, providersFor, SCHOOL_ONLY, stepsFor, type Path } from "@/lib/onboarding/flow";
import {
  answersBefore,
  createSimEnv,
  DEFAULT_SCENARIO,
  PROVIDER_IDS,
  SPEEDS,
  type EmitEffect,
  type Scenario,
  type SimEffect,
} from "@/lib/onboarding/sim";
import type { Answers, FinishHow, ProviderId, RunsOn, StepId } from "@/lib/onboarding/types";

import Onboarding from "../Onboarding";
import SignInSurface from "./SignInSurface";
import s from "./simulator.module.css";

const WINDOWS = {
  laptop: { label: "Laptop", width: 1440, height: 940, zoom: 1 },
  wide: { label: "Wide display", width: 2200, height: 1300, zoom: 1.2 },
  smallest: { label: "Smallest", width: 900, height: 600, zoom: 1 },
} as const;

type WindowSize = keyof typeof WINDOWS;

const STEP_LABEL: Record<StepId, string> = {
  welcome: "Welcome",
  rooms: "Rooms",
  where: "Where",
  prepare: "Host setup",
  host: "Host",
  pair: "Pair",
  schoology: "Schoology",
  sync: "First sync",
  profile: "You",
  ai: "AI",
  notify: "Notifications",
  done: "Done",
};

const ROOM_TITLE = Object.fromEntries(APPS.map((app) => [app.mode, app.title])) as Record<Mode, string>;

function withRoom(rooms: readonly Mode[], room: Mode): Mode[] {
  return ALL_ROOMS.filter((m) => m === room || rooms.includes(m));
}

/** The path a jump to `step` needs: the host path for host steps, and a room that asks for the step. */
function pathFor(step: StepId, base: Path): Path {
  let { runsOn, rooms } = base;
  if (HOST_ONLY.includes(step)) runsOn = "host";
  if (SCHOOL_ONLY.includes(step) && !rooms.includes("school")) rooms = withRoom(rooms, "school");
  if (step === "notify" && !rooms.includes("agent")) rooms = withRoom(rooms, "agent");
  if (step === "ai" && !providersFor(rooms).length) rooms = withRoom(rooms, "school");
  return { runsOn, rooms };
}

function offPathNote(step: StepId): string {
  if (HOST_ONLY.includes(step)) return "Only on the host path. Jumping here switches to it.";
  if (SCHOOL_ONLY.includes(step)) return "Only with School. Jumping here adds it.";
  if (step === "notify") return "Only with Agent. Jumping here adds it.";
  return "Only with a room that uses AI. Jumping here adds School.";
}

const PROVIDER_LABEL: Record<ProviderId, string> = {
  "claude-code": "Claude Code signed in",
  "cursor-agent": "Cursor signed in",
  openai: "OpenAI key",
  openrouter: "OpenRouter key",
  elevenlabs: "ElevenLabs key",
};

interface Prefs {
  scenario: Scenario;
  windowSize: WindowSize;
  fit: boolean;
  reducedMotion: boolean;
  boot: boolean;
  path: RunsOn;
  rooms: Mode[];
}

const PREFS_KEY = "slates.onboardingSim.v2";

const DEFAULT_PREFS: Prefs = {
  scenario: DEFAULT_SCENARIO,
  windowSize: "laptop",
  fit: true,
  reducedMotion: false,
  boot: true,
  path: "host",
  rooms: [...ALL_ROOMS],
};

function loadPrefs(): Prefs {
  try {
    const saved = JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "null") as Partial<Prefs> | null;
    if (!saved) return DEFAULT_PREFS;
    const rooms = ALL_ROOMS.filter((m) => saved.rooms?.includes(m));
    return {
      ...DEFAULT_PREFS,
      ...saved,
      scenario: { ...DEFAULT_SCENARIO, ...saved.scenario, providers: { ...DEFAULT_SCENARIO.providers, ...saved.scenario?.providers } },
      windowSize: saved.windowSize && saved.windowSize in WINDOWS ? saved.windowSize : DEFAULT_PREFS.windowSize,
      rooms: rooms.length ? rooms : DEFAULT_PREFS.rooms,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

type Stage = "boot" | "onboarding" | "finished";

interface Run {
  id: number;
  stage: Stage;
  step: StepId;
  answers: Answers;
  startedAt: number;
}

function elapsed(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;
  return seconds < 60 ? `${seconds.toFixed(1)}s` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
}

function createChannel(initial: Scenario) {
  let scenario = initial;
  let id = 0;
  let sink: (effect: SimEffect) => void = () => {};
  const emit: EmitEffect = (effect) => sink({ ...effect, id: ++id, at: Date.now() });
  return {
    scenario: () => scenario,
    setScenario: (next: Scenario) => {
      scenario = next;
    },
    emit,
    listen: (next: (effect: SimEffect) => void) => {
      sink = next;
    },
  };
}

function readable(answers: Answers): string {
  return JSON.stringify(
    {
      ...answers,
      avatar: answers.avatar ? "a photo" : null,
      sync: answers.sync ? { ...answers.sync, board: `${answers.sync.board.length} cards` } : null,
    },
    null,
    2
  );
}

export default function OnboardingSimulator() {
  const [initial] = useState(() => {
    const prefs = loadPrefs();
    return { prefs, run: { id: 1, stage: prefs.boot ? "boot" : "onboarding", step: "welcome", answers: EMPTY_ANSWERS, startedAt: Date.now() } as Run };
  });
  const [prefs, setPrefs] = useState<Prefs>(initial.prefs);
  const [run, setRun] = useState<Run>(initial.run);
  const [current, setCurrent] = useState<{ step: StepId; answers: Answers }>({ step: "welcome", answers: EMPTY_ANSWERS });
  const [effects, setEffects] = useState<SimEffect[]>([]);
  const [finished, setFinished] = useState<{ answers: Answers; how: FinishHow; open: Mode | null } | null>(null);
  const [room, setRoom] = useState({ width: 1200, height: 800 });
  const [channel] = useState(() => createChannel(initial.prefs.scenario));
  const viewport = useRef<HTMLDivElement>(null);
  const logList = useRef<HTMLOListElement>(null);

  useEffect(() => {
    channel.setScenario(prefs.scenario);
    window.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }, [channel, prefs]);

  useEffect(() => {
    channel.listen((effect) => setEffects((list) => [...list, effect]));
  }, [channel]);

  useEffect(() => {
    const list = logList.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [effects]);

  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setRoom({ width: entry.contentRect.width, height: entry.contentRect.height }));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const env = useMemo(() => Object.assign(createSimEnv(channel.scenario, channel.emit, run.answers), { SignInSurface }), [run, channel]);

  const setScenario = (patch: Partial<Scenario>) => setPrefs((p) => ({ ...p, scenario: { ...p.scenario, ...patch } }));
  const setPref = <K extends keyof Prefs>(key: K, value: Prefs[K]) => setPrefs((p) => ({ ...p, [key]: value }));

  const chosen: Path = { runsOn: prefs.path, rooms: prefs.rooms };

  const start = (from: StepId | "boot", path: Path = chosen) => {
    const step: StepId = from === "boot" ? "welcome" : from;
    const answers = step === "welcome" ? EMPTY_ANSWERS : answersBefore(step, path, prefs.scenario);
    setEffects([]);
    setFinished(null);
    setCurrent({ step, answers });
    setRun((r) => ({ id: r.id + 1, stage: from === "boot" ? "boot" : "onboarding", step, answers, startedAt: Date.now() }));
  };

  const restart = () => start(prefs.boot ? "boot" : "welcome");

  const go = (step: StepId, next: Path) => {
    setPrefs((p) => ({ ...p, path: next.runsOn ?? p.path, rooms: [...next.rooms] }));
    start(step, next);
  };

  const jump = (step: StepId) => go(step, pathFor(step, chosen));

  const stay = (next: Path, fallback: StepId) =>
    go(run.stage === "onboarding" && stepsFor(next).includes(current.step) && stepsFor(chosen).includes(current.step) ? current.step : fallback, next);

  const onStep = useCallback((step: StepId, answers: Answers) => {
    setCurrent({ step, answers });
    setPrefs((p) => {
      const path = answers.runsOn ?? p.path;
      const rooms = answers.rooms.length ? answers.rooms : p.rooms;
      return path === p.path && rooms.join() === p.rooms.join() ? p : { ...p, path, rooms: [...rooms] };
    });
  }, []);

  const onFinish = useCallback((answers: Answers, how: FinishHow, open: Mode | null) => {
    setFinished({ answers, how, open });
    setRun((r) => ({ ...r, stage: "finished" }));
  }, []);

  const booted = useCallback(() => setRun((r) => (r.stage === "boot" ? { ...r, stage: "onboarding" } : r)), []);

  const size = WINDOWS[prefs.windowSize];
  const scale = prefs.fit ? Math.min(1, room.width / size.width, room.height / size.height) : 1;
  const path = stepsFor(chosen);
  const everyStep = stepsFor({ runsOn: "host", rooms: ALL_ROOMS });
  const at = run.stage === "finished" ? path.length : path.indexOf(current.step);
  const missing = new Set(effects.filter((e) => e.missing).map((e) => e.text)).size;
  const onMac = prefs.path === "mac";
  const where = onMac ? "this Mac" : "the host";
  const school = prefs.rooms.includes("school");
  const agents = prefs.rooms.includes("agent");
  const usesAi = providersFor(prefs.rooms).length > 0;
  const sc = prefs.scenario;

  return (
    <div className={s.sim}>
      <div className={s.stageArea}>
        <div className={s.toolbar}>
          <div className={s.toolbarTitle}>
            <span>Slates.app, first launch</span>
            <span>
              {size.width} × {size.height}
              {size.zoom !== 1 ? ` at ${Math.round(size.zoom * 100)}%` : ""} · shown at {Math.round(scale * 100)}%
            </span>
          </div>
          <Segmented
            label="Window size"
            value={prefs.windowSize}
            options={(Object.keys(WINDOWS) as WindowSize[]).map((key) => ({ value: key, label: WINDOWS[key].label }))}
            onChange={(value) => setPref("windowSize", value)}
          />
          <Segmented
            label="Scale"
            value={prefs.fit ? "fit" : "actual"}
            options={[
              { value: "fit", label: "Fit" },
              { value: "actual", label: "Actual size" },
            ]}
            onChange={(value) => setPref("fit", value === "fit")}
          />
          <div className={s.switchRow}>
            <span>Reduce motion</span>
            <Toggle on={prefs.reducedMotion} onClick={() => setPref("reducedMotion", !prefs.reducedMotion)} label="Reduce motion" />
          </div>
        </div>

        <div className={s.timeline} role="toolbar" aria-label="Jump to a step">
          <button type="button" className={s.tick} data-now={run.stage === "boot" || undefined} data-past={run.stage !== "boot" || undefined} onClick={() => start("boot")}>
            <span className={s.tickDot} />
            Launch
          </button>
          {everyStep.map((step) => {
            const onPath = path.includes(step);
            return (
              <button
                key={step}
                type="button"
                className={s.tick}
                data-now={(run.stage === "onboarding" && current.step === step) || undefined}
                data-past={(onPath && path.indexOf(step) < at) || undefined}
                data-off={!onPath || undefined}
                onClick={() => jump(step)}
                title={onPath ? undefined : offPathNote(step)}
              >
                <span className={s.tickDot} />
                {STEP_LABEL[step]}
              </button>
            );
          })}
        </div>

        <div className={s.viewport} ref={viewport} data-fit={prefs.fit || undefined}>
          <div className={s.frameBox} style={{ width: size.width * scale, height: size.height * scale }}>
            <div className={s.window} style={{ width: size.width, height: size.height, transform: `scale(${scale})` }}>
              <div className={s.content} style={{ zoom: size.zoom }}>
                {run.stage === "boot" && <Boot key={run.id} speed={sc.speed} emit={channel.emit} onDone={booted} />}
                {run.stage === "onboarding" && (
                  <Onboarding
                    key={run.id}
                    env={env}
                    initialStep={run.step}
                    initialAnswers={run.answers}
                    reducedMotion={prefs.reducedMotion}
                    onStep={onStep}
                    onFinish={onFinish}
                  />
                )}
                {run.stage === "finished" && finished && (
                  <div className={s.finished}>
                    <div className={s.finishedCard}>
                      <h2>{finished.how === "done" ? "Setup is finished" : "Setup was put off"}</h2>
                      <p>
                        {finished.how === "skipped"
                          ? "The real app opens on the launcher instead, with nothing set up yet."
                          : finished.open
                            ? `The real app now opens ${ROOM_TITLE[finished.open]}, with everything chosen here.`
                            : "The real app now opens on the launcher, showing the rooms chosen here."}
                      </p>
                      <div className={s.finishedActions}>
                        <button type="button" className="btn btn--primary" onClick={restart}>
                          Run it again
                        </button>
                        <button type="button" className="btn btn--quiet" onClick={() => jump("done")}>
                          Back to the last step
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className={s.lights} aria-hidden>
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
        </div>
      </div>

      <aside className={s.panel}>
        <div className={s.panelHead}>
          <div className={s.panelTitle}>
            <h1>Onboarding simulator</h1>
            <button type="button" className="btn btn--primary" onClick={restart}>
              Restart
            </button>
          </div>
          <p className={s.panelLede}>The Mac app&apos;s first launch, with every answer faked. Nothing here reaches Schoology, a host, or ~/.slates.</p>
        </div>

        <div className={s.controls}>
          <Group title="Run">
            <Switch label="Start with the splash" on={prefs.boot} onChange={(on) => setPref("boot", on)} />
            <Switch label="Fill in sample answers" on={sc.prefill} onChange={(on) => setScenario({ prefill: on })} />
            <Control label="Speed">
              <Segmented
                label="Speed"
                value={sc.speed}
                options={SPEEDS.map((speed) => ({ value: speed, label: speed === 0.5 ? "½×" : `${speed}×` }))}
                onChange={(speed) => setScenario({ speed })}
              />
            </Control>
            <Control label="Path for jumps">
              <Segmented
                label="Path"
                value={prefs.path}
                options={[
                  { value: "mac", label: "On this Mac" },
                  { value: "host", label: "On a host" },
                ]}
                onChange={(runsOn) => stay({ runsOn, rooms: prefs.rooms }, "where")}
              />
            </Control>
            <Control label="Rooms for jumps">
              <div className={s.chips} role="group" aria-label="Rooms for jumps">
                {APPS.map((app) => {
                  const on = prefs.rooms.includes(app.mode);
                  return (
                    <button
                      key={app.mode}
                      type="button"
                      aria-pressed={on}
                      disabled={on && prefs.rooms.length === 1}
                      onClick={() => stay({ runsOn: prefs.path, rooms: on ? prefs.rooms.filter((m) => m !== app.mode) : withRoom(prefs.rooms, app.mode) }, "rooms")}
                    >
                      {app.title}
                    </button>
                  );
                })}
              </div>
            </Control>
          </Group>

          <Group title="Host" aside={onMac ? "host path only" : undefined} dim={onMac}>
            <Control label="When setup reaches it">
              <Segmented
                label="Host answers"
                value={sc.host}
                options={[
                  { value: "answers", label: "Answers" },
                  { value: "slow", label: "Slowly" },
                  { value: "silent", label: "Never" },
                  { value: "other", label: "Isn't Slates" },
                ]}
                onChange={(host) => setScenario({ host })}
              />
            </Control>
            <Control label="It runs">
              <Segmented
                label="Host platform"
                value={sc.hostPlatform}
                options={[
                  { value: "win32", label: "Windows" },
                  { value: "darwin", label: "macOS" },
                  { value: "linux", label: "Linux" },
                ]}
                onChange={(hostPlatform) => setScenario({ hostPlatform })}
              />
            </Control>
            <Switch label="Already signed in to Schoology" on={sc.hostSignedIn} onChange={(hostSignedIn) => setScenario({ hostSignedIn })} />
            <Switch label="Tailscale on this Mac" on={sc.tailscaleOnMac} onChange={(tailscaleOnMac) => setScenario({ tailscaleOnMac })} />
            <Control label="Pairing code">
              <Segmented
                label="Pairing code"
                value={sc.pairing}
                options={[
                  { value: "accepted", label: "Accepted" },
                  { value: "wrong", label: "Wrong" },
                  { value: "expired", label: "Expired" },
                ]}
                onChange={(pairing) => setScenario({ pairing })}
              />
            </Control>
          </Group>

          <Group title="Schoology" aside={school ? undefined : "with School only"} dim={!school}>
            <Control label="Sign-in">
              <Segmented
                label="Sign-in"
                value={sc.signIn}
                options={[
                  { value: "succeeds", label: "Signs in" },
                  { value: "idle", label: "Walks away" },
                  { value: "expired", label: "Runs out" },
                  { value: "replaced", label: "Opened elsewhere" },
                  { value: "no-service", label: "No sync service" },
                ]}
                onChange={(signIn) => setScenario({ signIn })}
              />
            </Control>
            <Control label="First sync">
              <Segmented
                label="First sync"
                value={sc.sync}
                options={[
                  { value: "finds-classes", label: "Finds classes" },
                  { value: "signed-out", label: "Signed out" },
                  { value: "empty", label: "No classes" },
                  { value: "service-down", label: "Service down" },
                ]}
                onChange={(sync) => setScenario({ sync })}
              />
            </Control>
          </Group>

          <Group title={`AI already on ${where}`} aside={usesAi ? undefined : "no room uses it"} dim={!usesAi}>
            {PROVIDER_IDS.map((id) => (
              <Switch key={id} label={PROVIDER_LABEL[id]} on={sc.providers[id]} onChange={(on) => setScenario({ providers: { ...sc.providers, [id]: on } })} />
            ))}
            <Switch label="Test passes" on={sc.keysPass} onChange={(keysPass) => setScenario({ keysPass })} />
          </Group>

          <Group title="macOS" aside={agents ? undefined : "with Agent only"} dim={!agents}>
            <Control label="Notification prompt">
              <Segmented
                label="Notification prompt"
                value={sc.notifications}
                options={[
                  { value: "allow", label: "Allow" },
                  { value: "deny", label: "Don't Allow" },
                ]}
                onChange={(notifications) => setScenario({ notifications })}
              />
            </Control>
          </Group>

          <details className={s.answers}>
            <summary>Answers so far</summary>
            <pre>{readable(current.answers)}</pre>
          </details>
        </div>

        <section className={s.log} aria-label="What the real app would do">
          <div className={s.logHead}>
            <h2>What the real app would do</h2>
            {missing > 0 && (
              <span className={s.logCount} data-tone="warn">
                {missing} not built yet
              </span>
            )}
            <button type="button" className="btn btn--quiet" style={{ height: 24, padding: "0 10px", fontSize: 11 }} onClick={() => setEffects([])} disabled={!effects.length}>
              Clear
            </button>
          </div>
          <ol className={s.logList} ref={logList}>
            {effects.length === 0 ? (
              <li className={s.logEmpty}>Nothing yet. Every call, save and process the app would start lands here as it happens.</li>
            ) : (
              effects.map((effect) => (
                <li key={effect.id} className={s.entry}>
                  <span className={s.entryTime}>{elapsed(effect.at - run.startedAt)}</span>
                  <span className={s.kind} data-kind={effect.kind}>
                    {effect.kind}
                  </span>
                  <span className={s.entryText}>
                    {effect.text}
                    {effect.missing && <span className={s.missing}>not built</span>}
                  </span>
                </li>
              ))
            )}
          </ol>
        </section>
      </aside>
    </div>
  );
}

interface SplashBoot {
  step(id: string, label: string, state?: "waiting" | "active" | "done" | "failed"): void;
  done(): void;
}

function Boot({ speed, emit, onDone }: { speed: number; emit: EmitEffect; onDone: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const play = () => {
    const boot = (frame.current?.contentWindow as (Window & { slatesBoot?: SplashBoot }) | null)?.slatesBoot;
    if (!boot) return onDone();
    const plan: [number, () => void][] = [
      [
        250,
        () => {
          boot.step("scraper", "Starting the sync service", "active");
          emit({ kind: "spawn", text: "main.mjs starts the sync service: scraper/serve.mjs on :7529" });
        },
      ],
      [
        700,
        () => {
          boot.step("portal", "Starting the portal", "active");
          emit({ kind: "spawn", text: "main.mjs starts the portal: web/server.js on :7528" });
        },
      ],
      [1900, () => boot.step("portal", "Portal is up", "done")],
      [2500, () => boot.step("scraper", "Sync service running", "done")],
      [
        2800,
        () => {
          boot.step("board", "Opening setup", "active");
          emit({ kind: "bridge", missing: true, text: "First launch has no slates.onboarding.v1, so the window opens setup first" });
        },
      ],
      [3100, () => boot.done()],
      [3650, onDone],
    ];
    for (const [ms, action] of plan) timers.current.push(window.setTimeout(action, ms / speed));
  };

  return <iframe ref={frame} className={s.splash} src="/onboarding-sim/splash" title="Slates is starting" onLoad={play} />;
}

function Group({ title, aside, dim, children }: { title: string; aside?: string; dim?: boolean; children: ReactNode }) {
  return (
    <section className={s.group} data-dim={dim || undefined}>
      <h3 className={s.groupTitle}>
        <span>{title}</span>
        {aside && <span className={s.groupAside}>{aside}</span>}
      </h3>
      <div className={s.groupBody}>{children}</div>
    </section>
  );
}

function Control({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={s.control}>
      <span className={s.controlLabel}>{label}</span>
      {children}
    </div>
  );
}

function Switch({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className={s.switchRow}>
      <span>{label}</span>
      <Toggle on={on} onClick={() => onChange(!on)} label={label} />
    </div>
  );
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className={s.segmented} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}
