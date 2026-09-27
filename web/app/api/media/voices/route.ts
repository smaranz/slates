import { DEFAULT_SPEECH_MODEL, DEFAULT_SPEECH_VOICE } from "@/lib/media/catalog";
import { ElevenLabsError, listVoices, MissingElevenLabsKeyError } from "@/lib/media/elevenlabs";

/** Cache the account voice directory briefly; this endpoint is the studio's connection check. */

export const dynamic = "force-dynamic";

interface VoiceList {
  id: string;
  name: string;
  category: string;
  previewUrl: string | null;
}

let cached: { expiresAt: number; voices: VoiceList[]; defaultModel: string; defaultVoiceId: string } | null = null;
const TTL_MS = 10 * 60_000;

export async function GET() {
  if (cached && cached.expiresAt > Date.now()) {
    return Response.json({ voices: cached.voices, defaultModel: cached.defaultModel, defaultVoiceId: cached.defaultVoiceId });
  }
  try {
    const voices = await listVoices();
    const mapped = voices
      .map((voice) => ({
        id: voice.voice_id,
        name: voice.name,
        category: voice.category ?? "",
        previewUrl: voice.preview_url ?? null,
      }))
      .sort((a, b) => Number(b.id === (process.env.ELEVENLABS_VOICE_ID || DEFAULT_SPEECH_VOICE)) - Number(a.id === (process.env.ELEVENLABS_VOICE_ID || DEFAULT_SPEECH_VOICE)));
    const defaultModel = process.env.ELEVENLABS_MODEL_ID || DEFAULT_SPEECH_MODEL;
    const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || DEFAULT_SPEECH_VOICE;
    cached = { expiresAt: Date.now() + TTL_MS, voices: mapped, defaultModel, defaultVoiceId };
    return Response.json({ voices: mapped, defaultModel, defaultVoiceId });
  } catch (error) {
    const status = error instanceof ElevenLabsError
      ? error.status
      : error instanceof MissingElevenLabsKeyError
        ? 400
        : 500;
    return Response.json({ error: error instanceof Error ? error.message : String(error) }, { status });
  }
}
