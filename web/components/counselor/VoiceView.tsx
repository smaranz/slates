"use client";

import { motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { computeChance } from "@/lib/counselor/chances";
import { getCollege } from "@/lib/counselor/colleges";
import { buildSchoolContext } from "@/lib/counselor/school";
import { profileReady, uid } from "@/lib/counselor/state";
import { useCounselor } from "@/lib/counselor/store";
import type { CounselorProfile, StatePatch } from "@/lib/counselor/types";
import { useStore } from "@/lib/store";
import { Icon, ICON, Spinner } from "../ui";

/**
 * Talking to the counselor.
 *
 * The browser holds a WebRTC session directly with OpenAI's realtime model, so
 * audio never touches Slates — the server's only job is minting a one-call
 * key. What comes back over the data channel is transcript and tool calls;
 * the tool calls run here, against the same local record the typed
 * conversation writes to, so a score you say out loud is on your profile
 * before the call ends.
 */

type Phase = "idle" | "connecting" | "live" | "ended" | "error";

interface Turn {
  id: string;
  role: "user" | "assistant";
  text: string;
  final: boolean;
}

/** Long enough for a real conversation, short enough that a forgotten tab isn't a bill. */
const MAX_SECONDS = 30 * 60;

export default function VoiceView() {
  const c = useCounselor();
  const school = useStore();

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [speaking, setSpeaking] = useState<"you" | "counselor" | null>(null);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const levelRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // The tool handlers close over the record, which changes as they write to
  // it. A ref keeps them reading the current one without tearing down the
  // data channel's listener every time a memory is saved. Written in an
  // effect rather than during render: nothing reads it until the student has
  // actually spoken, which is long after the first commit.
  const stateRef = useRef(c);
  useEffect(() => {
    stateRef.current = c;
  });

  const ready = profileReady(c.profile);

  const hangUp = useCallback(() => {
    // Nothing was ever dialled — this is the unmount of a view that was only
    // ever looked at, or React's development double-mount. Either way, saying
    // "call ended" would be a lie about a call that never happened.
    const wasLive = Boolean(pcRef.current);

    dcRef.current?.close();
    pcRef.current?.getSenders().forEach((s) => s.track?.stop());
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    dcRef.current = null;
    pcRef.current = null;
    micRef.current = null;
    audioCtxRef.current = null;
    rafRef.current = null;
    if (wasLive) setPhase((p) => (p === "error" ? p : "ended"));
    setSpeaking(null);
  }, []);

  // A call must not outlive the view. Without this, navigating to Documents
  // mid-conversation leaves the model talking to an empty room.
  useEffect(() => hangUp, [hangUp]);

  useEffect(() => {
    if (phase !== "live") return;
    const started = Date.now();
    const timer = window.setInterval(() => {
      const secs = Math.floor((Date.now() - started) / 1000);
      setElapsed(secs);
      if (secs >= MAX_SECONDS) hangUp();
    }, 1000);
    return () => window.clearInterval(timer);
  }, [phase, hangUp]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns]);

  /** Applies one tool call and hands the model back a result. */
  const runTool = useCallback(async (name: string, args: Record<string, unknown>): Promise<unknown> => {
    const store = stateRef.current;
    switch (name) {
      case "search_counseling_library": {
        // The index lives on the server; the call itself doesn't pass through
        // it, so this is the one voice tool that has to make a round trip.
        try {
          const res = await fetch(`/api/counselor/library?q=${encodeURIComponent(String(args.query ?? ""))}`);
          return await res.json();
        } catch {
          return { error: "Couldn't reach the library. Answer from your own knowledge and say so." };
        }
      }
      case "save_memory": {
        const content = String(args.content ?? "").trim();
        if (!content) return { error: "Nothing to save." };
        const patch: StatePatch = {
          memories: [
            {
              id: uid(),
              kind: (args.kind as never) ?? "fact",
              content,
              importance: Number(args.importance ?? 3),
              source: "counselor",
              updatedAt: Date.now(),
            },
            ...store.memories,
          ],
        };
        store.merge(patch);
        return { saved: true };
      }
      case "create_task": {
        const title = String(args.title ?? "").trim();
        if (!title) return { error: "Needs a title." };
        store.addTask(title, args.due_date ? String(args.due_date) : undefined);
        return { created: true };
      }
      case "check_chances": {
        const college = getCollege(String(args.college ?? ""));
        if (!college) return { error: "Not in the database — say you don't have verified numbers for it." };
        const chance = computeChance(store.profile, college, (args.round as "ED" | "EA" | "RD") ?? "RD");
        return {
          name: college.name,
          band: chance.band,
          odds: `${chance.low}-${chance.high} percent`,
          summary: chance.summary,
        };
      }
      case "update_profile_fact": {
        const field = String(args.field ?? "");
        const raw = String(args.value ?? "");
        const next = { ...store.profile } as CounselorProfile;
        const n = Number(raw.replace(/[^0-9.]/g, ""));
        if (field === "sat") next.sat = Number.isFinite(n) ? Math.round(n) : null;
        else if (field === "act") next.act = Number.isFinite(n) ? Math.round(n) : null;
        else if (field === "gpaUnweighted") next.gpaUnweighted = Number.isFinite(n) ? n : null;
        else if (field === "budgetMax") next.budgetMax = Number.isFinite(n) ? Math.round(n) : null;
        else if (field === "rigor") {
          const r = raw.toLowerCase().replace(/\s+/g, "-");
          if (r === "low" || r === "medium" || r === "high" || r === "very-high") next.rigor = r;
        } else if (field === "state") next.state = raw.toUpperCase().slice(0, 2);
        else if (field === "intendedMajor") next.intendedMajor = raw;
        else if (field === "dreamSchool") next.dreamSchool = raw;
        else if (field === "highSchool") next.highSchool = raw;
        else if (field === "name") next.name = raw;
        store.setProfile(next);
        return { recorded: field };
      }
      default:
        return { error: `Unknown tool ${name}.` };
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    setTurns([]);
    setElapsed(0);
    setPhase("connecting");

    try {
      const store = stateRef.current;
      const res = await fetch("/api/counselor/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          state: {
            profile: store.profile,
            memories: store.memories,
            tasks: store.tasks,
            documents: store.documents,
            meetings: store.meetings,
            applications: store.applications,
            list: store.list,
            threads: [],
          },
          schoolContext: buildSchoolContext(school) || undefined,
        }),
      });
      const session = (await res.json()) as { token?: string; model?: string; error?: string };
      if (!res.ok || !session.token) throw new Error(session.error ?? "Couldn't start a call.");

      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      micRef.current = mic;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      pc.ontrack = (event) => {
        if (audioRef.current) audioRef.current.srcObject = event.streams[0];
        meter(event.streams[0]);
      };

      pc.addTrack(mic.getAudioTracks()[0], mic);

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => handleEvent(JSON.parse(e.data as string));

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const answer = await fetch(
        `https://api.openai.com/v1/realtime/calls?model=${encodeURIComponent(session.model ?? "gpt-realtime-2.1-mini")}`,
        {
          method: "POST",
          body: offer.sdp,
          headers: { Authorization: `Bearer ${session.token}`, "Content-Type": "application/sdp" },
        }
      );
      if (!answer.ok) throw new Error(`The call was refused (${answer.status}).`);

      await pc.setRemoteDescription({ type: "answer", sdp: await answer.text() });
      setPhase("live");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start a call.");
      setPhase("error");
      hangUp();
    }

    /** Drives the orb off the counselor's actual output level. */
    function meter(stream: MediaStream) {
      try {
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        ctx.createMediaStreamSource(stream).connect(analyser);
        const data = new Uint8Array(analyser.frequencyBinCount);
        const tick = () => {
          analyser.getByteTimeDomainData(data);
          let peak = 0;
          for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
          // Smoothed, or the orb strobes on every syllable.
          levelRef.current = levelRef.current * 0.75 + (peak / 128) * 0.25;
          rafRef.current = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        // No Web Audio: the orb just breathes on its own timer.
      }
    }

    /** One server event off the data channel. */
    function handleEvent(event: { type: string; [k: string]: unknown }) {
      switch (event.type) {
        case "input_audio_buffer.speech_started":
          setSpeaking("you");
          break;
        case "input_audio_buffer.speech_stopped":
          setSpeaking(null);
          break;
        case "conversation.item.input_audio_transcription.completed": {
          const text = String(event.transcript ?? "").trim();
          if (text) setTurns((prev) => [...prev, { id: String(event.item_id), role: "user", text, final: true }]);
          break;
        }
        case "response.output_audio_transcript.delta": {
          const id = String(event.item_id);
          const delta = String(event.delta ?? "");
          setSpeaking("counselor");
          setTurns((prev) => {
            const at = prev.findIndex((t) => t.id === id);
            if (at === -1) return [...prev, { id, role: "assistant", text: delta, final: false }];
            const next = [...prev];
            next[at] = { ...next[at], text: next[at].text + delta };
            return next;
          });
          break;
        }
        case "response.output_audio_transcript.done": {
          const id = String(event.item_id);
          setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, text: String(event.transcript ?? t.text), final: true } : t)));
          break;
        }
        case "response.done":
          setSpeaking(null);
          break;
        case "response.function_call_arguments.done": {
          const name = String(event.name ?? "");
          const callId = String(event.call_id ?? "");
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(String(event.arguments ?? "{}")) as Record<string, unknown>;
          } catch {
            // Malformed arguments still deserve a reply, or the model hangs
            // waiting for an output that never comes.
          }
          // Fire and forget: the handler is async now, and blocking the data
          // channel's message loop on it would stall every event behind it.
          void runTool(name, args).then((output) => {
            dcRef.current?.send(
              JSON.stringify({
                type: "conversation.item.create",
                item: { type: "function_call_output", call_id: callId, output: JSON.stringify(output) },
              })
            );
            dcRef.current?.send(JSON.stringify({ type: "response.create" }));
          });
          break;
        }
        case "error":
          setError(String((event.error as { message?: string })?.message ?? "The call hit an error."));
          break;
      }
    }
  }, [school, runTool, hangUp]);

  const toggleMute = useCallback(() => {
    const track = micRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMuted(!track.enabled);
  }, []);

  return (
    <div className="counselor-voice">
      <audio ref={audioRef} autoPlay />

      <Orb phase={phase} speaking={speaking} levelRef={levelRef} />

      <div className="counselor-voice-status">
        {phase === "idle" && <p>Talk it through out loud. It knows everything the typed side knows.</p>}
        {phase === "connecting" && (
          <p>
            <Spinner size={12} /> Connecting
          </p>
        )}
        {phase === "live" && (
          <p>
            <span className="counselor-live-dot" /> {clock(elapsed)}
            {speaking === "you" ? " · listening" : speaking === "counselor" ? " · speaking" : ""}
          </p>
        )}
        {phase === "ended" && <p>Call ended. Anything it recorded is on your plan.</p>}
        {error && <p className="counselor-voice-error">{error}</p>}
      </div>

      <div className="counselor-voice-controls">
        {phase === "live" ? (
          <>
            <button type="button" className={`counselor-mute${muted ? " is-on" : ""}`} onClick={toggleMute}>
              <Icon path={ICON.mic} size={15} />
              {muted ? "Unmute" : "Mute"}
            </button>
            <button type="button" className="counselor-hangup" onClick={hangUp}>
              <Icon path={ICON.close} size={15} />
              End call
            </button>
          </>
        ) : (
          <button
            type="button"
            className="counselor-call"
            onClick={() => void start()}
            disabled={phase === "connecting" || !ready}
          >
            <Icon path={ICON.mic} size={15} />
            {phase === "ended" || phase === "error" ? "Call again" : "Start call"}
          </button>
        )}
      </div>

      {!ready && (
        <p className="counselor-voice-gate">
          Fill in your profile first — a call with a blank record is a call with a stranger.{" "}
          <button type="button" className="counselor-linkish" onClick={() => c.setView("profile")}>
            Open profile
          </button>
        </p>
      )}

      {turns.length > 0 && (
        <div className="counselor-transcript" ref={scrollRef}>
          {turns.map((t) => (
            <p key={t.id} className={`counselor-line${t.role === "user" ? " is-user" : ""}`}>
              <span className="counselor-line-who">{t.role === "user" ? "You" : "Counselor"}</span>
              {t.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The orb.
 *
 * Its ring scales with the counselor's real output level rather than a canned
 * animation, so you can see it thinking, hear it stop, and watch it hand the
 * turn back. Driven from a ref inside rAF because a level that re-rendered
 * React sixty times a second would cost more than the whole call.
 */
function Orb({
  phase,
  speaking,
  levelRef,
}: {
  phase: Phase;
  speaking: "you" | "counselor" | null;
  levelRef: React.RefObject<number>;
}) {
  const ringRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (phase !== "live") return;
    let frame = 0;
    const tick = () => {
      const el = ringRef.current;
      if (el) {
        const level = Math.min(levelRef.current * 2.4, 1);
        el.style.transform = `scale(${1 + level * 0.35})`;
        el.style.opacity = String(0.25 + level * 0.55);
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(frame);
  }, [phase, levelRef]);

  const idle = phase !== "live";

  return (
    <div className="counselor-orb-wrap">
      <span ref={ringRef} className="counselor-orb-ring" />
      <motion.span
        className={`counselor-orb${speaking === "you" ? " is-listening" : ""}`}
        animate={
          idle
            ? { scale: 1, opacity: phase === "connecting" ? [0.6, 1, 0.6] : 0.85 }
            : { scale: [1, 1.03, 1] }
        }
        transition={
          idle
            ? { duration: 1.6, repeat: phase === "connecting" ? Number.POSITIVE_INFINITY : 0, ease: "easeInOut" }
            : { duration: 3.4, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }
        }
      />
    </div>
  );
}

function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
