import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

/**
 * Narration, from ElevenLabs.
 *
 * Every clip's length is measured off the file that comes back rather than
 * estimated from the text. Scene timing is built on these numbers — a scene is
 * as long as the sentence spoken over it — so an estimate that drifts by half a
 * second per scene would have the voice running into the next scene by the end.
 */

/** George — ElevenLabs' own documented default voice. Override per install. */
const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL = "eleven_multilingual_v2";
const OUTPUT_FORMAT = "mp3_44100_128";

export class MissingVoiceKeyError extends Error {
  constructor() {
    super(
      "ElevenLabs isn't connected. Add ELEVENLABS_API_KEY to ~/.slates/.env and restart Slates."
    );
    this.name = "MissingVoiceKeyError";
  }
}

export function hasVoiceKey(): boolean {
  return !!process.env.ELEVENLABS_API_KEY;
}

/**
 * One line of narration as an MP3 on disk, plus how long it actually runs.
 *
 * Failures are surfaced with ElevenLabs' own message where there is one — a
 * quota error and a bad voice id are different problems, and "narration
 * failed" sends the student looking in the wrong place.
 */
export async function speak(text: string, file: string): Promise<number> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new MissingVoiceKeyError();

  const voice = process.env.ELEVENLABS_VOICE_ID || DEFAULT_VOICE;
  const model = process.env.ELEVENLABS_MODEL_ID || DEFAULT_MODEL;

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${OUTPUT_FORMAT}`,
    {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: model,
        // Steady and unhurried: this is a tutor explaining something, not a
        // trailer. Left at ElevenLabs' defaults other than a touch more
        // stability, which keeps a long lesson's voice from wandering.
        voice_settings: { stability: 0.6, similarity_boost: 0.75, speed: 1 },
      }),
    }
  );

  if (!res.ok) {
    throw new Error(`ElevenLabs returned ${res.status}: ${await readError(res)}`);
  }

  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, Buffer.from(await res.arrayBuffer()));
  return audioSeconds(file);
}

/** ElevenLabs reports failures as JSON; fall back to raw text for anything else. */
async function readError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { detail?: { message?: string } | string };
    const detail = typeof body.detail === "string" ? body.detail : body.detail?.message;
    return detail || res.statusText;
  } catch {
    return res.statusText;
  }
}

/**
 * Exact duration from ffprobe.
 *
 * ffprobe ships with the ffmpeg that HyperFrames already requires, so this
 * adds no dependency the render didn't already have.
 */
export async function audioSeconds(file: string): Promise<number> {
  const { stdout } = await execFileP("ffprobe", [
    "-v", "error",
    "-show_entries", "format=duration",
    "-of", "csv=p=0",
    file,
  ]);
  const seconds = Number.parseFloat(stdout.trim());
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error(`Couldn't read the length of ${path.basename(file)}.`);
  }
  return seconds;
}
