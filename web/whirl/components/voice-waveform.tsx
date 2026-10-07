"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { createSpectrumReader } from "@whirl/lib/audio-level";

/* The live input meter: a row of bars mirrored about the center line, each
   one standing for a band of the voice rather than a moment of it. Low notes
   on the left, sibilance on the right.

   The earlier version scrolled a single loudness reading across the row,
   which meant every bar was the same number a few frames apart — a picket
   fence rocking in unison, saying nothing except "louder" or "quieter". This
   one gives each bar its own band, so a vowel lights the left, a consonant
   snaps the right, and the row moves the way the voice actually did.

   Bars attack fast and fall slow, the asymmetry every meter uses: catching a
   consonant matters, and a decay that snaps back as fast as it rose reads as
   flicker rather than speech.

   Nothing hot goes through React. The rAF loop reads the analyser and writes
   `scaleY` straight onto the bar elements, so a five-minute dictation costs
   the composer exactly the renders its timer asks for and no more — the only
   state here is the bar count, which moves when the pill is resized. */

/* One bar plus its gap. Bars are counted off the container rather than fixed,
   so the row keeps the same density whether the pill is a phone's width or a
   desktop's with the sidebar collapsed. */
const BAR_PITCH_PX = 9;
const MIN_BARS = 8;
const MAX_BARS = 64;

/* Silence still shows a hairline, so the row never disappears entirely — and
   never fakes a shimmer either. A flat line here means the mic really isn't
   being heard, which is worth seeing. */
const MIN_SCALE = 0.07;

/* Per-frame approach to the target, rise and fall. Fast up, gentle down. */
const ATTACK = 0.45;
const RELEASE = 0.12;

export function VoiceWaveform({
  analyserRef,
  /** Frozen mid-thought: the bars stop moving and dim while the clip
   *  transcribes, so the loading state still shows what was captured. */
  paused = false,
}: {
  analyserRef: React.RefObject<AnalyserNode | null>;
  paused?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [barCount, setBarCount] = useState(MIN_BARS);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(([entry]) => {
      const fits = Math.floor(entry.contentRect.width / BAR_PITCH_PX);
      setBarCount(Math.max(MIN_BARS, Math.min(MAX_BARS, fits)));
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (paused) return;
    const container = containerRef.current;
    if (!container) return;

    const bars = Array.from(
      container.querySelectorAll<HTMLElement>("[data-bar]"),
    );
    const levels = new Array<number>(bars.length).fill(0);
    const shown = new Array<number>(bars.length).fill(MIN_SCALE);

    /* Rebound inside the loop rather than captured here. This row is on
       screen before the analyser exists — the device spends a few hundred
       milliseconds opening, and the bars are already up by then. Latching
       onto whatever `analyserRef` held at mount would mean latching onto null
       and drawing a flat line for the whole recording. */
    let boundTo: AnalyserNode | null = null;
    let readSpectrum: ((out: number[]) => number[]) | null = null;

    let frame = 0;
    const paint = () => {
      frame = requestAnimationFrame(paint);

      const analyser = analyserRef.current;
      if (analyser !== boundTo) {
        boundTo = analyser;
        readSpectrum = analyser
          ? createSpectrumReader(analyser, bars.length)
          : null;
        levels.fill(0);
      }
      if (readSpectrum) readSpectrum(levels);
      else levels.fill(0);

      for (let i = 0; i < bars.length; i += 1) {
        const target = MIN_SCALE + (levels[i] ?? 0) * (1 - MIN_SCALE);
        const current = shown[i];
        shown[i] =
          current + (target - current) * (target > current ? ATTACK : RELEASE);
        bars[i].style.scale = `1 ${shown[i]}`;
      }
    };

    frame = requestAnimationFrame(paint);
    return () => cancelAnimationFrame(frame);
  }, [analyserRef, barCount, paused]);

  return (
    <div
      ref={containerRef}
      aria-hidden
      className={`flex h-7 min-w-0 flex-1 items-center justify-between transition-opacity duration-300 ${
        paused ? "opacity-40" : "opacity-100"
      }`}
      style={{
        /* Taper the ends so the row sits in the pill rather than butting up
           against the buttons on either side. */
        maskImage:
          "linear-gradient(to right, transparent, black 6%, black 94%, transparent)",
      }}
    >
      {Array.from({ length: barCount }, (_, index) => (
        <span
          key={index}
          data-bar
          /* Grows from the middle out: `scale` is a standalone property in
             Tailwind v4 and the default origin is the center, so one axis is
             all the mirroring this needs. */
          className="h-full w-[4px] shrink-0 rounded-full bg-foreground-soft"
          style={{ scale: `1 ${MIN_SCALE}` }}
        />
      ))}
    </div>
  );
}
