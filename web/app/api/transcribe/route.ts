import { openaiProvider, hasSecret } from "@/lib/ai-usage/clients";
import { noteUsage } from "@/lib/ai-usage/note";
import { experimental_transcribe as transcribe } from "ai";

/**
 * Speech to text for the mic button.
 *
 * Dictation used to run on `webkitSpeechRecognition`, which is present in the
 * packaged app and does not work there: Electron ships Chromium without the
 * Google speech backend the API talks to, so `start()` fails immediately with
 * `error: "network"`. The button appeared and did nothing, which is the worst
 * of the three possible states — worse than being absent.
 *
 * So the audio comes here instead. The microphone itself was never the
 * problem; `getUserMedia` works fine in Electron, in the phone's web view and
 * in a browser, which means one path now covers all three rather than one
 * working in Safari and silently failing everywhere else.
 */

/** A minute of speech is a long message; the cap is a guard, not a target. */
const MAX_BYTES = 25 * 1024 * 1024;
const MODEL = "gpt-4o-mini-transcribe";

export const maxDuration = 60;

export async function POST(req: Request) {
  if (!hasSecret("openai")) {
    return Response.json(
      { error: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart." },
      { status: 500 }
    );
  }

  let audio: ArrayBuffer;
  try {
    audio = await req.arrayBuffer();
  } catch {
    return Response.json({ error: "Could not read the recording." }, { status: 400 });
  }

  if (audio.byteLength === 0) {
    return Response.json({ error: "Nothing was recorded." }, { status: 400 });
  }
  if (audio.byteLength > MAX_BYTES) {
    return Response.json({ error: "That recording is too long." }, { status: 413 });
  }

  try {
    const result = await transcribe({
      model: openaiProvider().transcription(MODEL),
      audio: new Uint8Array(audio),
    });
    // Transcription often omits token counts; still record the call.
    noteUsage({
      agent: "dictation",
      model: MODEL,
      backend: "openai",
      inputTokens: 0,
      outputTokens: 0,
    });
    return Response.json({ text: result.text.trim() });
  } catch (err) {
    /*
     * The provider's own wording is the useful one here — an unsupported
     * container and an expired key are different problems for whoever is
     * holding the microphone, and "transcription failed" tells them neither.
     */
    const message = err instanceof Error ? err.message.split("\n")[0] : "Transcription failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}
