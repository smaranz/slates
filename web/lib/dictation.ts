"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

/**
 * Hold the mic, say the thing, get it typed.
 *
 * One implementation for the tutor and the counselor, and one that works in
 * all three places Slates runs. The browser's own `SpeechRecognition` is not
 * that: it is missing entirely from the phone's web view, and present but
 * dead in the packaged Electron app, where starting it returns
 * `error: "network"` because Chromium there has no speech service behind the
 * API. A mic button that appears and does nothing is worse than no button.
 *
 * So this records with `MediaRecorder` — available everywhere, and the
 * microphone was never the broken part — and sends the audio to
 * `/api/transcribe`.
 *
 * The trade is that text arrives when you stop rather than as you speak. For
 * a composer you are going to read before sending, a whole accurate sentence
 * a second later beats words appearing live and wrongly.
 */

export interface Dictation {
  /** False only where there is no microphone API at all. */
  available: boolean;
  recording: boolean;
  /** True between stopping and the text coming back. */
  transcribing: boolean;
  error: string | null;
  toggle: () => void;
}

function micAvailable(): boolean {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia);
}

/** Nothing to subscribe to — the API is there or it isn't. */
function subscribe(): () => void {
  return () => {};
}

function unavailableOnServer(): boolean {
  return false;
}

/**
 * The container to record in.
 *
 * Chromium gives webm/opus and Safari gives mp4; both are formats the
 * transcription model accepts. Asked for nothing, `MediaRecorder` picks its
 * own default, which on some builds is a container the model rejects with
 * "This model does not support the format you provided" — so the preference
 * is stated rather than left to chance.
 */
function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return preferred.find((type) => MediaRecorder.isTypeSupported(type));
}

export function useDictation(onText: (text: string) => void): Dictation {
  /*
   * Read through `useSyncExternalStore` rather than in an effect: the server
   * has no `navigator`, and setting this from an effect would render the
   * button once without the mic and once with it — a control that pops into
   * the composer a frame after the view opens.
   */
  const available = useSyncExternalStore(subscribe, micAvailable, unavailableOnServer);

  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sink = useRef(onText);

  // After commit, not during render: the callback closes over this render's
  // draft, and a recording outlives several.
  useEffect(() => {
    sink.current = onText;
  });

  /** Let go of the microphone, or the OS keeps showing it as in use. */
  const release = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  useEffect(
    () => () => {
      try {
        recorderRef.current?.stop();
      } catch {
        // Already stopped.
      }
      release();
    },
    [release]
  );

  const toggle = useCallback(() => {
    setError(null);

    const active = recorderRef.current;
    if (active) {
      // `onstop` does the sending; this only asks it to finish.
      try {
        active.stop();
      } catch {
        release();
        setRecording(false);
      }
      return;
    }

    void (async () => {
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch {
        setError("Slates needs microphone access. Allow it in System Settings › Privacy.");
        return;
      }

      streamRef.current = stream;
      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
        release();
        setError("This device can't record audio.");
        return;
      }

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || "audio/webm" });
        release();
        setRecording(false);

        // Nothing captured — a tap rather than a sentence.
        if (blob.size < 1024) return;

        setTranscribing(true);
        void (async () => {
          try {
            const res = await fetch("/api/transcribe", {
              method: "POST",
              headers: { "content-type": blob.type },
              body: blob,
            });
            const body = (await res.json()) as { text?: string; error?: string };
            if (!res.ok || body.error) throw new Error(body.error ?? `Transcription failed (${res.status}).`);
            const text = body.text?.trim();
            if (text) sink.current(text);
            else setError("Nothing was said.");
          } catch (err) {
            setError(err instanceof Error ? err.message : "Transcription failed.");
          } finally {
            setTranscribing(false);
          }
        })();
      };

      try {
        recorder.start();
        recorderRef.current = recorder;
        setRecording(true);
      } catch {
        release();
        setError("Couldn't start recording.");
      }
    })();
  }, [release]);

  return { available, recording, transcribing, error, toggle };
}
