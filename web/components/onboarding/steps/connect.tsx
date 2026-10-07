"use client";

import Image from "next/image";
import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icon, ICON } from "@/components/ui";
import { APPS } from "@/lib/app-prefs";
import type { Mode } from "@/lib/mode";
import {
  ALL_ROOMS,
  firstName,
  formatPairingCode,
  isAbort,
  normalizeHostUrl,
  normalizeSchoologyDomain,
  pairingDigits,
  type HostUrlProblem,
} from "@/lib/onboarding/flow";
import type { HostInfo, HostPlatform, PairProblem, RunsOn, SignInProblem, SyncProblem, SyncProgress } from "@/lib/onboarding/types";

import styles from "../onboarding.module.css";
import { Actions, Body, Code, EASE, Field, LaptopIcon, Primary, Quiet, Reveal, Status, StepHead, TowerIcon, useAttempts } from "../parts";
import type { LinkState, PairState, SignInState, StepProps } from "../step";
import { ROOM_ACCENT, RoomMark } from "../visuals";

const PLATFORM: Record<HostPlatform, string> = { darwin: "Mac", win32: "Windows PC", linux: "Linux computer" };

export function Welcome({ next, finish }: StepProps) {
  return (
    <>
      <Reveal i={0}>
        <Image className={styles.mark} src="/assets/slates-mark.png" alt="" width={44} height={44} priority unoptimized />
      </Reveal>
      <StepHead title="Welcome to Slates">
        <p>One app with a room for each part of your life, from your classes to the code you write. It runs on your own computer, and every room reads the same record.</p>
      </StepHead>
      <Actions note="Setup takes a few minutes, and only asks about the rooms you pick.">
        <Primary onClick={next}>Get started</Primary>
        <Quiet onClick={() => finish("skipped", null)}>Set up later</Quiet>
      </Actions>
    </>
  );
}

export function Rooms({ env, answers, update, patchLive, next }: StepProps) {
  const [chosen, setChosen] = useState<Mode[]>(() => (answers.rooms.length ? answers.rooms : [...(env.prefill?.rooms ?? [])]));

  useEffect(() => {
    patchLive({ rooms: chosen });
  }, [chosen, patchLive]);

  const toggle = (mode: Mode) =>
    setChosen((current) => (current.includes(mode) ? current.filter((m) => m !== mode) : ALL_ROOMS.filter((m) => m === mode || current.includes(m))));

  const go = (event: FormEvent) => {
    event.preventDefault();
    if (!chosen.length) return;
    update({ rooms: chosen });
    env.saveRooms(ALL_ROOMS.filter((m) => !chosen.includes(m)));
    next();
  };

  return (
    <form onSubmit={go}>
      <StepHead title="What will you use Slates for?">
        <p>Each room is its own app. Pick yours, and setup only asks about what they need. Settings › General brings back any room later.</p>
      </StepHead>
      <Body>
        <fieldset className={styles.roomPick}>
          <legend className={styles.srOnly}>Rooms</legend>
          {APPS.map((app) => (
            <label key={app.mode} className={styles.roomOption} style={{ "--accent": ROOM_ACCENT[app.mode] } as CSSProperties}>
              <input className={styles.srOnly} type="checkbox" checked={chosen.includes(app.mode)} onChange={() => toggle(app.mode)} />
              <RoomMark mode={app.mode} />
              <span className={styles.rowText}>
                <span className={styles.rowTitle}>{app.title}</span>
                <span className={styles.rowSub}>{app.blurb}</span>
              </span>
              <span className={styles.check} aria-hidden>
                <Icon path={ICON.check} size={14} />
              </span>
            </label>
          ))}
        </fieldset>
      </Body>
      <Actions note={chosen.length ? `${chosen.length} of ${APPS.length} rooms chosen.` : "Pick at least one room."}>
        <Primary type="submit" disabled={!chosen.length}>
          Continue
        </Primary>
      </Actions>
    </form>
  );
}

function whatRuns(rooms: readonly Mode[]): string | null {
  const agents = rooms.includes("agent");
  const school = rooms.includes("school");
  if (agents && school) return "Your agents work there and Schoology syncs from there";
  if (agents) return "Your agents work there";
  if (school) return "Schoology syncs from there";
  return null;
}

export function Where({ env, answers, update, patchLive, next }: StepProps) {
  const [choice, setChoice] = useState<RunsOn | null>(answers.runsOn);
  const [busy, setBusy] = useState(false);
  const runs = whatRuns(answers.rooms);
  const agents = answers.rooms.includes("agent");
  const pauses = runs ? `. ${agents && answers.rooms.includes("school") ? "Agents and syncing pause" : agents ? "Agents pause" : "Syncing pauses"}` : ", and pauses";

  const options: { id: RunsOn; title: string; body: string; icon: ReactNode }[] = [
    { id: "mac", title: "On this Mac", body: `Everything runs here${pauses} while the Mac sleeps.`, icon: <LaptopIcon /> },
    {
      id: "host",
      title: "On a computer that stays on",
      body: "A desktop, gaming PC or Mac mini runs Slates. This Mac and your phone open it over Tailscale, from anywhere.",
      icon: <TowerIcon />,
    },
  ];

  const go = async (event: FormEvent) => {
    event.preventDefault();
    if (!choice) return;
    const moved = answers.runsOn !== null && answers.runsOn !== choice;
    if (choice === "mac") {
      setBusy(true);
      await env.connect({ runsOn: "mac" });
      update({ runsOn: "mac", host: null, paired: null, ...(moved ? { schoology: null, sync: null } : {}) });
    } else {
      update({ runsOn: "host", ...(moved ? { schoology: null, sync: null } : {}) });
    }
    next();
  };

  return (
    <form onSubmit={go}>
      <StepHead title="Where should Slates run?">
        <p>
          Slates runs a small server for your rooms.{" "}
          {runs ? `${runs}, so it works best on a computer that stays on.` : "It can live on this Mac, or on a computer that stays on so your phone can reach it too."}
        </p>
      </StepHead>
      <Body>
        <fieldset className={styles.choices} onMouseLeave={() => patchLive({ where: choice })}>
          <legend className={styles.srOnly}>Where Slates runs</legend>
          {options.map((option) => (
            <label key={option.id} className={styles.choice} onMouseEnter={() => patchLive({ where: option.id })}>
              <input
                className={styles.srOnly}
                type="radio"
                name="runs-on"
                value={option.id}
                checked={choice === option.id}
                onChange={() => {
                  setChoice(option.id);
                  patchLive({ where: option.id, chosen: option.id });
                }}
              />
              <span className={styles.choiceIcon}>{option.icon}</span>
              <span className={styles.choiceText}>
                <span className={styles.choiceTitle}>{option.title}</span>
                <span className={styles.choiceBody}>{option.body}</span>
              </span>
              <span className={styles.radio} aria-hidden />
            </label>
          ))}
        </fieldset>
      </Body>
      <Actions note={choice === "host" ? "Next: how to set Slates up on that computer, if it isn't running there yet." : undefined}>
        <Primary type="submit" disabled={!choice} busy={busy}>
          Continue
        </Primary>
      </Actions>
    </form>
  );
}

const OS_LABEL: Record<HostPlatform, string> = { win32: "Windows", darwin: "macOS", linux: "Linux" };

const SCHEDULED_TASK = [
  "$node = (Get-Command node).Source",
  '$slates = "$env:USERPROFILE\\slates"',
  '$action = New-ScheduledTaskAction -Execute "$env:WINDIR\\System32\\conhost.exe" `',
  '  -Argument "--headless `"$node`" `"$slates\\bin\\slates.js`" host" `',
  "  -WorkingDirectory $slates",
  "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME",
  "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `",
  "  -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)",
  'Register-ScheduledTask -TaskName "Slates host" -Action $action -Trigger $trigger -Settings $settings -Force',
  'Start-ScheduledTask -TaskName "Slates host"',
].join("\n");

const BASICS = (
  <>
    <a href="https://nodejs.org" target="_blank" rel="noreferrer">
      Node.js 22
    </a>
    ,{" "}
    <a href="https://git-scm.com" target="_blank" rel="noreferrer">
      Git
    </a>{" "}
    and{" "}
    <a href="https://www.google.com/chrome/" target="_blank" rel="noreferrer">
      Google Chrome
    </a>
  </>
);

const TAILSCALE = (
  <>
    Install{" "}
    <a href="https://tailscale.com/download" target="_blank" rel="noreferrer">
      Tailscale
    </a>{" "}
    there and sign in with the same account as this Mac. Then this prints the address ending in .ts.net that you’ll type next.
  </>
);

const KEYS = (
  <>
    Have API keys in <Code>~/.slates/.env</Code> on this Mac? Copy that file to the same place there.
  </>
);

interface GuideStep {
  title: string;
  body?: ReactNode;
  command?: string;
  extra?: { label: string; command: string };
}

const GUIDE: Record<HostPlatform, GuideStep[]> = {
  win32: [
    { title: "Install the basics", body: <>{BASICS}, in Windows itself rather than WSL, since Slates drives the installed Chrome.</> },
    { title: "Get Slates", body: KEYS, command: "git clone https://github.com/smaranz/slates.git $env:USERPROFILE\\slates" },
    {
      title: "Start it",
      body: "The first run installs and builds for a few minutes, then says portal ready. Leave it running.",
      command: "cd $env:USERPROFILE\\slates\nnode bin\\slates.js host",
    },
    { title: "Publish it with Tailscale", body: TAILSCALE, command: "tailscale funnel --bg 7528" },
    {
      title: "Keep it on",
      body: "Stop it sleeping while it’s plugged in.",
      command: "powercfg /change standby-timeout-ac 0",
      extra: { label: "Start Slates when you sign in to Windows, with no window", command: SCHEDULED_TASK },
    },
  ],
  darwin: [
    {
      title: "Install the basics",
      body: (
        <>
          {BASICS}. If <Code>git</Code> isn’t there yet, <Code>xcode-select --install</Code> adds it.
        </>
      ),
    },
    { title: "Get Slates", body: KEYS, command: "git clone https://github.com/smaranz/slates.git ~/slates" },
    {
      title: "Start it",
      body: "caffeinate keeps the Mac awake while Slates runs on power. The first run installs and builds for a few minutes, then says portal ready. Leave it running.",
      command: "cd ~/slates\ncaffeinate -s node bin/slates.js host",
    },
    { title: "Publish it with Tailscale", body: TAILSCALE, command: "tailscale funnel --bg 7528" },
  ],
  linux: [
    { title: "Install the basics", body: <>{BASICS} itself rather than Chromium, since Slates drives the installed Chrome.</> },
    { title: "Get Slates", body: KEYS, command: "git clone https://github.com/smaranz/slates.git ~/slates" },
    {
      title: "Start it",
      body: "The first run installs and builds for a few minutes, then says portal ready. Keep it running in tmux or a terminal you leave open.",
      command: "cd ~/slates\nnode bin/slates.js host",
    },
    {
      title: "Publish it with Tailscale",
      body: "Install Tailscale, sign in with the same account as this Mac, and publish Slates. The last line prints the address that ends in .ts.net.",
      command: "curl -fsSL https://tailscale.com/install.sh | sh\nsudo tailscale up\nsudo tailscale funnel --bg 7528",
    },
    { title: "Keep it on", body: "Turn off automatic suspend in its power settings." },
  ],
};

function Command({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const pre = useRef<HTMLPreElement>(null);
  return (
    <div className={styles.command}>
      <pre ref={pre}>{text}</pre>
      <button
        type="button"
        className={styles.copy}
        data-done={copied || undefined}
        onClick={() => {
          navigator.clipboard.writeText(text).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => pre.current && window.getSelection()?.selectAllChildren(pre.current)
          );
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export function Prepare({ patchLive, next }: StepProps) {
  const [os, setOs] = useState<HostPlatform>("win32");
  return (
    <>
      <StepHead title="Set up Slates on your other computer">
        <p>Do this on the computer that will run Slates, not on this Mac. It takes about ten minutes, most of it the first build.</p>
      </StepHead>
      <Body>
        <div className={styles.osTabs} role="group" aria-label="That computer runs">
          {(Object.keys(GUIDE) as HostPlatform[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={os === id}
              onClick={() => {
                setOs(id);
                patchLive({ os: id });
              }}
            >
              {OS_LABEL[id]}
            </button>
          ))}
        </div>
        <ol className={styles.guide}>
          {GUIDE[os].map((step) => (
            <li key={step.title} className={styles.guideStep}>
              <span className={styles.guideTitle}>{step.title}</span>
              {step.body && <p className={styles.guideBody}>{step.body}</p>}
              {step.command && <Command text={step.command} />}
              {step.extra && (
                <details className={styles.extra}>
                  <summary>{step.extra.label}</summary>
                  <Command text={step.extra.command} />
                </details>
              )}
            </li>
          ))}
        </ol>
        <p className={styles.guideBody}>
          <Code>tailscale serve --bg 7528</Code> instead keeps Slates on your tailnet only, but then every device needs Tailscale on. Updating and
          troubleshooting are in <Code>docs/remote-host-setup.md</Code> in the Slates repo.
        </p>
      </Body>
      <Actions sticky note="Already running Slates there? Go straight on.">
        <Primary onClick={next}>It’s running. Connect to it</Primary>
      </Actions>
    </>
  );
}

const HOST_PROBLEM: Record<HostUrlProblem, string> = {
  empty: "Type the address of the computer that runs Slates.",
  invalid: "That isn’t a web address.",
  "not-tailscale": "Slates only connects to a host published with Tailscale, so the address ends in .ts.net.",
};

type HostState = "idle" | "checking" | "slow" | "up" | "down" | "other";

const WIRE: Record<HostState, LinkState> = { idle: "idle", checking: "checking", slow: "slow", up: "up", down: "down", other: "down" };

export function Host({ env, answers, update, patchLive, next }: StepProps) {
  const [value, setValue] = useState(answers.host?.url ?? env.prefill?.hostUrl ?? "");
  const [state, setState] = useState<HostState>(answers.host ? "up" : "idle");
  const [host, setHost] = useState<HostInfo | null>(answers.host);
  const [name, setName] = useState(answers.host?.name ?? "");
  const [problem, setProblem] = useState<HostUrlProblem | null>(null);
  const attempts = useAttempts();

  const show = useCallback(
    (next: HostState, hostName?: string) => {
      setState(next);
      patchLive({ link: WIRE[next], ...(hostName ? { hostName } : {}) });
    },
    [patchLive]
  );

  const connect = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "up" && host) return next();
    const parsed = normalizeHostUrl(value);
    if (!parsed.ok) return setProblem(parsed.problem);
    setProblem(null);
    setValue(parsed.url);
    setName(parsed.name);
    show("checking", parsed.name);
    try {
      const result = await env.checkHost(parsed.url, { signal: attempts.start(), onSlow: () => show("slow") });
      if (!result.ok) return show(result.problem === "not-slates" ? "other" : "down");
      const changed = answers.host?.url !== result.host.url;
      setHost(result.host);
      update({ host: result.host, ...(changed ? { paired: null, schoology: null, sync: null } : {}) });
      show("up", result.host.name);
    } catch (error) {
      if (!isAbort(error)) show("down");
    }
  };

  const busy = state === "checking" || state === "slow";

  return (
    <form onSubmit={connect} noValidate>
      <StepHead title="Connect to your host">
        <p>
          Type the address <Code>tailscale funnel</Code> printed on the computer that runs Slates. It ends in <strong>.ts.net</strong>.
        </p>
      </StepHead>
      <Body>
        <Field id="host-url" label="Host address" hint="Only Tailscale addresses work, because only Tailscale tells Slates who you are." error={problem && HOST_PROBLEM[problem]}>
          <input
            id="host-url"
            className={`input input--lg ${styles.input}`}
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setProblem(null);
              if (state !== "idle") show("idle");
            }}
            placeholder="gaming-pc.tail1234.ts.net"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            disabled={busy}
            aria-invalid={problem ? true : undefined}
            aria-describedby="host-url-note"
          />
        </Field>
        {state === "checking" && <Status tone="busy">Reaching {name}…</Status>}
        {state === "slow" && <Status tone="warn">Still reaching {name}. It has to be awake and on your tailnet.</Status>}
        {state === "up" && host && (
          <Status tone="good">
            Connected to {host.name}, a {PLATFORM[host.platform]} running Slates.
          </Status>
        )}
        {state === "down" && (
          <Status tone="bad">
            Couldn’t reach {name}. Check that:
            <ul className={styles.checklist}>
              <li>it’s awake, and Tailscale is running on it</li>
              <li>
                <Code>tailscale funnel</Code> still publishes Slates there
              </li>
              <li>this Mac is online</li>
            </ul>
          </Status>
        )}
        {state === "other" && (
          <Status tone="bad">
            Something answered at that address, but it isn’t Slates. Check the address, and that <Code>slates host</Code> is running there.
          </Status>
        )}
      </Body>
      <Actions>
        {busy ? (
          <>
            <Primary busy disabled>
              Connecting
            </Primary>
            <Quiet
              onClick={() => {
                attempts.cancel();
                show("idle");
              }}
            >
              Cancel
            </Quiet>
          </>
        ) : (
          <Primary type="submit">{state === "up" ? "Continue" : state === "down" || state === "other" ? "Try again" : "Connect"}</Primary>
        )}
      </Actions>
    </form>
  );
}

const PAIR_PROBLEM: Record<Exclude<PairProblem, "needs-code">, string> = {
  wrong: "That code isn’t right. Check it and try again.",
  expired: "That code has run out. Get a new one on the paired device.",
  "too-many": "That was the fifth wrong try, so the code is spent. Get a new one on the paired device.",
};

export function Pair({ env, answers, update, patchLive, next }: StepProps) {
  const host = answers.host;
  const [state, setState] = useState<PairState>(answers.paired ? "paired" : "asking");
  const [via, setVia] = useState(answers.paired);
  const [code, setCode] = useState(env.prefill?.code ?? "");
  const [problem, setProblem] = useState<Exclude<PairProblem, "needs-code"> | null>(null);
  const [round, setRound] = useState(answers.paired ? 0 : 1);
  const [opening, setOpening] = useState(false);
  const attempts = useAttempts();

  const show = useCallback(
    (next: PairState) => {
      setState(next);
      patchLive({ pair: next });
    },
    [patchLive]
  );

  useEffect(() => {
    if (!host || round === 0) return;
    const ask = new AbortController();
    env.pair(host, null, ask.signal).then(
      (result) => {
        if (!result.ok) return show("needs-code");
        setVia(result.via);
        update({ paired: result.via });
        show("paired");
      },
      (error) => {
        if (!isAbort(error)) show("needs-code");
      }
    );
    return () => ask.abort();
  }, [env, host, round, update, show]);

  if (!host) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "paired") {
      setOpening(true);
      await env.connect({ runsOn: "host", host });
      return next();
    }
    if (pairingDigits(code).length !== 8) return;
    setProblem(null);
    show("pairing");
    try {
      const result = await env.pair(host, pairingDigits(code), attempts.start());
      if (result.ok) {
        setVia(result.via);
        update({ paired: result.via });
        return show("paired");
      }
      if (result.problem !== "needs-code") setProblem(result.problem);
      if (result.problem === "expired" || result.problem === "too-many") setCode("");
      show("needs-code");
    } catch (error) {
      if (!isAbort(error)) show("needs-code");
    }
  };

  const paired = state === "paired";

  return (
    <form onSubmit={submit} noValidate>
      <StepHead title={paired ? "This Mac is paired" : "Pair this Mac"}>
        {state === "asking" && <p>Asking {host.name} whether it already knows this Mac.</p>}
        {(state === "needs-code" || state === "pairing") && (
          <p>
            On a device that’s already paired, open <strong>Settings › General › Devices</strong> and choose <strong>Get a code</strong>. Type it here.
          </p>
        )}
        {paired && via === "tailscale" && (
          <p>Tailscale vouched for you, so {host.name} gave this Mac a key of its own. It keeps working with Tailscale off.</p>
        )}
        {paired && via === "code" && <p>{host.name} gave this Mac a key of its own, so it gets in from anywhere, with Tailscale or without.</p>}
      </StepHead>
      <Body>
        {state === "asking" && <Status tone="busy">Checking with {host.name}…</Status>}
        {(state === "needs-code" || state === "pairing") && (
          <Field id="pair-code" label="Pairing code" hint="A code lasts 10 minutes and pairs one device." error={problem && PAIR_PROBLEM[problem]}>
            <input
              id="pair-code"
              className={`input input--lg ${styles.input} ${styles.codeInput}`}
              value={formatPairingCode(code)}
              onChange={(event) => {
                setCode(event.target.value);
                setProblem(null);
              }}
              placeholder="1234 5678"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              disabled={state === "pairing"}
              aria-invalid={problem ? true : undefined}
              aria-describedby="pair-code-note"
            />
          </Field>
        )}
        {paired && <Status tone="good">Paired with {host.name}{via === "tailscale" ? " through Tailscale" : " with a code"}.</Status>}
      </Body>
      <Actions
        note={
          paired ? (
            `Next, this window switches over to ${host.name}.`
          ) : state === "needs-code" ? (
            <>
              Or turn on Tailscale on this Mac and{" "}
              <button
                type="button"
                className={styles.inline}
                onClick={() => {
                  show("asking");
                  setRound((r) => r + 1);
                }}
              >
                try again
              </button>
              .
            </>
          ) : undefined
        }
      >
        {paired ? (
          <Primary type="submit" busy={opening}>
            Continue
          </Primary>
        ) : (
          <Primary type="submit" busy={state === "pairing"} disabled={state === "asking" || pairingDigits(code).length !== 8}>
            Pair
          </Primary>
        )}
      </Actions>
    </form>
  );
}

const SIGN_IN_PROBLEM: Record<Exclude<SignInProblem, "no-service">, string> = {
  idle: "Sign-in closed after five minutes with nobody on it.",
  expired: "Sign-in closes after 15 minutes, and this one ran out.",
  replaced: "Sign-in was opened somewhere else, so this one closed.",
};

const DOMAIN_PROBLEM = {
  empty: "Type your school’s Schoology address.",
  invalid: "That doesn’t look like a Schoology address. It usually ends in .schoology.com.",
};

function signedInOn(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function Schoology({ env, answers, update, patchLive, next, overlay }: StepProps) {
  const host = answers.runsOn === "host" ? answers.host : null;
  const [state, setState] = useState<SignInState>(answers.schoology ? "done" : "checking");
  const [session, setSession] = useState(answers.schoology);
  const [domain, setDomain] = useState(answers.schoology?.domain ?? env.prefill?.domain ?? "");
  const [problem, setProblem] = useState<SignInProblem | null>(null);
  const [domainProblem, setDomainProblem] = useState<keyof typeof DOMAIN_PROBLEM | null>(null);
  const [lookForSession] = useState(!answers.schoology);
  const [justSignedIn, setJustSignedIn] = useState(false);
  const attempts = useAttempts();

  const show = useCallback(
    (next: SignInState, shownDomain?: string) => {
      setState(next);
      patchLive({ signIn: next, ...(shownDomain ? { domain: shownDomain } : {}) });
    },
    [patchLive]
  );

  useEffect(() => {
    if (!lookForSession) return;
    const check = new AbortController();
    env.schoologySession(check.signal).then(
      (found) => {
        if (!found) return show("idle");
        setSession(found);
        setDomain(found.domain);
        update({ schoology: found });
        show("done", found.domain);
      },
      (error) => {
        if (!isAbort(error)) show("idle");
      }
    );
    return () => check.abort();
  }, [env, lookForSession, update, show]);

  const signIn = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "done") return next();
    const parsed = normalizeSchoologyDomain(domain);
    if (!parsed.ok) return setDomainProblem(parsed.problem);
    setDomain(parsed.domain);
    setDomainProblem(null);
    setProblem(null);
    show("waiting", parsed.domain);
    try {
      const result = await env.signIn(parsed.domain, attempts.start());
      if (!result.ok) {
        setProblem(result.problem);
        return show("failed");
      }
      setSession(result.session);
      setJustSignedIn(true);
      update({ schoology: result.session, sync: null });
      show("done");
    } catch (error) {
      if (!isAbort(error)) {
        setProblem("no-service");
        show("failed");
      }
    }
  };

  const cancel = () => {
    attempts.cancel();
    show("idle");
  };

  const where = host ? host.name : "this Mac";
  const Surface = env.SignInSurface;

  if (state === "checking") {
    return (
      <>
        <StepHead title="Sign in to Schoology">
          <p>{host ? `Checking whether ${host.name} is already signed in.` : "Checking for a Schoology session on this Mac."}</p>
        </StepHead>
        <Body>
          <Status tone="busy">Looking for a session…</Status>
        </Body>
      </>
    );
  }

  if (state === "done" && session) {
    return (
      <form onSubmit={signIn}>
        <StepHead title="Schoology is connected">
          {justSignedIn ? (
            <p>
              Signed in to <strong>{session.domain}</strong>. The session stays in the browser that syncs{host ? ` on ${host.name}` : ""}, apart from your
              everyday one.
            </p>
          ) : (
            <p>
              {host ? host.name : "This Mac"} is already signed in to <strong>{session.domain}</strong>, so there’s nothing to do here.
            </p>
          )}
        </StepHead>
        <Body>
          <Status tone="good">
            Signed in on {where} since {signedInOn(session.signedInAt)}.
          </Status>
        </Body>
        <Actions>
          <Primary type="submit">Continue</Primary>
          <Quiet
            onClick={() => {
              setSession(null);
              show("idle");
            }}
          >
            Use another account
          </Quiet>
        </Actions>
      </form>
    );
  }

  const waiting = state === "waiting";

  return (
    <form onSubmit={signIn} noValidate>
      <StepHead title={waiting ? "Finish signing in" : "Sign in to Schoology"}>
        {waiting ? (
          <p>Sign in on the Schoology page over this window. It closes by itself once your home page loads, and setup carries on from here.</p>
        ) : (
          <p>
            Schoology opens right here, in the browser that syncs{host ? ` on ${host.name}` : ""}. Sign in the way you always do, Google and SSO
            included. What you type goes to that browser and on to Schoology, and Slates doesn’t keep it.
          </p>
        )}
      </StepHead>
      <Body>
        <Field id="schoology-domain" label="Your school’s Schoology address" hint="The address you open Schoology at." error={domainProblem && DOMAIN_PROBLEM[domainProblem]}>
          <input
            id="schoology-domain"
            className={`input input--lg ${styles.input}`}
            value={domain}
            onChange={(event) => {
              setDomain(event.target.value);
              setDomainProblem(null);
            }}
            placeholder="yourschool.schoology.com"
            inputMode="url"
            autoComplete="url"
            autoCapitalize="none"
            spellCheck={false}
            disabled={waiting}
            aria-invalid={domainProblem ? true : undefined}
            aria-describedby="schoology-domain-note"
          />
        </Field>
        {waiting && <Status tone="busy">Waiting for {domain}…</Status>}
        {state === "failed" && problem && (
          <Status tone="bad">
            {problem === "no-service" ? (
              <>
                The sync service isn’t running on {where}, so there’s no browser to sign in with.
                {host ? (
                  <>
                    {" "}
                    Check that <Code>slates host</Code> is running there.
                  </>
                ) : (
                  " It usually comes back by itself within a few seconds."
                )}
              </>
            ) : (
              SIGN_IN_PROBLEM[problem]
            )}
          </Status>
        )}
      </Body>
      <Actions>
        {waiting ? (
          <Quiet onClick={cancel}>Cancel</Quiet>
        ) : (
          <Primary type="submit">{state === "failed" ? "Open it again" : "Sign in to Schoology"}</Primary>
        )}
      </Actions>
      {waiting && Surface && overlay && createPortal(<Surface domain={domain} hostName={host?.name ?? null} onCancel={cancel} />, overlay)}
    </form>
  );
}

const SYNC_PROBLEM: Record<SyncProblem, string> = {
  "signed-out": "Schoology signed you out",
  empty: "No classes yet",
  "service-down": "The sync service isn’t answering",
};

function Stat({ value, label }: { value: number | null; label: string }) {
  return (
    <div className={styles.stat}>
      <motion.span
        key={value ?? "none"}
        className={styles.statValue}
        initial={{ opacity: 0.35, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE }}
      >
        {value ?? "–"}
      </motion.span>
      <span className={styles.statLabel}>{label}</span>
    </div>
  );
}

export function Sync({ env, answers, update, patchLive, next, goTo, finish }: StepProps) {
  const host = answers.runsOn === "host" ? answers.host : null;
  const [progress, setProgress] = useState<SyncProgress | null>(null);
  const [problem, setProblem] = useState<SyncProblem | null>(null);
  const [round, setRound] = useState(answers.sync ? 0 : 1);
  const summary = answers.sync;

  useEffect(() => {
    if (round === 0) return;
    const sync = new AbortController();
    env
      .sync((p) => {
        setProgress(p);
        patchLive({ sync: p, syncFailed: false });
      }, sync.signal)
      .then(
        (result) => {
          if (!result.ok) {
            setProblem(result.problem);
            return patchLive({ syncFailed: true });
          }
          update((current) => ({ sync: result.summary, name: current.name || firstName(result.summary.studentName ?? "") }));
        },
        (error) => {
          if (isAbort(error)) return;
          setProblem("service-down");
          patchLive({ syncFailed: true });
        }
      );
    return () => sync.abort();
  }, [env, round, update, patchLive]);

  const again = () => {
    setProblem(null);
    setProgress(null);
    setRound((r) => r + 1);
  };

  if (summary) {
    return (
      <>
        <StepHead title="Your board is ready">
          <p>
            {summary.courses} classes and {summary.items} assignments, with {summary.dueThisWeek} due this week. Slates keeps them in sync from here on.
          </p>
        </StepHead>
        <Body>
          <div className={styles.stats}>
            <Stat value={summary.courses} label="Classes" />
            <Stat value={summary.items} label="Assignments" />
            <Stat value={summary.dueThisWeek} label="Due this week" />
          </div>
        </Body>
        <Actions>
          <Primary onClick={next}>Continue</Primary>
          <Quiet onClick={() => finish("done", "school")}>Skip to my board</Quiet>
        </Actions>
      </>
    );
  }

  if (problem) {
    return (
      <>
        <StepHead title={SYNC_PROBLEM[problem]}>
          {problem === "signed-out" && <p>The session ended partway through, so the board isn’t complete. Sign in again and Slates picks up where it stopped.</p>}
          {problem === "empty" && <p>Slates read your Schoology home page but found no classes on it. New enrollments can take a day to appear.</p>}
          {problem === "service-down" &&
            (host ? (
              <p>
                The sync service on {host.name} didn’t answer. Check that <Code>slates host</Code> is still running there.
              </p>
            ) : (
              <p>The sync service on this Mac didn’t answer. It usually comes back by itself within a few seconds.</p>
            ))}
        </StepHead>
        {progress && progress.courses > 0 && (
          <Body>
            <div className={styles.stats}>
              <Stat value={progress.courses} label="Classes read" />
              <Stat value={progress.items} label="Assignments" />
              <Stat value={progress.dated} label="Still to do" />
            </div>
          </Body>
        )}
        <Actions>
          {problem === "signed-out" ? (
            <Primary
              onClick={() => {
                update({ schoology: null, sync: null });
                goTo("schoology");
              }}
            >
              Sign in again
            </Primary>
          ) : (
            <Primary onClick={again}>{problem === "empty" ? "Sync again" : "Try again"}</Primary>
          )}
          {problem === "empty" && <Quiet onClick={next}>Continue anyway</Quiet>}
        </Actions>
      </>
    );
  }

  return (
    <>
      <StepHead title="Reading your classes">
        <p>Slates reads your Schoology home page, then each class on it. The first sync takes a minute or so.</p>
      </StepHead>
      <Body>
        <div className={styles.stats}>
          <Stat value={progress?.courses ?? null} label="Classes" />
          <Stat value={progress?.items ?? null} label="Assignments" />
          <Stat value={progress?.dated ?? null} label="Still to do" />
        </div>
        <Status tone="busy">{progress?.course ? `Reading ${progress.course}…` : "Reading your home page…"}</Status>
      </Body>
    </>
  );
}
