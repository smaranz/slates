"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useAction, useMutation } from "@whirl/backend/react";
import { api } from "@whirl/backend/convex/_generated/api";
import type { Id } from "@whirl/backend/convex/_generated/dataModel";

import { createLevelReader, SPEECH_PEAK_FLOOR } from "./audio-level";

/* Dictation, composer-side. This hook owns the whole lifecycle — permission,
   the mic stream, the recorder, the analyser the visualizer paints from, and
   the trip through storage to Whisper — and hands the composer a small state
   machine to morph its face against.

   Everything hot (the audio levels) stays on refs: the waveform reads the
   analyser on its own rAF, so a recording that runs for minutes never costs
   the composer a single re-render. */

export type VoiceStatus =
  /** No recording, no face — the composer is its normal self. */
  | "idle"
  /** The mic hasn't been granted yet: the composer shows the big microphone. */
  | "permission"
  /** The browser's own prompt is up, waiting on the user. */
  | "requesting"
  /** Already granted, and the device is opening. Wears the listening face, not
   *  the permission one: there is nothing to grant, so showing a big
   *  microphone here would be asking for something we already have. */
  | "opening"
  /** Blocked at the browser or OS level — asking again won't prompt. */
  | "denied"
  | "recording"
  | "processing"
  /** A failure worth reading, with the recording already thrown away. */
  | "error";

/* Long enough for a rambling thought, short enough that a mic left open by
   accident can't bill a novel. Recording stops itself here. */
const MAX_RECORDING_MS = 5 * 60 * 1000;

/* Below this the clip is a click of the button, not speech. */
const MIN_CLIP_BYTES = 1024;

/* Only the timer is React state, and only four times a second — the waveform
   never goes through render at all. */
const TIMER_TICK_MS = 250;

/* How often the recorder checks whether it can hear anything. Independent of
   the waveform's own loop, because the answer has to survive whether or not a
   visualizer is on screen. */
const LEVEL_POLL_MS = 100;

/* Ordered by preference: Chromium and Firefox take the first, Safari falls
   through to mp4. An empty string means "let the browser pick", which is the
   last resort rather than the default — a known container keeps the filename
   we send Whisper honest. */
const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  return (
    PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) ??
    ""
  );
}

/** Whether this browser can record at all. Checked before the mic button is
 *  ever offered, so nobody is handed an affordance that can only fail. */
export function isVoiceInputSupported() {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

/* Support never changes for the life of a page, so there is nothing to
   subscribe to — this is here purely for the server snapshot. Asking during
   render would answer "no" on the server and "yes" in the browser, which is a
   hydration mismatch; useSyncExternalStore is how you say "these two are
   allowed to differ" without an effect and a wasted second render. */
const NEVER_CHANGES = () => () => {};
const NOT_ON_THE_SERVER = () => false;

/** The mic button's gate: false through SSR and the hydrating render, then
 *  whatever this browser can actually do. */
export function useVoiceInputSupported() {
  return useSyncExternalStore(
    NEVER_CHANGES,
    isVoiceInputSupported,
    NOT_ON_THE_SERVER,
  );
}

/* Has the mic already been granted? Firefox and Safari don't all implement the
   microphone permission name, and a query can throw — every unknown answer
   means "ask", which is the safe direction: the worst case is one extra tap on
   a permission face for a mic that was already granted. */
async function readPermission(): Promise<"granted" | "denied" | "prompt"> {
  try {
    const status = await navigator.permissions?.query({
      name: "microphone" as PermissionName,
    });
    if (status?.state === "granted" || status?.state === "denied") {
      return status.state;
    }
  } catch {
    /* Unsupported query — fall through and ask. */
  }
  return "prompt";
}

/* getUserMedia's rejection reasons, in the words of someone who just wanted to
   talk. NotAllowedError is the only one that's a real "denied"; the rest are
   hardware or browser problems that a retry might actually fix. */
function mediaErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No microphone found. Plug one in and try again.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Your microphone is busy in another app. Close it and try again.";
  }
  if (name === "SecurityError") {
    return "Voice input needs a secure connection to your microphone.";
  }
  return "Couldn't reach your microphone. Try again?";
}

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === "string") return error;
  /* ConvexError surfaces the server's own sentence as `data`. */
  const data = (error as { data?: unknown })?.data;
  if (typeof data === "string" && data.length > 0) return data;
  return fallback;
}

export type VoiceInput = {
  status: VoiceStatus;
  /** Set while `status` is "error" or "denied". */
  error: string | null;
  /** Milliseconds recorded so far, for the timer next to the waveform. */
  elapsedMs: number;
  /** Live mic analyser, or null when nothing is recording. The waveform reads
   *  this directly rather than taking levels through render. */
  analyserRef: React.RefObject<AnalyserNode | null>;
  /** Open the voice face — straight to recording when the mic is already
   *  granted, otherwise to the permission prompt. */
  start: () => void;
  /** The "Grant permission" button: trigger the browser's own prompt. */
  grant: () => void;
  /** Finish and transcribe. */
  stop: () => void;
  /** Throw the recording away and close the face. */
  cancel: () => void;
};

export function useVoiceInput({
  onTranscript,
}: {
  /** Fired with the transcribed text once it lands. */
  onTranscript: (text: string) => void;
}): VoiceInput {
  const [status, setStatus] = useState<VoiceStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  /* Held only so it stays held. A MediaStreamAudioSourceNode feeding an
     analyser that feeds nothing is, as far as the engine is concerned,
     unreachable — drop the last reference and the graph can be collected out
     from under the visualizer mid-sentence. */
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const capRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const levelPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /* The loudest thing heard this recording, and whether the analyser was ever
     in a state to have an opinion. Together they're how we tell "you said
     nothing" apart from "we couldn't listen" — and the second flag means the
     latter exactly, rather than "the level was above zero". A dead virtual
     device reads a clean 0.0, which is a reading, not the absence of one. */
  const peakRef = useRef(0);
  const listenedRef = useRef(false);
  /* Set by cancel() so the recorder's own stop handler knows to bin the clip
     instead of transcribing it. */
  const discardedRef = useRef(false);
  /* True between start() and cancel(): the permission query resolves a tick
     later, and by then the user may already have backed out. */
  const openRef = useRef(false);
  /* Survives unmount: every async continuation checks it before touching
     state, so a composer that swapped faces mid-upload settles quietly. */
  const liveRef = useRef(true);

  const uploadUrl = useMutation(api.messages.generateAttachmentUploadUrl);
  const transcribe = useAction(api.transcription.transcribe);

  /* Let go of the mic and everything hanging off it. Safe to call twice —
     teardown runs on cancel, on finish, and on unmount, and those races are
     ordinary rather than exceptional. */
  const releaseHardware = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (capRef.current) clearTimeout(capRef.current);
    if (levelPollRef.current) clearInterval(levelPollRef.current);
    timerRef.current = null;
    capRef.current = null;
    levelPollRef.current = null;

    recorderRef.current = null;
    analyserRef.current = null;
    sourceRef.current?.disconnect();
    sourceRef.current = null;

    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;

    const context = audioContextRef.current;
    audioContextRef.current = null;
    /* Closing a context that's already closing rejects; nothing here can act
       on that, and the context is unreachable either way. */
    void context?.close().catch(() => {});
  }, []);

  useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      releaseHardware();
    };
  }, [releaseHardware]);

  /* The clip is a keystroke that took a detour: up to storage, through
     Whisper, back as text. The action deletes the blob on its way out, so
     nothing is left behind whether or not the words arrive. */
  const sendForTranscription = useCallback(
    async (clip: Blob, mimeType: string) => {
      try {
        const url = await uploadUrl();
        const upload = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": mimeType || "application/octet-stream" },
          body: clip,
        });
        if (!upload.ok) {
          throw new Error(`Upload failed with ${upload.status}`);
        }
        const { storageId } = (await upload.json()) as {
          storageId: Id<"_storage">;
        };

        const { text } = await transcribe({ clip: storageId, mimeType });
        if (!liveRef.current) return;
        onTranscript(text);
        setStatus("idle");
        setError(null);
      } catch (caught) {
        if (!liveRef.current) return;
        setError(
          errorMessage(caught, "Voice input couldn't transcribe that. Try again?"),
        );
        setStatus("error");
      }
    },
    [onTranscript, transcribe, uploadUrl],
  );

  /* Mic in hand: wire up the analyser the waveform paints from, start the
     recorder, and set both clocks running. */
  const beginRecording = useCallback(
    (stream: MediaStream) => {
      if (!liveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      discardedRef.current = false;
      chunksRef.current = [];
      peakRef.current = 0;
      listenedRef.current = false;

      try {
        const context = new AudioContext();
        audioContextRef.current = context;
        /* An AudioContext built outside a user gesture is born SUSPENDED, and
           this one always is: it's constructed in getUserMedia's continuation,
           long after the click that started all this. A suspended analyser
           never advances — every read comes back as the 128 midpoint, which is
           an unbroken flat line no matter how loudly anyone speaks. Resuming
           is the difference between a visualizer and a dotted rule. */
        void context.resume().catch(() => {});
        const analyser = context.createAnalyser();
        /* Enough resolution to separate the low bands the visualizer spaces
           logarithmically — at 1024 the bottom of a voice lands in two or
           three bins and the left of the row moves as one lump. Smoothing is
           light because the bars do their own attack/release; doubling up
           here only makes them sluggish. */
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.6;
        /* The dB window the byte spectrum is stretched across. The stock
           -100..-30 spends most of its range on room tone; this sits it
           around conversational level so a normal voice fills the row. */
        analyser.minDecibels = -85;
        analyser.maxDecibels = -25;
        const source = context.createMediaStreamSource(stream);
        source.connect(analyser);
        sourceRef.current = source;
        analyserRef.current = analyser;

        /* Watch the level for the whole recording, whether or not anything is
           painting it. Silence is the one thing Whisper won't report honestly,
           so we have to know before we ask. */
        const readLevel = createLevelReader(analyser);
        levelPollRef.current = setInterval(() => {
          /* A suspended context reports a flat midpoint forever; a sample
             taken from one says nothing about the room. */
          if (context.state !== "running") return;
          listenedRef.current = true;
          peakRef.current = Math.max(peakRef.current, readLevel());
        }, LEVEL_POLL_MS);
      } catch {
        /* No analyser means no bars and no silence check — a flat line and a
           clip sent on faith, rather than a failure. The recording itself is
           what matters and it doesn't run through here. */
        analyserRef.current = null;
      }

      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
      } catch {
        releaseHardware();
        setError("This browser can't record audio. Try Chrome or Safari?");
        setStatus("error");
        return;
      }

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        releaseHardware();
        if (!liveRef.current) return;
        setError("Your microphone cut out mid-recording. Try again?");
        setStatus("error");
      };
      recorder.onstop = () => {
        const chunks = chunksRef.current;
        /* Strip the codecs parameter: this rides on as a Content-Type and a
           filename extension, and both want the plain container. */
        const type = (recorder.mimeType || mimeType || "audio/webm")
          .split(";")[0]
          .trim();
        const peak = peakRef.current;
        const listened = listenedRef.current;
        chunksRef.current = [];
        releaseHardware();
        if (discardedRef.current || !liveRef.current) return;

        const clip = new Blob(chunks, { type });
        if (clip.size < MIN_CLIP_BYTES) {
          setError("That was too short to hear. Hold on a little longer?");
          setStatus("error");
          return;
        }
        /* Nothing above room tone the whole time. Sending it anyway is worse
           than useless: Whisper doesn't return an empty string for silence,
           it invents a plausible one — "Thank you." is its house favourite —
           and a confident wrong transcript is harder to recover from than an
           honest failure. Only trust this when the analyser was actually
           running; otherwise the clip goes on faith. */
        if (listened && peak < SPEECH_PEAK_FLOOR) {
          setError(
            "We didn't hear anything. Check that the right microphone is picked and unmuted, then try again.",
          );
          setStatus("error");
          return;
        }
        void sendForTranscription(clip, type);
      };

      recorderRef.current = recorder;
      /* No timeslice: one dataavailable at the end means one self-contained
         container, rather than a header chunk plus a run of bare clusters
         that every decoder downstream has to be willing to stitch back
         together. Five minutes of opus is under a megabyte in memory. */
      recorder.start();

      const startedAt = Date.now();
      setElapsedMs(0);
      timerRef.current = setInterval(() => {
        if (liveRef.current) setElapsedMs(Date.now() - startedAt);
      }, TIMER_TICK_MS);
      /* The hard cap finishes the recording rather than binning it — five
         minutes of speech is still worth transcribing. */
      capRef.current = setTimeout(() => {
        if (recorderRef.current?.state === "recording") {
          setStatus("processing");
          recorderRef.current.stop();
        }
      }, MAX_RECORDING_MS);

      setError(null);
      setStatus("recording");
    },
    [releaseHardware, sendForTranscription],
  );

  /* Ask the browser for the mic. This is the only path that can raise the
     native prompt, so it's what the "Grant permission" button calls.
     `alreadyGranted` decides which face covers the wait: opening a device
     takes a few hundred milliseconds even when there's nothing to approve,
     and spending them under a big "Grant permission" microphone is how you
     end up asking someone for something they gave you weeks ago. */
  const requestMic = useCallback(async (alreadyGranted = false) => {
    setError(null);
    setStatus(alreadyGranted ? "opening" : "requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      beginRecording(stream);
    } catch (caught) {
      if (!liveRef.current) return;
      const denied =
        caught instanceof DOMException &&
        (caught.name === "NotAllowedError" ||
          caught.name === "PermissionDeniedError");
      setError(
        denied
          ? "Microphone access is blocked. Allow it in your browser's site settings, then try again."
          : mediaErrorMessage(caught),
      );
      setStatus(denied ? "denied" : "error");
    }
  }, [beginRecording]);

  const start = useCallback(() => {
    if (!isVoiceInputSupported()) {
      setError("This browser can't record audio. Try Chrome or Safari?");
      setStatus("error");
      return;
    }
    setError(null);
    openRef.current = true;
    /* Ask what we already know before morphing anything. The query settles in
       a couple of milliseconds, and spending them is what keeps a user who
       granted the mic weeks ago from being shown "Grant permission" for a
       frame on their way into recording. */
    void readPermission().then((permission) => {
      if (!liveRef.current || !openRef.current) return;
      if (permission === "granted") {
        void requestMic(true);
        return;
      }
      if (permission === "denied") {
        setError(
          "Microphone access is blocked. Allow it in your browser's site settings, then try again.",
        );
        setStatus("denied");
        return;
      }
      setStatus("permission");
    });
  }, [requestMic]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder?.state !== "recording") return;
    /* Straight to processing: the recorder's onstop is where the upload
       actually begins, and the gap between them shouldn't read as a stall. */
    setStatus("processing");
    recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    discardedRef.current = true;
    openRef.current = false;
    const recorder = recorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    releaseHardware();
    setElapsedMs(0);
    setError(null);
    setStatus("idle");
  }, [releaseHardware]);

  return {
    status,
    error,
    elapsedMs,
    analyserRef,
    start,
    grant: () => void requestMic(false),
    stop,
    cancel,
  };
}
