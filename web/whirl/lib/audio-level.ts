/* How loud the mic is, right now. Shared by the waveform (which paints it)
   and the recorder (which watches it to find out whether anything was ever
   actually said). One implementation so the bars and the "we heard nothing"
   check can never disagree about what silence looks like. */

/** RMS of the current buffer, 0 (silence) to ~1 (clipping). */
export function createLevelReader(analyser: AnalyserNode) {
  const buffer = new Uint8Array(analyser.fftSize);
  return () => {
    analyser.getByteTimeDomainData(buffer);
    /* RMS around the 128 midpoint — loudness, not pitch. */
    let sum = 0;
    for (let i = 0; i < buffer.length; i += 1) {
      const sample = (buffer[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / buffer.length);
  };
}

/* The band the visualizer draws. Voice lives between the low fundamentals of
   a chest voice and the top of sibilance; everything above is hiss and
   everything below is desk rumble, and spending bars on either makes the row
   look dead while someone is talking into it. */
const MIN_HZ = 70;
const MAX_HZ = 5000;

/* High frequencies carry far less energy than low ones, so an untilted
   spectrum is a wall on the left and nothing on the right. This lifts the top
   end back into view — cosmetic, and the whole point. */
const TILT = 1.9;

/** A reader that buckets the spectrum into `bars` log-spaced bands, each 0..1.
 *
 *  Log-spaced because linear FFT bins put essentially all of a voice into the
 *  first handful — half the row would never move. Bands are spaced the way
 *  pitch is heard instead, so a voice spreads across the whole width and each
 *  bar has something of its own to say.
 */
export function createSpectrumReader(analyser: AnalyserNode, bars: number) {
  const buffer = new Uint8Array(analyser.frequencyBinCount);
  const nyquist = analyser.context.sampleRate / 2;

  /* Band edges, resolved to bin indices once. Every band gets at least one
     bin, so the low end can't collapse into a single shared bucket. */
  const ranges: { from: number; to: number }[] = [];
  for (let i = 0; i < bars; i += 1) {
    const edge = (n: number) => MIN_HZ * (MAX_HZ / MIN_HZ) ** (n / bars);
    const toBin = (hz: number) =>
      Math.round((hz / nyquist) * analyser.frequencyBinCount);
    const from = Math.min(toBin(edge(i)), analyser.frequencyBinCount - 1);
    const to = Math.max(
      Math.min(toBin(edge(i + 1)), analyser.frequencyBinCount),
      from + 1,
    );
    ranges.push({ from, to });
  }

  return (out: number[]) => {
    analyser.getByteFrequencyData(buffer);
    for (let i = 0; i < bars; i += 1) {
      const { from, to } = ranges[i];
      /* Peak, not mean: a mean over a wide top band washes a consonant out
         into nothing, and the peak is what the ear picked out anyway. */
      let peak = 0;
      for (let bin = from; bin < to; bin += 1) {
        if (buffer[bin] > peak) peak = buffer[bin];
      }
      const tilted = (peak / 255) * (1 + (i / bars) * TILT);
      out[i] = Math.min(1, tilted);
    }
    return out;
  };
}

/* The peak a recording has to clear before we believe it contains speech.
   Room tone and fan noise sit around 0.005–0.01; a voice at arm's length
   peaks well past 0.05. Below this the clip is silence, and silence is the
   one input Whisper reliably lies about — feed it a quiet room and it hands
   back "Thank you." with total confidence. Better to say we heard nothing. */
export const SPEECH_PEAK_FLOOR = 0.02;
