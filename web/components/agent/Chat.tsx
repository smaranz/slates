"use client";

import Image from "next/image";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AgentGroup, ChatEvent, RosterAgent, Skill } from "@/lib/agent/types";
import { useDictation } from "@/lib/dictation";
import { FileCard, LearnedNote } from "../HostFile";
import TutorMarkdown from "../TutorMarkdown";
import { Icon, ICON, Spinner } from "../ui";
import s from "./agent.module.css";
import { agentApi, readFileAsBase64 } from "./useAgentData";

/**
 * One conversation: the transcript and the composer, in the tutor's
 * ChatGPT-shaped `gpt-*` parts — only the student's turns wear a bubble, an
 * agent's turn is the page, its tool steps fold into one quiet line, and the
 * composer is the rounded box with attach on the left and send on the right.
 */

export function Face({ agent, size = 28 }: { agent: Pick<RosterAgent, "name" | "hue"> & { state?: RosterAgent["state"] }; size?: number }) {
  return (
    <span className={s.face} style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.42 0.09 ${agent.hue})` }} aria-hidden>
      {agent.name.trim()[0]?.toUpperCase() ?? "A"}
      {agent.state === "working" && <i className={s.faceBusy} />}
    </span>
  );
}

type WorkItem = Extract<ChatEvent, { type: "tool" | "thinking" }>;
type AgentPart = Extract<ChatEvent, { type: "agent" | "approval" | "voice" | "question" | "file" | "learned" }> | { type: "work"; id: string; items: WorkItem[] };
type Turn =
  | { kind: "user"; event: Extract<ChatEvent, { type: "user" }> }
  | { kind: "agent"; id: string; agentId: string; parts: AgentPart[] }
  | { kind: "other"; event: Extract<ChatEvent, { type: "handoff" | "notice" }> };

/**
 * Everything an agent does between two of the student's messages is one
 * turn — what it says, the steps it takes between, its drafts and voice
 * memos — the way the tutor shows one reply rather than a feed of fragments.
 */
function turns(events: ChatEvent[]): Turn[] {
  const out: Turn[] = [];
  for (const event of events) {
    if (event.type === "user" || event.type === "handoff" || event.type === "notice") {
      out.push(event.type === "user" ? { kind: "user", event } : { kind: "other", event });
      continue;
    }
    let turn = out.at(-1);
    if (turn?.kind !== "agent" || turn.agentId !== event.agentId) {
      turn = { kind: "agent", id: `turn_${event.id}`, agentId: event.agentId, parts: [] };
      out.push(turn);
    }
    if (event.type === "tool" || event.type === "thinking") {
      const last = turn.parts.at(-1);
      if (last?.type === "work") last.items.push(event);
      else turn.parts.push({ type: "work", id: `work_${event.id}`, items: [event] });
    } else {
      turn.parts.push(event);
    }
  }
  return out;
}

/** The steps between two things an agent says: one dim line, opened if you ask. */
function Work({ items, live }: { items: WorkItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const tools = items.filter((i): i is Extract<WorkItem, { type: "tool" }> => i.type === "tool");
  const running = live && items.some((i) => (i.type === "tool" && i.status === "running") || (i.type === "thinking" && i.streaming));
  const current = tools.findLast((t) => t.status === "running");
  const summary = running
    ? current?.label ?? "Thinking"
    : tools.length ? `Used ${tools.length} ${tools.length === 1 ? "tool" : "tools"}` : "Thought it through";
  return (
    <div className={`tutor-work${open ? " is-open" : ""}`}>
      <button type="button" className="tutor-work-head" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {running ? <Spinner size={11} /> : <Icon path={ICON.check} size={11} />}
        <span className="tutor-work-summary">{summary}</span>
        <Icon path={ICON.chevronDown} size={11} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform .18s" }} />
      </button>
      {open && (
        <div className="tutor-work-body">
          {items.map((item) => item.type === "tool" ? (
            <div key={item.id} className={`tutor-step is-${item.status === "running" && live ? "run" : item.status === "error" ? "fail" : "done"} ${s.step}`}>
              <span className="tutor-step-dot" />
              <span className={s.stepText}>
                <span className="truncate">{item.label}</span>
                {item.detail && <code>{item.detail}</code>}
              </span>
            </div>
          ) : (
            <div key={item.id} className="tutor-reasoning"><p>{item.text.trim().slice(0, 2000)}</p></div>
          ))}
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="gpt-action"
      aria-label={copied ? "Copied" : "Copy"}
      title={copied ? "Copied" : "Copy"}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }}
    >
      <Icon path={copied ? ICON.check : ICON.copy} size={15} />
    </button>
  );
}

function Voice({ event, autoplay }: { event: Extract<ChatEvent, { type: "voice" }>; autoplay: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [showText, setShowText] = useState(false);
  useEffect(() => {
    if (autoplay) void audio.current?.play().catch(() => {});
  }, [autoplay]);
  return (
    <div className={s.voice}>
      <audio ref={audio} src={`/api/agent/file?name=${encodeURIComponent(event.file)}`} preload="none" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
      <button type="button" className={s.voicePlay} aria-label={playing ? "Pause voice memo" : "Play voice memo"} onClick={() => (playing ? audio.current?.pause() : void audio.current?.play())}>
        <Icon path={playing ? ICON.stop : ICON.play} size={13} />
      </button>
      <span className={s.voiceBars} aria-hidden>{Array.from({ length: 18 }, (_, i) => <i key={i} style={{ height: `${30 + ((i * 37) % 70)}%` }} className={playing ? s.voiceBarOn : undefined} />)}</span>
      <button type="button" className={s.linkButton} onClick={() => setShowText((v) => !v)}>{showText ? "Hide" : "Transcript"}</button>
      {showText && <p className={s.voiceText}>{event.transcript}</p>}
    </div>
  );
}

function Draft({ chatId, event }: { chatId: string; event: Extract<ChatEvent, { type: "approval" }> }) {
  const [body, setBody] = useState(event.action.body);
  const [subject, setSubject] = useState(event.action.kind === "message" ? event.action.subject : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const editable = event.status === "pending" || event.status === "failed";
  const decide = async (decision: "send" | "discard") => {
    setBusy(true);
    setError(null);
    try {
      await agentApi("/api/agent/approval", { chatId, eventId: event.id, decision, body, subject });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  const to = event.action.kind === "message" ? event.action.recipients.map((r) => r.name).join(", ") : event.action.subject ?? `thread ${event.action.threadId}`;
  return (
    <div className={s.draft}>
      <div className={s.draftHead}>
        <span className={s.draftKind}>{event.action.kind === "message" ? "Message" : "Reply"} draft</span>
        <span className={s.draftTo}>{event.action.kind === "message" ? `To ${to}` : `Re: ${to}`}</span>
      </div>
      {event.action.kind === "message" && (
        <input className={s.draftSubject} value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable || busy} aria-label="Subject" />
      )}
      <textarea className={s.draftBody} value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable || busy} rows={Math.min(10, Math.max(3, body.split("\n").length + 1))} aria-label="Message" />
      {editable ? (
        <div className={s.draftActions}>
          <button type="button" className={s.primary} disabled={busy || !body.trim()} onClick={() => void decide("send")}>{busy ? <Spinner size={12} /> : null} Send</button>
          <button type="button" className={s.quiet} disabled={busy} onClick={() => void decide("discard")}>Discard</button>
          {event.status === "failed" && <span className={s.bad}>{event.result}</span>}
          {error && <span className={s.bad}>{error}</span>}
        </div>
      ) : (
        <p className={event.status === "sent" ? s.good : s.muted}>
          {event.status === "sending" ? "Sending…" : event.status === "sent" ? event.result ?? "Sent." : "Discarded."}
        </p>
      )}
    </div>
  );
}

interface Pending {
  name: string;
  type: string;
  size: number;
  file: File;
}

export default function Chat({
  chatId, events, loading, agents, group, skills, talk, onTalk,
}: {
  chatId: string;
  events: ChatEvent[];
  loading: boolean;
  agents: RosterAgent[];
  group: AgentGroup | null;
  skills: Skill[];
  talk: boolean;
  onTalk: (on: boolean) => void;
}) {
  const [draft, setDraft] = useState("");
  const [files, setFiles] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuIndex, setMenuIndex] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const pinned = useRef(true);
  // Only voice memos that arrive after talk mode is on play by themselves.
  const [talkSince, setTalkSince] = useState(() => Date.now());

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const members = group ? group.members.map((id) => byId.get(id)).filter((a): a is RosterAgent => !!a) : [byId.get(chatId)].filter((a): a is RosterAgent => !!a);
  const working = members.some((m) => m.state !== "idle");
  const thread = useMemo(() => turns(events), [events]);
  const autoVoice = talk ? events.findLast((e) => e.type === "voice" && e.at > talkSince)?.id ?? null : null;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [events, loading]);

  const trigger = /(^|\s)([/@])([\w-]*)$/.exec(draft);
  const menu = useMemo(() => {
    if (!trigger) return [];
    const query = trigger[3]!.toLowerCase();
    if (trigger[2] === "/") return skills.filter((k) => k.name.toLowerCase().includes(query)).slice(0, 6).map((k) => ({ key: k.id, label: `/${k.name}`, insert: `/${k.name} ` }));
    return (group ? members : agents).filter((a) => a.name.toLowerCase().startsWith(query)).slice(0, 6).map((a) => ({ key: a.id, label: `@${a.name}`, insert: `@${a.name} ` }));
  }, [trigger, skills, group, members, agents]);

  const choose = (insert: string) => {
    if (!trigger) return;
    setDraft(draft.slice(0, draft.length - trigger[2]!.length - trigger[3]!.length) + insert);
    setMenuIndex(0);
    input.current?.focus();
  };

  const send = async (text = draft) => {
    const body = text.trim();
    if ((!body && !files.length) || sending) return;
    setSending(true);
    setError(null);
    try {
      const attachments = await Promise.all(files.map(async (f) => ({ name: f.name, type: f.type, data: await readFileAsBase64(f.file) })));
      await agentApi("/api/agent/chat", { chatId, text: body, attachments, speak: talk });
      setDraft("");
      setFiles([]);
      pinned.current = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const dictation = useDictation((text) => {
    if (talk) void send(text);
    else setDraft((current) => (current ? `${current.replace(/\s+$/, "")} ${text}` : text));
  });

  const addFiles = (list: FileList | File[]) => {
    const next = Array.from(list).slice(0, 8).map((file) => ({ name: file.name || "pasted-image.png", type: file.type, size: file.size, file }));
    setFiles((current) => [...current, ...next].slice(0, 8));
  };

  const stopAll = () => void agentApi("/api/agent/chat", { chatId, op: "stop" }).catch(() => {});

  const empty = !loading && !events.length;
  const streaming = events.some((e) => (e.type === "agent" && e.streaming) || (e.type === "tool" && e.status === "running"));
  const single = members.length === 1 ? members[0]! : null;
  // Between steps an agent is still at work; say so at the end of its turn, or on its own line if it hasn't started one.
  const busy = members.filter((m) => m.state !== "idle");
  const lastTurn = thread.at(-1);
  const busyInTurn = working && lastTurn?.kind === "agent" && busy.some((m) => m.id === lastTurn.agentId);
  const busyLine = working && !streaming && (
    <div className="tutor-work">
      <span className="tutor-work-head">
        <Spinner size={11} />
        <span className="tutor-work-summary">{busy.map((m) => m.name).join(", ")} {busy.some((m) => m.state === "working") ? "is working" : "is up next"}</span>
      </span>
    </div>
  );

  return (
    <>
      <div
        className="gpt-thread"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className={`gpt-column${empty || (loading && !events.length) ? " gpt-column--empty" : ""}`}>
          {loading && !events.length && <div className={s.center}><Spinner size={16} /></div>}
          {empty && (
            <div className="gpt-greeting">
              {single ? <Face agent={single} size={44} /> : <div className={s.helloFaces}>{members.map((m) => <Face key={m.id} agent={m} size={34} />)}</div>}
              <h1>{`What should ${single?.name ?? group?.name ?? "they"} work on?`}</h1>
              <p className={s.greetingSub}>{single ? single.job || "Ready when you are." : "Write to the group, or @mention who should take it."}</p>
              {single && (
                <div className="gpt-starters">
                  {STARTERS.map((ask) => (
                    <button key={ask} type="button" className="gpt-starter" onClick={() => void send(ask)}>{ask}</button>
                  ))}
                </div>
              )}
            </div>
          )}

          {thread.map((turn, index) => {
            if (turn.kind === "user") {
              const event = turn.event;
              return (
                <div key={event.id} className="gpt-turn gpt-turn--user">
                  <div className="gpt-bubble">
                    {!!event.images?.length && (
                      <div className="gpt-bubble-files">
                        {event.images.map((name) => (
                          <Image key={name} src={`/api/agent/file?name=${encodeURIComponent(name)}`} alt="Attached image" width={260} height={220} unoptimized className={s.userImage} style={{ width: "auto", height: "auto" }} />
                        ))}
                      </div>
                    )}
                    {event.text !== "(image)" && event.text}
                  </div>
                  {event.text !== "(image)" && <div className="gpt-actions gpt-actions--user"><CopyButton text={event.text} /></div>}
                </div>
              );
            }
            if (turn.kind === "other") {
              const event = turn.event;
              if (event.type === "notice") return <p key={event.id} className={event.tone === "error" ? s.noticeBad : s.notice}>{event.text}</p>;
              return <HandoffLine key={event.id} from={event.from === "tutor" ? "Tutor" : byId.get(event.from)?.name ?? "An agent"} to={byId.get(event.to)?.name ?? "an agent"} text={event.text} />;
            }
            const agent = byId.get(turn.agentId);
            const said = turn.parts.filter((p): p is Extract<AgentPart, { type: "agent" }> => p.type === "agent" && p.text.trim() !== "PASS");
            if (!said.length && turn.parts.every((p) => p.type === "agent")) return null;
            const last = index === thread.length - 1;
            return (
              <div key={turn.id} className="gpt-turn gpt-turn--assistant">
                {group && agent && <div className={s.replyWho}><Face agent={agent} size={20} /><span>{agent.name}</span></div>}
                {turn.parts.map((part) => {
                  switch (part.type) {
                    case "work":
                      return <Work key={part.id} items={part.items} live={last && working} />;
                    case "agent":
                      return part.text.trim() === "PASS" ? null : <div key={part.id} className="gpt-reply"><TutorMarkdown text={part.text} className="prose--chat" /></div>;
                    case "approval":
                      return <Draft key={part.id} chatId={chatId} event={part} />;
                    case "voice":
                      return <Voice key={part.id} event={part} autoplay={autoVoice === part.id} />;
                    case "question":
                      return (
                        <div key={part.id} className={s.question}>
                          <p>{part.question}</p>
                          {part.options.length > 0 && (
                            <div className={s.chips}>{part.options.map((option) => <button key={option} type="button" className={s.chip} onClick={() => void send(option)}>{option}</button>)}</div>
                          )}
                        </div>
                      );
                    case "file":
                      return <FileCard key={part.id} url={`/api/agent/outbox?id=${encodeURIComponent(part.file)}`} name={part.name} size={part.size} note={part.note} />;
                    case "learned":
                      return <LearnedNote key={part.id} items={part.items} />;
                  }
                })}
                {last && busyInTurn && busyLine}
                {said.length > 0 && !(last && busyInTurn) && (
                  <div className="gpt-actions"><CopyButton text={said.map((p) => p.text).join("\n\n")} /></div>
                )}
              </div>
            );
          })}

          {busyLine && !busyInTurn && <div className="gpt-turn gpt-turn--assistant">{busyLine}</div>}
        </div>
      </div>

      <div className="gpt-composer-dock">
        <form
          className="gpt-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
          }}
        >
          {menu.length > 0 && (
            <div className={s.menu} role="listbox">
              {menu.map((item, i) => (
                <button key={item.key} type="button" role="option" aria-selected={i === menuIndex} className={i === menuIndex ? s.menuOn : undefined} onMouseDown={(e) => { e.preventDefault(); choose(item.insert); }}>
                  {item.label}
                </button>
              ))}
            </div>
          )}
          {files.length > 0 && (
            <div className="gpt-composer-files">
              {files.map((f, i) => (
                <span key={`${f.name}-${i}`} className={s.fileChip}>
                  {f.name}
                  <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}><Icon path={ICON.close} size={10} /></button>
                </span>
              ))}
            </div>
          )}
          <textarea
            ref={input}
            className="gpt-input"
            value={draft}
            rows={1}
            autoFocus
            placeholder={talk ? "Talk mode: tap the mic and speak" : group ? `Message ${group.name}` : `Message ${members[0]?.name ?? "agent"}`}
            onChange={(e) => {
              setDraft(e.target.value);
              setMenuIndex(0);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(180, e.currentTarget.scrollHeight)}px`;
            }}
            onPaste={(e) => {
              const images = Array.from(e.clipboardData.files).filter((f) => f.type.startsWith("image/"));
              if (images.length) {
                e.preventDefault();
                addFiles(images);
              }
            }}
            onKeyDown={(e) => {
              if (menu.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
                e.preventDefault();
                setMenuIndex((i) => (i + (e.key === "ArrowDown" ? 1 : menu.length - 1)) % menu.length);
              } else if (menu.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
                e.preventDefault();
                choose(menu[menuIndex]!.insert);
              } else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send();
              }
            }}
            aria-label="Message"
          />
          <div className="gpt-composer-row">
            <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <button type="button" className="gpt-round-btn" aria-label="Add photos or files" title="Add photos or files" onClick={() => picker.current?.click()}>
              <Icon path={ICON.plus} size={17} />
            </button>
            <button type="button" className={`gpt-round-btn ${talk ? s.talkOn : ""}`} aria-pressed={talk} aria-label="Talk mode" title="Talk mode: speak, and hear replies" onClick={() => { if (!talk) setTalkSince(Date.now()); onTalk(!talk); }}>
              <Icon path={ICON.waveform} size={16} />
            </button>
            <span className="gpt-composer-gap" />
            {dictation.available && (
              <button type="button" className={`gpt-round-btn${dictation.recording ? " is-live" : ""}`} aria-label={dictation.transcribing ? "Transcribing" : dictation.recording ? "Stop dictating" : "Dictate"} aria-pressed={dictation.recording} onClick={dictation.toggle} disabled={dictation.transcribing}>
                {dictation.transcribing ? <Spinner size={15} /> : <Icon path={ICON.mic} size={17} />}
              </button>
            )}
            {working && !draft.trim() && !files.length ? (
              <button type="button" className="gpt-send" aria-label="Stop" title="Stop" onClick={stopAll}><Icon path={ICON.stop} size={13} /></button>
            ) : (
              <button type="submit" className="gpt-send" aria-label="Send" title="Send" disabled={sending || (!draft.trim() && !files.length)}>{sending ? <Spinner size={15} /> : <Icon path={ICON.arrowUp} size={19} />}</button>
            )}
          </div>
        </form>
        {(error || dictation.error) && <p className="gpt-error">{error ?? dictation.error}</p>}
      </div>
    </>
  );
}

/** Two ways in that suit any agent; its job line says the rest. */
const STARTERS = ["What can you do?", "What are you working on?"];

function HandoffLine({ from, to, text }: { from: string; to: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={s.handoff} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
      <span><strong>{from}</strong> → <strong>{to}</strong></span>
      <span className={open ? s.handoffFull : s.handoffText}>{text}</span>
    </button>
  );
}
