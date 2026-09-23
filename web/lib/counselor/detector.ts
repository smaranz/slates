import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { aiSignals, verdictFor } from "./ai-signals";
import { DETECTOR_PORT, DETECTOR_URL } from "../ports";
import type { AiDetection } from "./types";

/**
 * AI detection, done locally by MELD.
 *
 * No API key, no per-check cost, and — the part that matters for an
 * unpublished personal statement — no network call. The draft is scored by a
 * 400M-parameter detector on this machine and nothing leaves it.
 *
 * MELD takes ~22s to load and ~0.2s to score, so it lives behind the sidecar
 * in `detector/serve.py`, started on first use and kept warm. See that file
 * and `detector/meld.py` for the model itself.
 *
 * Everything here degrades rather than fails: if the detector isn't installed
 * or won't start, the check still returns the local statistics and says, in
 * the report, that the model didn't run. A missing detector must never cost a
 * student their feedback.
 */

const PORT = DETECTOR_PORT;
const BASE = DETECTOR_URL;

/**
 * Both layouts resolve the same way: in dev the server runs from `web/`, and
 * in the packaged app the standalone server runs from `Resources/web/`, with
 * `detector/` beside it either way.
 */
const DIR = path.resolve(process.cwd(), "../detector");
const PYTHON = path.join(os.homedir(), ".slates", "meld", "venv", "bin", "python");

/** What `npm run detector:install` sets up. Checked so the error can say so. */
function installed(): string | null {
  if (!fs.existsSync(PYTHON)) return "The detector isn't installed yet — run `npm run detector:install` in web/.";
  if (!fs.existsSync(path.join(DIR, "serve.py"))) return `Couldn't find the detector at ${DIR}.`;
  if (!fs.existsSync(path.join(os.homedir(), ".slates/meld/model/model.safetensors"))) {
    return "The MELD weights aren't downloaded yet — run `npm run detector:install` in web/.";
  }
  return null;
}

async function health(timeoutMs = 1500): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(timeoutMs) });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Starts the sidecar and waits for it to answer.
 *
 * Detached and unref'd on purpose: the model load is expensive, so it should
 * outlive the request that triggered it and stay warm for the next one.
 */
async function start(): Promise<boolean> {
  spawn(PYTHON, [path.join(DIR, "serve.py")], {
    cwd: DIR,
    detached: true,
    stdio: "ignore",
    env: { ...process.env, SLATES_DETECTOR_PORT: String(PORT) },
  }).unref();

  // The 1.6GB load is the wait here, not the server.
  for (let i = 0; i < 45; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await health()) return true;
  }
  return false;
}

interface Scored {
  p: number;
  score: number;
  threshold: number;
  flagged: boolean;
  tokens_read: number;
  truncated: boolean;
  sentences: { text: string; start: number; end: number; score: number }[];
}

/**
 * The AI read of a draft: the local statistics always, and MELD when it runs.
 *
 * The two answer different questions and are both worth having. MELD says how
 * machine-like the prose is against a calibrated threshold; the statistics say
 * *what about it* reads that way — rhythm, concrete detail, contractions — in
 * numbers the student can argue with and act on.
 */
export async function detect(text: string): Promise<AiDetection> {
  const { signals, score: localScore } = aiSignals(text);
  const base = { signals, localScore, verdict: verdictFor(localScore) };

  const missing = installed();
  if (missing) return { ...base, unavailable: missing };

  try {
    if (!(await health()) && !(await start())) {
      return { ...base, unavailable: "The local detector wouldn't start. The statistics below still stand." };
    }

    const res = await fetch(`${BASE}/score`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      return { ...base, unavailable: body.error ?? `The detector answered ${res.status}.` };
    }

    const s = (await res.json()) as Scored;

    /*
     * Which sentences are worth naming.
     *
     * Not the highest-scoring ones: in a clean draft the top three are simply
     * the three most ordinary sentences. And not everything over the document
     * threshold either — that number is calibrated for whole documents, so on
     * a draft with one pasted paragraph it also catches several of the
     * student's own sentences sitting just above it. Tested on exactly that
     * case it listed two pasted sentences and three real ones, which is a
     * false accusation about a person's own writing.
     *
     * So a sentence has to clear the document threshold *and* stand out
     * against this draft's own level. When a draft is flagged and nothing
     * clears that, the honest reading is that it isn't one passage — the whole
     * thing reads that way, and the report says so instead of listing lines.
     */
    const cut = Math.max(s.threshold, s.score + 0.5);
    const passages = s.sentences
      .filter((x) => x.score > cut)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map((x) => ({ text: x.text, score: x.score }));

    return {
      ...base,
      meld: {
        score: s.score,
        threshold: s.threshold,
        flagged: s.flagged,
        probability: s.p,
        tokensRead: s.tokens_read,
        truncated: s.truncated,
        passages,
        // Every sentence, in the order it was written, carrying the same
        // judgement `passages` applied. The AI page shows the whole draft
        // marked up; naming only the worst six leaves a reader assuming
        // everything unnamed was checked and cleared, which is true, but
        // invisible.
        lines: s.sentences.map((x) => ({ text: x.text, score: x.score, over: x.score > cut })),
        sentenceCut: cut,
      },
    };
  } catch (err) {
    return {
      ...base,
      unavailable: err instanceof Error ? err.message : "The local detector didn't answer.",
    };
  }
}
