import "server-only";

import fs from "node:fs";
import path from "node:path";

import { experimental_transcribe as transcribe } from "ai";

import { hasSecret, openaiProvider } from "@/lib/ai-usage/clients";
import { noteUsage } from "@/lib/ai-usage/note";
import { readState, UPLOADS_DIR } from "../state";
import { fail, type Fn } from "./types";

/* The composer's mic: Whirl uploads the clip, then asks for its text. Same
   model and key as Slates' own dictation (app/api/transcribe). */

const MODEL = "gpt-4o-mini-transcribe";

export const transcription: Record<string, Fn> = {
  transcribe: async ({ clip }) => {
    if (!hasSecret("openai")) fail("Voice typing needs an OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart.");
    const upload = typeof clip === "string" ? readState().uploads[clip] : undefined;
    if (!upload) fail("That recording didn't arrive. Try again?");
    const audio = fs.readFileSync(path.join(UPLOADS_DIR, upload.file));
    if (!audio.length) fail("Nothing was recorded.");
    const result = await transcribe({ model: openaiProvider().transcription(MODEL), audio: new Uint8Array(audio) });
    noteUsage({ agent: "dictation", model: MODEL, backend: "openai", inputTokens: 0, outputTokens: 0 });
    return { text: result.text.trim() };
  },
};
