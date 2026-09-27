"use client";

import Image from "next/image";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { AgentGroup, ChatEvent, RosterAgent, Skill } from "@/lib/agent/types";
import { useDictation } from "@/lib/dictation";
import TutorMarkdown from "../TutorMarkdown";
import { Icon, ICON, Spinner } from "../ui";
import s from "./agent.module.css";
import { agentApi, readFileAsBase64 } from "./useAgentData";

/** One conversation: the transcript and the composer. */

export const CLIP = "M16.5 6.5v9a4.5 4.5 0 1 1-9 0V5a3 3 0 1 1 6 0v10a1.5 1.5 0 1 1-3 0V6.5h-1.5V15a3 3 0 1 0 6 0V5a4.5 4.5 0 1 0-9 0v10.5a6 6 0 1 0 12 0v-9h-1.5z";

export function Face({ agent, size = 28 }: { agent: Pick<RosterAgent, "name" | "hue"> & { state?: RosterAgent["state"] }; size?: number }) {
  return (
    <span className={s.face} style={{ width: size, height: size, fontSize: size * 0.42, background: `oklch(0.42 0.09 ${agent.hue})` }} aria-hidden>
      {agent.name.trim()[0]?.toUpperCase() ?? "A"}
      {agent.state === "working" && <i className={s.faceBusy} />}
    </span>
  );
}

type WorkItem = Extract<ChatEvent, { type: "tool" | "thinking" }>;
type Block =
  | { kind: "event"; event: ChatEvent }
  | { kind: "work"; id: string; agentId: string; items: WorkItem[] };

function blocks(events: ChatEvent[]): Block[] {
  const out: Block[] = [];
  for (const event of events) {
    if (event.type === "tool" || event.type === "thinking") {
      const last = out.at(-1);
      if (last?.kind === "work" && last.agentId === event.agentId) last.items.push(event);
      else out.push({ kind: "work", id: `work_${event.id}`, agentId: event.agentId, items: [event] });
    } else {
      out.push({ kind: "event", event });
    }
  }
  return out;
}

function Work({ items, live }: { items: WorkItem[]; live: boolean }) {
  const [open, setOpen] = useState(false);
  const tools = items.filter((i): i is Extract<WorkItem, { type: "tool" }> => i.type === "tool");
  const running = live && (items.some((i) => (i.type === "tool" && i.status === "running") || (i.type === "thinking" && i.streaming)));
  const latest = [...items].reverse().find((i) => i.type === "tool") as Extract<WorkItem, { type: "tool" }> | undefined;
  const summary = running
    ? latest?.label ?? "Thinking"
    : tools.length ? `${tools.length} step${tools.length === 1 ? "" : "s"}` : "Thought it through";
  return (
    <div className={s.work}>
      <button type="button" className={s.workHead} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {running ? <Spinner size={12} /> : <Icon path={ICON.check} size={12} />}
        <span>{summary}</span>
        <Icon path={ICON.chevronDown} size={11} style={{ transform: open ? "rotate(180deg)" : undefined }} />
      </button>
      {open && (
        <ol className={s.workList}>
          {items.map((item) => item.type === "tool" ? (
            <li key={item.id} className={item.status === "error" ? s.workError : undefined}>
              <span>{item.label}</span>
              {item.detail && <code>{item.detail}</code>}
            </li>
          ) : (
            <li key={item.id} className={s.workThought}>{item.text.trim().slice(0, 2000)}</li>
          ))}
        </ol>
      )}
    </div>
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
  const items = useMemo(() => blocks(events), [events]);
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

  return (
    <div className={s.chat}>
      <div
        className={s.scroll}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <div className={s.transcript}>
          {loading && !events.length && <div className={s.center}><Spinner size={16} /></div>}
          {!loading && !events.length && (
            <div className={s.hello}>
              {members.length === 1 ? (
                <>
                  <Face agent={members[0]!} size={44} />
                  <h2>{members[0]!.name}</h2>
                  <p>{members[0]!.job || "Ready when you are."}</p>
                </>
              ) : (
                <>
                  <div className={s.helloFaces}>{members.map((m) => <Face key={m.id} agent={m} size={34} />)}</div>
                  <h2>{group?.name}</h2>
                  <p>Write to the group, or @mention who should take it.</p>
                </>
              )}
            </div>
          )}
          {items.map((block, index) => {
            if (block.kind === "work") return <Work key={block.id} items={block.items} live={index >= items.length - 3} />;
            const event = block.event;
            const agent = "agentId" in event ? byId.get(event.agentId) : undefined;
            switch (event.type) {
              case "user":
                return (
                  <div key={event.id} className={s.user}>
                    {event.images?.map((name) => (
                      <Image key={name} src={`/api/agent/file?name=${encodeURIComponent(name)}`} alt="Attached image" width={260} height={220} unoptimized className={s.userImage} style={{ width: "auto", height: "auto" }} />
                    ))}
                    {event.text !== "(image)" && <div className={s.userText}>{event.text}</div>}
                  </div>
                );
              case "agent":
                if (event.text.trim() === "PASS") return null;
                return (
                  <div key={event.id} className={s.reply}>
                    {(group || index === 0 || items[index - 1]?.kind !== "work") && agent && (
                      <div className={s.replyWho}><Face agent={agent} size={20} /><span>{agent.name}</span></div>
                    )}
                    <TutorMarkdown text={event.text} className={s.replyText} />
                  </div>
                );
              case "approval":
                return <Draft key={event.id} chatId={chatId} event={event} />;
              case "voice":
                return <Voice key={event.id} event={event} autoplay={autoVoice === event.id} />;
              case "question":
                return (
                  <div key={event.id} className={s.question}>
                    <p>{event.question}</p>
                    {event.options.length > 0 && (
                      <div className={s.chips}>{event.options.map((option) => <button key={option} type="button" className={s.chip} onClick={() => void send(option)}>{option}</button>)}</div>
                    )}
                  </div>
                );
              case "handoff": {
                const from = byId.get(event.from)?.name ?? "An agent";
                const to = byId.get(event.to)?.name ?? "an agent";
                return <HandoffLine key={event.id} from={from} to={to} text={event.text} />;
              }
              case "notice":
                return <p key={event.id} className={event.tone === "error" ? s.noticeBad : s.notice}>{event.text}</p>;
              default:
                return <Fragment key={(event as ChatEvent).id} />;
            }
          })}
          {working && !events.some((e) => (e.type === "agent" && e.streaming) || (e.type === "tool" && e.status === "running")) && (
            <div className={s.typing}><Spinner size={12} /> {members.filter((m) => m.state !== "idle").map((m) => m.name).join(", ")} {members.filter((m) => m.state === "working").length ? "is working" : "is up next"}</div>
          )}
        </div>
      </div>

      <form
        className={s.composer}
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
          <div className={s.files}>
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className={s.fileChip}>
                {f.name}
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles((current) => current.filter((_, j) => j !== i))}><Icon path={ICON.close} size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div className={s.composeRow}>
          <button type="button" className={s.iconButton} aria-label="Attach files" title="Attach files" onClick={() => picker.current?.click()}>
            <Icon path={CLIP} size={16} />
          </button>
          <input ref={picker} type="file" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
          <textarea
            ref={input}
            className={s.input}
            value={draft}
            rows={1}
            autoFocus
            placeholder={talk ? "Talk mode: tap the mic and speak" : group ? `Message ${group.name}` : `Message ${members[0]?.name ?? "agent"}`}
            onChange={(e) => {
              setDraft(e.target.value);
              setMenuIndex(0);
              e.currentTarget.style.height = "auto";
              e.currentTarget.style.height = `${Math.min(200, e.currentTarget.scrollHeight)}px`;
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
          {dictation.available && (
            <button type="button" className={`${s.iconButton} ${dictation.recording ? s.recording : ""}`} aria-label={dictation.recording ? "Stop dictation" : "Dictate"} title="Dictate" onClick={dictation.toggle} disabled={dictation.transcribing}>
              {dictation.transcribing ? <Spinner size={14} /> : <Icon path={ICON.mic} size={16} />}
            </button>
          )}
          <button type="button" className={`${s.iconButton} ${talk ? s.talkOn : ""}`} aria-pressed={talk} aria-label="Talk mode" title="Talk mode: speak, and hear replies" onClick={() => { if (!talk) setTalkSince(Date.now()); onTalk(!talk); }}>
            <Icon path={ICON.waveform} size={16} />
          </button>
          {working && !draft.trim() && !files.length ? (
            <button type="button" className={s.send} aria-label="Stop" title="Stop" onClick={stopAll}><Icon path={ICON.stop} size={14} /></button>
          ) : (
            <button type="submit" className={s.send} aria-label="Send" disabled={sending || (!draft.trim() && !files.length)}>{sending ? <Spinner size={14} /> : <Icon path={ICON.arrowUp} size={15} />}</button>
          )}
        </div>
        {(error || dictation.error) && <p className={s.composeError}>{error ?? dictation.error}</p>}
      </form>
    </div>
  );
}

function HandoffLine({ from, to, text }: { from: string; to: string; text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button type="button" className={s.handoff} onClick={() => setOpen((o) => !o)} aria-expanded={open}>
      <span><strong>{from}</strong> → <strong>{to}</strong></span>
      <span className={open ? s.handoffFull : s.handoffText}>{text}</span>
    </button>
  );
}
