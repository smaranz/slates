"use client";

import Image from "next/image";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import type { CSSProperties, ReactNode } from "react";

import {
  AnthropicLogo,
  Avatar,
  CursorLogo,
  DeepSeekLogo,
  ElevenLabsLogo,
  GeminiLogo,
  Icon,
  ICON,
  MiniMaxLogo,
  OpenAILogo,
  QwenLogo,
  Spinner,
  XaiLogo,
  ZaiLogo,
} from "@/components/ui";
import { APPS } from "@/lib/app-prefs";
import type { Mode } from "@/lib/mode";
import { ALL_ROOMS, providersFor } from "@/lib/onboarding/flow";
import type { Answers, BoardColumn, BoardItem, HostPlatform, ProviderId, ProviderState, RunsOn, StepId, SyncProgress } from "@/lib/onboarding/types";

import styles from "./onboarding.module.css";
import { EASE, LaptopIcon, LockIcon, PhoneIcon, TowerIcon } from "./parts";
import type { Live, LinkState, PairState, SignInState } from "./step";

export const ROOM_ACCENT: Record<Mode, string> = {
  school: "var(--info)",
  counselor: "oklch(0.8 0.13 300)",
  ui: "oklch(0.78 0.15 165)",
  usage: "oklch(0.82 0.12 85)",
  media: "oklch(0.8 0.13 25)",
  agent: "oklch(0.8 0.12 215)",
  health: "oklch(0.86 0.17 132)",
  day: "oklch(0.82 0.14 55)",
  vitals: "oklch(0.8 0.13 350)",
};

const LANES: { key: BoardColumn; name: string; tone: string }[] = [
  { key: "tonight", name: "Today", tone: "oklch(0.82 0.14 250)" },
  { key: "soon", name: "Tomorrow", tone: "oklch(0.76 0.13 75)" },
  { key: "week", name: "Later", tone: "oklch(0.72 0 0)" },
  { key: "done", name: "Turned in", tone: "oklch(0.72 0.13 145)" },
];

const SPRING = { type: "spring", stiffness: 260, damping: 28 } as const;

export function visualKind(step: StepId): string {
  if (step === "welcome" || step === "rooms" || step === "done") return "launcher";
  if (step === "where" || step === "host" || step === "pair") return "topology";
  return step;
}

export default function Visual({ step, answers, live }: { step: StepId; answers: Answers; live: Live }) {
  const hostName = live.hostName ?? answers.host?.name ?? "Your PC";
  const rooms = answers.rooms;
  switch (step) {
    case "welcome":
      return <Launcher rooms={ALL_ROOMS} />;
    case "rooms":
      return <Launcher rooms={live.rooms ?? rooms} dimWhenEmpty />;
    case "where":
      return <Topology mode={live.where === undefined ? answers.runsOn : live.where} hostName={hostName} link="idle" rooms={rooms} />;
    case "prepare":
      return <Terminal os={live.os ?? "win32"} />;
    case "host":
      return <Topology mode="host" hostName={hostName} link={live.link ?? (answers.host ? "up" : "idle")} rooms={rooms} />;
    case "pair":
      return <Topology mode="host" hostName={hostName} link="up" pair={live.pair ?? (answers.paired ? "paired" : "asking")} rooms={rooms} />;
    case "schoology":
      return (
        <Browser
          domain={live.domain ?? answers.schoology?.domain ?? null}
          state={live.signIn ?? (answers.schoology ? "done" : "checking")}
          where={answers.runsOn === "host" && answers.host ? answers.host.name : "this Mac"}
        />
      );
    case "sync":
      return answers.sync ? (
        <BoardPreview items={answers.sync.board} />
      ) : (
        <BoardPreview items={live.sync?.found ?? []} progress={live.sync ?? null} failed={live.syncFailed} />
      );
    case "done":
      return <Launcher rooms={rooms} />;
    case "profile":
      return <Sidebar name={answers.name} avatar={answers.avatar} />;
    case "ai":
      return <Models providers={live.providers ?? answers.providers} rooms={rooms} />;
    case "notify":
      return <Notification state={live.notify ?? (answers.notifications === "granted" || answers.notifications === "denied" ? answers.notifications : "idle")} />;
  }
}

/* ---------- where Slates runs ---------- */

function Node({
  id,
  icon,
  title,
  sub,
  chips,
  badge,
  badgeTone,
  dim,
  className,
}: {
  id: string;
  icon: ReactNode;
  title: string;
  sub: string;
  chips: string[];
  badge?: ReactNode;
  badgeTone?: "good";
  dim?: boolean;
  className?: string;
}) {
  return (
    <motion.div
      layout
      layoutId={id}
      className={`${styles.node} ${className ?? ""}`}
      data-dim={dim || undefined}
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: dim ? 0.45 : 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={SPRING}
    >
      <motion.div layout="position" className={styles.nodeHead}>
        {icon}
        {title}
      </motion.div>
      <motion.div layout="position" className={styles.nodeSub}>
        {sub}
      </motion.div>
      {chips.length > 0 && (
        <motion.div layout="position" className={styles.nodeChips}>
          {chips.map((chip) => (
            <span key={chip} className={styles.nodeChip}>
              {chip}
            </span>
          ))}
        </motion.div>
      )}
      <AnimatePresence>
        {badge && (
          <motion.span
            key="badge"
            className={styles.badge}
            data-tone={badgeTone}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={SPRING}
          >
            {badge}
          </motion.span>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function Wire({ state, label, id }: { state: LinkState; label?: string; id: string }) {
  return (
    <motion.div layout layoutId={id} className={styles.link} data-state={state} transition={SPRING}>
      <svg aria-hidden>
        <line x1="8%" y1="5" x2="92%" y2="5" />
      </svg>
      {label && <span className={styles.linkLabel}>{label}</span>}
      {state === "down" && (
        <span className={styles.linkMark}>
          <Icon path={ICON.close} size={11} />
        </span>
      )}
    </motion.div>
  );
}

function Topology({
  mode,
  hostName,
  link,
  pair,
  rooms,
}: {
  mode: RunsOn | null;
  hostName: string;
  link: LinkState;
  pair?: PairState;
  rooms: readonly Mode[];
}) {
  const onHost = mode === "host";
  const school = rooms.includes("school");
  const services = ["Portal", ...(rooms.includes("agent") ? ["Agents"] : []), ...(school ? ["Sync service"] : [])];
  const pairBadge =
    pair === undefined ? undefined : pair === "paired" ? (
      <LockIcon open />
    ) : pair === "pairing" || pair === "asking" ? (
      <Spinner size={12} />
    ) : (
      <LockIcon />
    );
  return (
    <LayoutGroup>
      <div className={styles.topo}>
        <motion.div layout className={styles.column} transition={SPRING}>
          <Node
            id="mac"
            icon={<LaptopIcon size={16} />}
            title="This Mac"
            sub={onHost ? "A window onto Slates" : "Runs everything"}
            chips={onHost ? ["Slates window"] : services}
            badge={onHost ? pairBadge : undefined}
            badgeTone={pair === "paired" ? "good" : undefined}
            dim={mode === null}
          />
          <AnimatePresence>
            {onHost && <Node key="phone" id="phone" icon={<PhoneIcon size={16} />} title="Your phone" sub="The Slates app" chips={[]} />}
          </AnimatePresence>
        </motion.div>
        <AnimatePresence mode="popLayout">
          {onHost && <Wire key="tailnet" id="tailnet" state={link} label="Tailscale" />}
          {onHost && <Node key="host" id="host" icon={<TowerIcon size={16} />} title={hostName} sub="Stays on" chips={services} />}
        </AnimatePresence>
        <AnimatePresence mode="popLayout">
          {school && <Wire key="school-link" id="school-link" state="idle" />}
          {school && (
            <Node
              key="schoology"
              id="schoology"
              className={styles.place}
              icon={<Icon path={ICON.classes} size={15} />}
              title="Schoology"
              sub="Read by the sync service"
              chips={[]}
              dim={mode === null}
            />
          )}
        </AnimatePresence>
      </div>
    </LayoutGroup>
  );
}

const SESSIONS: Record<HostPlatform, { title: string; prompt: string; lines: { input?: boolean; text: string; tone?: "good" }[] }> = {
  win32: {
    title: "Windows PowerShell",
    prompt: "PS C:\\Users\\you>",
    lines: [
      { input: true, text: "git clone https://github.com/smaranz/slates.git $env:USERPROFILE\\slates" },
      { text: "Cloning into 'C:\\Users\\you\\slates'..." },
      { input: true, text: "cd $env:USERPROFILE\\slates; node bin\\slates.js host" },
      { text: "[host] installing dependencies in web/" },
      { text: "[host] building the portal (a few minutes)" },
      { text: "[host] portal ready on http://127.0.0.1:7528", tone: "good" },
      { input: true, text: "tailscale funnel --bg 7528" },
      { text: "Available on the internet:" },
      { text: "https://gaming-pc.tail1234.ts.net/", tone: "good" },
      { text: "|-- proxy http://127.0.0.1:7528" },
    ],
  },
  darwin: {
    title: "Terminal",
    prompt: "you@mac-mini ~ %",
    lines: [
      { input: true, text: "git clone https://github.com/smaranz/slates.git ~/slates" },
      { text: "Cloning into '/Users/you/slates'..." },
      { input: true, text: "cd ~/slates && caffeinate -s node bin/slates.js host" },
      { text: "[host] installing dependencies in web/" },
      { text: "[host] building the portal (a few minutes)" },
      { text: "[host] portal ready on http://127.0.0.1:7528", tone: "good" },
      { input: true, text: "tailscale funnel --bg 7528" },
      { text: "Available on the internet:" },
      { text: "https://mac-mini.tail1234.ts.net/", tone: "good" },
      { text: "|-- proxy http://127.0.0.1:7528" },
    ],
  },
  linux: {
    title: "Terminal",
    prompt: "you@server:~$",
    lines: [
      { input: true, text: "git clone https://github.com/smaranz/slates.git ~/slates" },
      { text: "Cloning into '/home/you/slates'..." },
      { input: true, text: "cd ~/slates && node bin/slates.js host" },
      { text: "[host] installing dependencies in web/" },
      { text: "[host] building the portal (a few minutes)" },
      { text: "[host] portal ready on http://127.0.0.1:7528", tone: "good" },
      { input: true, text: "sudo tailscale funnel --bg 7528" },
      { text: "Available on the internet:" },
      { text: "https://server.tail1234.ts.net/", tone: "good" },
      { text: "|-- proxy http://127.0.0.1:7528" },
    ],
  },
};

function Terminal({ os }: { os: HostPlatform }) {
  const session = SESSIONS[os];
  return (
    <div className={styles.terminal}>
      <div className={styles.terminalBar}>
        <span className={styles.browserDots}>
          <span />
          <span />
          <span />
        </span>
        <span className={styles.terminalTitle}>{session.title}, on the computer that stays on</span>
      </div>
      <div className={styles.terminalBody} key={os}>
        {session.lines.map((line, i) => (
          <motion.div
            key={i}
            className={styles.terminalLine}
            data-input={line.input || undefined}
            data-tone={line.tone}
            initial={{ opacity: 0, y: 3 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, ease: EASE, delay: 0.15 + i * 0.22 }}
          >
            {line.input && <span className={styles.terminalPrompt}>{session.prompt}</span>}
            {line.text}
          </motion.div>
        ))}
      </div>
    </div>
  );
}

/* ---------- the board ---------- */

function BoardPreview({
  items,
  progress = null,
  failed = false,
  sketch = false,
}: {
  items: BoardItem[];
  progress?: SyncProgress | null;
  failed?: boolean;
  sketch?: boolean;
}) {
  const syncing = progress !== null && !failed;
  return (
    <div className={styles.board}>
      {LANES.map((lane, laneIndex) => {
        const cards = items.filter((item) => item.column === lane.key);
        const shown = cards.slice(0, 3);
        const placeholders = sketch ? [3, 2, 2, 1][laneIndex] : syncing ? Math.max(0, 1 - shown.length) : 0;
        return (
          <div key={lane.key} className={styles.lane}>
            <div className={styles.laneHead}>
              <span className={styles.laneDot} style={{ background: lane.tone }} />
              {lane.name}
              {!sketch && <span className={styles.laneCount}>{cards.length}</span>}
            </div>
            <AnimatePresence initial={false}>
              {shown.map((item, i) => (
                <motion.div
                  key={item.id}
                  layout
                  className={styles.card}
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.45, ease: EASE, delay: i * 0.06 }}
                >
                  <div className={styles.cardTitle}>{item.title}</div>
                  <div className={styles.cardMeta}>
                    <span className={styles.cardDot} style={{ background: item.dot }} />
                    <span>{item.course}</span>
                    <span>·</span>
                    <span>{item.due}</span>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {Array.from({ length: placeholders }, (_, i) => (
              <motion.div
                key={`skeleton-${i}`}
                className={styles.skeleton}
                data-live={syncing || undefined}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: EASE, delay: 0.12 + laneIndex * 0.07 + i * 0.08 }}
              />
            ))}
            {cards.length > shown.length && <span className={styles.more}>{cards.length - shown.length} more</span>}
          </div>
        );
      })}
    </div>
  );
}

/* ---------- the sign-in window ---------- */

function Browser({ domain, state, where }: { domain: string | null; state: SignInState; where: string }) {
  const address = `${domain ?? "yourschool.schoology.com"}/${state === "done" ? "home" : "login"}`;
  const pill =
    state === "checking" ? (
      <>
        <Spinner size={12} />
        Looking for a session
      </>
    ) : state === "waiting" ? (
      <>
        <Spinner size={12} />
        Waiting for you to sign in
      </>
    ) : state === "done" ? (
      <>
        <Icon path={ICON.check} size={14} />
        Signed in
      </>
    ) : state === "failed" ? (
      <>
        <Icon path={ICON.alert} size={12} />
        Not signed in
      </>
    ) : null;
  return (
    <div className={styles.browserWrap}>
      <motion.div className={styles.browser} animate={{ opacity: state === "idle" ? 0.62 : 1 }} transition={{ duration: 0.4 }}>
        <div className={styles.browserBar}>
          <span className={styles.browserDots}>
            <span />
            <span />
            <span />
          </span>
          <span className={styles.browserUrl}>
            <LockIcon size={11} />
            {address}
          </span>
        </div>
        <div className={styles.browserBody}>
          <div className={styles.sgyHeader} />
          <div className={styles.sgyPage}>
            <div className={styles.sgyNav}>
              {[72, 54, 64, 48, 58].map((w, i) => (
                <span key={i} className={styles.sgyLine} style={{ width: `${w}%` }} />
              ))}
            </div>
            <div className={styles.sgyMain}>
              {[0, 1, 2].map((i) => (
                <span key={i} className={styles.sgyCard} />
              ))}
            </div>
          </div>
          <AnimatePresence>
            {state !== "done" && (
              <motion.div key="signin" className={styles.signin} initial={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5 }}>
                <div className={styles.signinCard} data-live={state === "waiting" || undefined}>
                  <span className={styles.signinField} />
                  <span className={styles.signinField} />
                  <span className={styles.signinButton} />
                </div>
              </motion.div>
            )}
          </AnimatePresence>
          <AnimatePresence mode="wait">
            {pill && (
              <motion.span
                key={state}
                className={styles.browserPill}
                data-tone={state === "done" ? "good" : state === "failed" ? "bad" : undefined}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.3, ease: EASE }}
                style={{ x: "-50%" }}
              >
                {pill}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
      <p className={styles.caption}>Chrome on {where}, with a profile that only holds Schoology</p>
    </div>
  );
}

/* ---------- you ---------- */

const SIDE_ITEMS: { label: string; icon: string }[] = [
  { label: "Board", icon: ICON.overview },
  { label: "Calendar", icon: ICON.calendar },
  { label: "Grades", icon: ICON.grades },
  { label: "Classes", icon: ICON.classes },
  { label: "Tutor", icon: ICON.tutor },
  { label: "Messages", icon: ICON.messages },
];

function Sidebar({ name, avatar }: { name: string; avatar: string | null }) {
  const shown = name.trim();
  return (
    <div className={styles.app}>
      <div className={styles.side}>
        <div className={styles.sideUser}>
          <Avatar src={avatar} name={shown || "S"} size={30} />
          <span className={styles.sideName} data-empty={!shown || undefined}>
            {shown || "Your name"}
          </span>
        </div>
        {SIDE_ITEMS.map((item, i) => (
          <span key={item.label} className={styles.sideItem} data-on={i === 0 || undefined}>
            <Icon path={item.icon} size={14} />
            {item.label}
          </span>
        ))}
      </div>
      <div className={styles.appMain}>
        {Array.from({ length: 6 }, (_, i) => (
          <span key={i} className={styles.skeleton} />
        ))}
      </div>
    </div>
  );
}

/* ---------- rooms ---------- */

export function RoomMark({ mode }: { mode: Mode }) {
  const faint = { stroke: "currentColor", strokeOpacity: 0.45, strokeWidth: 1.5, fill: "none" } as const;
  const lit = { stroke: "var(--accent)", strokeWidth: 1.7, fill: "none" } as const;
  return (
    <svg className={styles.doorMark} viewBox="0 0 30 30" aria-hidden>
      {mode === "school" && (
        <>
          <rect x="3" y="5" width="7" height="20" rx="2" {...lit} />
          <rect x="11.5" y="5" width="7" height="20" rx="2" {...faint} />
          <rect x="20" y="5" width="7" height="20" rx="2" {...faint} />
          <rect x="4.6" y="8" width="3.8" height="3.4" rx="1.2" fill="var(--accent)" />
        </>
      )}
      {mode === "counselor" && (
        <>
          <circle cx="15" cy="15" r="12" {...faint} />
          <circle cx="15" cy="15" r="7.5" {...faint} />
          <circle cx="15" cy="15" r="3.4" {...lit} />
        </>
      )}
      {mode === "ui" && (
        <>
          <rect x="6" y="5" width="18" height="6.5" rx="2" {...lit} />
          <rect x="6" y="12.5" width="18" height="6.5" rx="2" {...faint} />
          <rect x="6" y="20" width="18" height="6.5" rx="2" {...faint} />
        </>
      )}
      {mode === "usage" && (
        <>
          <rect x="6" y="15" width="4.5" height="10" rx="1.5" {...faint} />
          <rect x="12.75" y="7" width="4.5" height="18" rx="1.5" {...lit} />
          <rect x="19.5" y="11" width="4.5" height="14" rx="1.5" {...faint} />
        </>
      )}
      {mode === "media" && (
        <>
          <rect x="3" y="4" width="24" height="22" rx="5" {...faint} />
          <path d="M11 10v10l8-5z" fill="var(--accent)" />
        </>
      )}
      {mode === "agent" && (
        <>
          <rect x="3" y="5" width="24" height="17" rx="4" {...faint} />
          <path d="M8.5 11l3.5 2.6-3.5 2.6" stroke="var(--accent)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          <rect x="14" y="15.4" width="5.5" height="1.6" rx="0.8" fill="var(--accent)" />
          <path d="M11 26h8" {...faint} strokeLinecap="round" />
        </>
      )}
      {mode === "health" && (
        <>
          <circle cx="15" cy="15" r="12" {...faint} />
          <circle cx="15" cy="15" r="12" {...lit} strokeLinecap="round" strokeDasharray="46.7 100" transform="rotate(-90 15 15)" />
          <path d="M7.5 15.5h3.4l1.7-3.4 2.5 6.2 1.7-2.8h5.7" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        </>
      )}
    </svg>
  );
}

function Launcher({ rooms, dimWhenEmpty = false }: { rooms: readonly Mode[]; dimWhenEmpty?: boolean }) {
  const empty = rooms.length === 0 && dimWhenEmpty;
  const doors = empty ? APPS : APPS.filter((app) => rooms.includes(app.mode));
  return (
    <div className={styles.launcher}>
      <Image src="/assets/slates-mark.png" alt="" width={28} height={28} unoptimized />
      <motion.div layout className={styles.doors} transition={SPRING}>
        <AnimatePresence mode="popLayout" initial={false}>
          {doors.map((door) => (
            <motion.div
              key={door.mode}
              layout
              className={styles.door}
              style={{ "--accent": ROOM_ACCENT[door.mode] } as CSSProperties}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: empty ? 0.32 : 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={SPRING}
            >
              <RoomMark mode={door.mode} />
              <span className={styles.doorTitle}>{door.title}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

/* ---------- AI ---------- */

const FAMILIES: { name: string; via: string; provider: ProviderId; logo: ReactNode }[] = [
  { name: "GPT-5.6", via: "OpenAI", provider: "openai", logo: <OpenAILogo size={17} /> },
  { name: "Claude", via: "Claude Code", provider: "claude-code", logo: <AnthropicLogo size={17} /> },
  { name: "Grok", via: "Cursor", provider: "cursor-agent", logo: <XaiLogo size={17} /> },
  { name: "Composer", via: "Cursor", provider: "cursor-agent", logo: <CursorLogo size={17} /> },
  { name: "DeepSeek", via: "OpenRouter", provider: "openrouter", logo: <DeepSeekLogo size={17} /> },
  { name: "GLM", via: "OpenRouter", provider: "openrouter", logo: <ZaiLogo size={16} /> },
  { name: "Qwen", via: "OpenRouter", provider: "openrouter", logo: <QwenLogo size={17} /> },
  { name: "Gemini", via: "OpenRouter", provider: "openrouter", logo: <GeminiLogo size={17} /> },
  { name: "MiniMax", via: "OpenRouter", provider: "openrouter", logo: <MiniMaxLogo size={17} /> },
];

function Models({ providers, rooms }: { providers: ProviderState[] | null; rooms: readonly Mode[] }) {
  const ready = (id: ProviderId) => providers?.some((p) => p.id === id && p.ready) ?? false;
  const used = providersFor(rooms);
  const families = FAMILIES.filter((family) => used.includes(family.provider));
  const count = families.filter((f) => ready(f.provider)).length;
  return (
    <div className={styles.models}>
      {families.length > 0 && (
        <div className={styles.modelsHead}>
          <span>Models your rooms can use</span>
          <span>{providers ? `${count} of ${families.length} ready` : "Checking"}</span>
        </div>
      )}
      <div className={styles.modelGrid}>
        {families.map((family, i) => (
          <motion.div
            key={family.name}
            className={styles.model}
            data-ready={ready(family.provider) || undefined}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: EASE, delay: i * 0.03 }}
          >
            {family.logo}
            <span>
              <span className={styles.modelName}>{family.name}</span>
              <span className={styles.modelVia}>{family.via}</span>
            </span>
          </motion.div>
        ))}
      </div>
      {used.includes("elevenlabs") && (
        <>
          <div className={styles.modelsHead}>
            <span>Voice, sound and music</span>
          </div>
          <div className={styles.modelGrid}>
            <div className={styles.model} data-ready={ready("elevenlabs") || undefined}>
              <ElevenLabsLogo size={16} />
              <span>
                <span className={styles.modelName}>ElevenLabs</span>
                <span className={styles.modelVia}>{rooms.includes("media") ? "Media Gen Studio" : "Narrated lessons"}</span>
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- notifications ---------- */

function Notification({ state }: { state: "idle" | "asking" | "granted" | "denied" }) {
  return (
    <div className={styles.desktop}>
      <div className={styles.menubar}>
        <span>Thu 4:12 PM</span>
      </div>
      <motion.div
        className={styles.banner}
        data-off={state === "denied" || undefined}
        initial={{ opacity: 0, x: 40 }}
        animate={{ opacity: state === "idle" ? 0.55 : 1, x: 0 }}
        transition={{ duration: 0.6, ease: EASE, delay: 0.15 }}
      >
        <span className={styles.bannerIcon}>
          <Image src="/assets/slates-mark.png" alt="" width={20} height={20} unoptimized />
        </span>
        <span className={styles.bannerText}>
          <span className={styles.bannerTitle}>
            <span>Slates</span>
            <span>now</span>
          </span>
          <span className={styles.bannerBody} style={{ display: "block" }}>
            Juno sent you “Unit 6 review.pdf”. It’s in Downloads › Slates.
          </span>
        </span>
      </motion.div>
      <AnimatePresence mode="wait">
        {state !== "idle" && (
          <motion.span
            key={state}
            className={styles.bannerState}
            data-tone={state === "granted" ? "good" : state === "denied" ? "bad" : undefined}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
          >
            {state === "asking" ? (
              <>
                <Spinner size={12} />
                macOS is asking
              </>
            ) : state === "granted" ? (
              <>
                <Icon path={ICON.check} size={13} />
                Allowed
              </>
            ) : (
              <>
                <Icon path={ICON.alert} size={12} />
                Notifications off
              </>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
