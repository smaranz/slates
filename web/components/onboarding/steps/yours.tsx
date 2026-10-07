"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";

import { AnthropicLogo, Avatar, CursorLogo, DeepSeekLogo, ElevenLabsLogo, Icon, ICON, OpenAILogo, QwenLogo, Spinner } from "@/components/ui";
import { APPS } from "@/lib/app-prefs";
import { readAvatarFile } from "@/lib/avatar";
import type { Mode } from "@/lib/mode";
import { isAbort, PROVIDER_ROOMS, providersFor } from "@/lib/onboarding/flow";
import type { Answers, ProviderId, ProviderState, ProviderTest } from "@/lib/onboarding/types";

import styles from "../onboarding.module.css";
import { Actions, Body, Code, EASE, Field, Primary, Quiet, Small, Status, StepHead, useAttempts } from "../parts";
import type { StepProps } from "../step";
import { ROOM_ACCENT, RoomMark } from "../visuals";

const LIST = new Intl.ListFormat("en", { style: "long", type: "conjunction" });

const TITLE = Object.fromEntries(APPS.map((app) => [app.mode, app.title])) as Record<Mode, string>;

export function Profile({ env, answers, update, next }: StepProps) {
  const fromSchoology = answers.sync?.studentName ?? null;
  const helpers = [
    answers.rooms.includes("school") && "the tutor",
    answers.rooms.includes("counselor") && "the counselor",
    answers.rooms.includes("agent") && "your agents",
  ].filter((helper): helper is string => !!helper);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const go = (event: FormEvent) => {
    event.preventDefault();
    const name = answers.name.trim();
    update({ name });
    env.saveProfile({ name, avatar: answers.avatar });
    next();
  };

  const uses = helpers.length
    ? `Slates shows it across your rooms, and ${LIST.format(helpers)} ${helpers.length === 1 && helpers[0] !== "your agents" ? "calls" : "call"} you by it.`
    : "Slates shows it across your rooms.";

  return (
    <form onSubmit={go}>
      <StepHead title="What should Slates call you?">
        {fromSchoology ? (
          <p>
            Schoology has you as <strong>{fromSchoology}</strong>. {uses}
          </p>
        ) : (
          <p>{uses}</p>
        )}
      </StepHead>
      <Body>
        <div className={styles.profile}>
          <div className={styles.photo}>
            <button
              type="button"
              className="pfp-btn"
              onClick={() => file.current?.click()}
              aria-label={answers.avatar ? "Change photo" : "Add a photo"}
              disabled={reading}
            >
              <Avatar src={answers.avatar} name={answers.name || "S"} size={72} />
              <span className="pfp-overlay">{reading ? "…" : answers.avatar ? "Change" : "Add"}</span>
            </button>
            {answers.avatar && (
              <button type="button" className={styles.photoRemove} onClick={() => update({ avatar: null })}>
                Remove
              </button>
            )}
            <input
              ref={file}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const picked = event.target.files?.[0];
                event.target.value = "";
                if (!picked) return;
                setPhotoError(null);
                setReading(true);
                readAvatarFile(picked)
                  .then((avatar) => update({ avatar }))
                  .catch((error: unknown) => setPhotoError(error instanceof Error ? error.message : "Couldn’t read that photo."))
                  .finally(() => setReading(false));
              }}
            />
          </div>
          <Field id="profile-name" label="Name" hint="Your name and photo stay on this device." error={photoError}>
            <input
              id="profile-name"
              className={`input input--lg ${styles.input}`}
              value={answers.name}
              onChange={(event) => update({ name: event.target.value })}
              placeholder="What you go by"
              autoComplete="given-name"
              aria-describedby="profile-name-note"
            />
          </Field>
        </div>
      </Body>
      <Actions>
        <Primary type="submit">Continue</Primary>
      </Actions>
    </form>
  );
}

const PROVIDERS: { id: ProviderId; label: string; powers: string; logo: ReactNode; command?: string }[] = [
  { id: "claude-code", label: "Claude Code", powers: "Claude Sonnet 5, Haiku 4.5 and Opus 5.5", logo: <AnthropicLogo size={15} />, command: "claude auth login" },
  { id: "cursor-agent", label: "Cursor", powers: "Grok 4.7 and Composer 2.5", logo: <CursorLogo size={15} />, command: "npm --prefix web run cursor:login" },
  { id: "openai", label: "OpenAI", powers: "GPT-5.6", logo: <OpenAILogo size={15} /> },
  {
    id: "openrouter",
    label: "OpenRouter",
    powers: "DeepSeek, GLM, Qwen, Gemini and MiniMax",
    logo: (
      <span style={{ display: "flex", gap: 2 }}>
        <DeepSeekLogo size={11} />
        <QwenLogo size={11} />
      </span>
    ),
  },
  { id: "elevenlabs", label: "ElevenLabs", powers: "Voice, sound and music", logo: <ElevenLabsLogo size={14} /> },
];

type TestState = "testing" | ProviderTest;

export function Ai({ env, answers, update, patchLive, next }: StepProps) {
  const host = answers.runsOn === "host" ? answers.host : null;
  const where = host ? host.name : "this Mac";
  const used = providersFor(answers.rooms);
  const shown = PROVIDERS.filter((provider) => used.includes(provider.id));
  const [list, setList] = useState<ProviderState[] | null>(answers.providers);
  const [round, setRound] = useState(answers.providers ? 0 : 1);
  const [checking, setChecking] = useState(!answers.providers);
  const [open, setOpen] = useState<ProviderId | null>(null);
  const [key, setKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [tests, setTests] = useState<Partial<Record<ProviderId, TestState>>>({});
  const testing = useAttempts();

  useEffect(() => {
    if (round === 0) return;
    const read = new AbortController();
    env.providers(read.signal).then(
      (found) => {
        setList(found);
        setChecking(false);
        update({ providers: found });
        patchLive({ providers: found });
      },
      (error) => {
        if (!isAbort(error)) setChecking(false);
      }
    );
    return () => read.abort();
  }, [env, round, update, patchLive]);

  const recheck = () => {
    setChecking(true);
    setRound((r) => r + 1);
  };

  const save = async (id: ProviderId) => {
    if (!key.trim()) return;
    setSaving(true);
    await env.saveKey(id, key.trim());
    setSaving(false);
    setKey("");
    setOpen(null);
    recheck();
  };

  const test = async (id: ProviderId) => {
    setTests((t) => ({ ...t, [id]: "testing" }));
    try {
      const result = await env.testProvider(id, testing.start());
      setTests((t) => ({ ...t, [id]: result }));
    } catch (error) {
      if (!isAbort(error)) setTests((t) => ({ ...t, [id]: { ok: false, error: "The test didn’t finish." } }));
    }
  };

  const readyCount = shown.filter((provider) => list?.some((p) => p.id === provider.id && p.ready)).length;

  return (
    <>
      <StepHead title="Connect your AI">
        <p>Your rooms run on AI you already have. Slates checked {where} for each one they use, and every one is optional.</p>
      </StepHead>
      <Body>
        <div className={styles.rows}>
          {shown.map((provider) => {
            const ready = list?.find((p) => p.id === provider.id)?.ready ?? false;
            const result = tests[provider.id];
            const expanded = open === provider.id;
            const forRooms = PROVIDER_ROOMS[provider.id].filter((room) => answers.rooms.includes(room)).map((room) => TITLE[room]);
            return (
              <div key={provider.id} className={styles.row}>
                <div className={styles.rowMain}>
                  <span className={styles.rowIcon}>{provider.logo}</span>
                  <span className={styles.rowText}>
                    <span className={styles.rowTitle}>{provider.label}</span>
                    <span className={styles.rowSub}>
                      For {LIST.format(forRooms)} · {provider.powers}
                    </span>
                  </span>
                  <span
                    className={styles.rowState}
                    data-tone={result && result !== "testing" ? (result.ok ? "good" : "bad") : ready ? "good" : undefined}
                  >
                    {checking ? (
                      <>
                        <Spinner size={11} />
                        Checking
                      </>
                    ) : result === "testing" ? (
                      <>
                        <Spinner size={11} />
                        Testing
                      </>
                    ) : result && !result.ok ? (
                      "Failed"
                    ) : result?.ok ? (
                      <>
                        <Icon path={ICON.check} size={13} />
                        Works
                      </>
                    ) : ready ? (
                      "Ready"
                    ) : (
                      "Not set up"
                    )}
                  </span>
                  {!checking &&
                    (ready ? (
                      <Small onClick={() => void test(provider.id)} disabled={result === "testing"}>
                        Test
                      </Small>
                    ) : (
                      <Small
                        aria-expanded={expanded}
                        onClick={() => {
                          setOpen(expanded ? null : provider.id);
                          setKey("");
                        }}
                      >
                        {expanded ? "Close" : provider.command ? "How" : "Add key"}
                      </Small>
                    ))}
                </div>
                <AnimatePresence initial={false}>
                  {(expanded || (result && result !== "testing" && !result.ok)) && (
                    <motion.div
                      key="more"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.28, ease: EASE }}
                      style={{ overflow: "hidden" }}
                    >
                      <div className={styles.rowMore}>
                        {result && result !== "testing" && !result.ok && <p style={{ color: "var(--bad)" }}>{result.error}</p>}
                        {expanded && provider.command && (
                          <p>
                            Run <Code>{provider.command}</Code> {provider.id === "cursor-agent" ? "in the Slates folder " : ""}on {where}, then check again.
                          </p>
                        )}
                        {expanded && !provider.command && (
                          <>
                            <div className={styles.keyRow}>
                              <input
                                className={`input ${styles.input}`}
                                type="password"
                                value={key}
                                onChange={(event) => setKey(event.target.value)}
                                placeholder={`Paste your ${provider.label} API key`}
                                aria-label={`${provider.label} API key`}
                                autoComplete="off"
                                spellCheck={false}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter") {
                                    event.preventDefault();
                                    void save(provider.id);
                                  }
                                }}
                              />
                              <Small onClick={() => void save(provider.id)} disabled={!key.trim() || saving}>
                                {saving ? "Saving" : "Save"}
                              </Small>
                            </div>
                            <p style={{ color: "var(--muted)" }}>It’s kept in AI Usage on {where} and works straight away.</p>
                          </>
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            );
          })}
        </div>
      </Body>
      <Actions note={list ? `${readyCount} of ${shown.length} ready.` : undefined}>
        <Primary onClick={next}>Continue</Primary>
        <Quiet onClick={recheck} disabled={checking}>
          Check again
        </Quiet>
      </Actions>
    </>
  );
}

export function Notify({ env, answers, update, patchLive, next }: StepProps) {
  const [state, setState] = useState<"idle" | "asking" | "granted" | "denied">(
    answers.notifications === "granted" || answers.notifications === "denied" ? answers.notifications : "idle"
  );

  const ask = async () => {
    setState("asking");
    patchLive({ notify: "asking" });
    const result = await env.requestNotifications();
    setState(result);
    patchLive({ notify: result });
    update({ notifications: result });
  };

  return (
    <>
      <StepHead title="Hear when an agent sends you something">
        <p>When one of your agents makes a file for you, Slates saves it to Downloads › Slates and tells you it’s there. macOS asks for permission once.</p>
      </StepHead>
      {(state === "granted" || state === "denied") && (
        <Body>
          {state === "granted" ? (
            <Status tone="good">Notifications are on.</Status>
          ) : (
            <Status tone="warn">macOS has notifications off for Slates. You can turn them on in System Settings › Notifications.</Status>
          )}
        </Body>
      )}
      <Actions>
        {state === "granted" || state === "denied" ? (
          <Primary onClick={next}>Continue</Primary>
        ) : (
          <>
            <Primary onClick={() => void ask()} busy={state === "asking"}>
              {state === "asking" ? "Waiting for macOS" : "Turn on notifications"}
            </Primary>
            <Quiet
              disabled={state === "asking"}
              onClick={() => {
                update({ notifications: "later" });
                next();
              }}
            >
              Not now
            </Quiet>
          </>
        )}
      </Actions>
    </>
  );
}

const START: Record<Mode, (answers: Answers) => string> = {
  school: (answers) =>
    answers.sync ? `${answers.sync.courses} classes on your board, ${answers.sync.dueThisWeek} due this week` : "Your board, grades and tutor",
  counselor: () => "Tell the counselor where you’re applying",
  ui: () => "Search 1,300 components and copy one in",
  usage: () => "Every coding tool and account on this Mac",
  media: () => "Make an image, a voice or a song",
  agent: () => "Give an agent its first job",
  health: () => "Scan your next meal",
  day: () => "See what’s on right now",
  vitals: () => "See what’s using this Mac",
};

export function Done({ answers, finish }: StepProps) {
  const name = answers.name.trim();
  const rooms = APPS.filter((app) => answers.rooms.includes(app.mode));
  const used = providersFor(answers.rooms);
  const ready = PROVIDERS.filter((p) => used.includes(p.id) && answers.providers?.some((s) => s.id === p.id && s.ready)).map((p) => p.label);
  const facts: { on: boolean; text: string }[] = [
    { on: true, text: answers.runsOn === "host" && answers.host ? `Runs on ${answers.host.name}` : "Runs on this Mac" },
    ...(answers.rooms.includes("school")
      ? [{ on: !!answers.schoology, text: answers.schoology ? `Signed in to ${answers.schoology.domain}` : "Schoology not connected yet" }]
      : []),
    ...(used.length ? [{ on: ready.length > 0, text: ready.length ? `AI from ${LIST.format(ready)}` : "No AI connected yet" }] : []),
    ...(answers.rooms.includes("agent")
      ? [{ on: answers.notifications === "granted", text: answers.notifications === "granted" ? "Notifications on" : "Notifications off" }]
      : []),
  ];
  const only = rooms.length === 1 ? rooms[0] : null;

  return (
    <>
      <StepHead title={name ? `You’re set, ${name}` : "You’re set"}>
        <p>Start in any room. Everything here can be changed later in Settings.</p>
      </StepHead>
      <Body>
        {rooms.length > 0 && (
          <div className={styles.startList}>
            {rooms.map((room) => (
              <button
                key={room.mode}
                type="button"
                className={styles.startRoom}
                style={{ "--accent": ROOM_ACCENT[room.mode] } as CSSProperties}
                onClick={() => finish("done", room.mode)}
              >
                <RoomMark mode={room.mode} />
                <span className={styles.rowText}>
                  <span className={styles.rowTitle}>{room.title}</span>
                  <span className={styles.rowSub}>{START[room.mode](answers)}</span>
                </span>
                <Icon path={ICON.chevronLeft} size={14} />
              </button>
            ))}
          </div>
        )}
        <ul className={styles.facts}>
          {facts.map((fact) => (
            <li key={fact.text} data-off={!fact.on || undefined}>
              {fact.on && <Icon path={ICON.check} size={12} />}
              {fact.text}
            </li>
          ))}
        </ul>
      </Body>
      <Actions>
        <Primary onClick={() => finish("done", only?.mode ?? null)}>{only ? `Open ${only.title}` : "Open Slates"}</Primary>
      </Actions>
    </>
  );
}
