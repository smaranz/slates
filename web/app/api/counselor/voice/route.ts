import { activeApiSecret, hasSecret } from "@/lib/ai-usage/clients";
import { buildCounselorPrompt } from "@/lib/counselor/prompt";
import type { CounselorState } from "@/lib/counselor/types";

/**
 * A key for one voice call.
 *
 * The browser talks straight to OpenAI over WebRTC — audio never passes
 * through Slates — so it needs credentials of its own. This mints an ephemeral
 * client secret scoped to a single session and hands that over instead of the
 * real API key, which stays on this side.
 *
 * The counselor's whole system prompt is baked into the session here rather
 * than sent from the browser, so the call opens already knowing the student.
 */

export const maxDuration = 30;

/** gpt-realtime-2.1-mini: the cheap end of the 2.1 realtime family, and quick to first word. */
const VOICE_MODEL = process.env.SLATES_COUNSELOR_VOICE_MODEL || "gpt-realtime-2.1-mini";

/** Warmer and less newsreader-ish than the default. */
const VOICE = process.env.SLATES_COUNSELOR_VOICE || "cedar";

/**
 * Tools the voice counselor can reach.
 *
 * A deliberately short list. Everything here is fast, unambiguous, and worth
 * doing mid-sentence; anything that needs reading a document back or a long
 * result belongs in the typed conversation, where it can be seen.
 *
 * These execute in the browser against the same local record the chat uses —
 * see VoiceCall.tsx.
 */
const VOICE_TOOLS = [
  {
    type: "function",
    name: "save_memory",
    description:
      "Remember something durable about this student — a goal, a worry, family or money context, a commitment, a win.",
    parameters: {
      type: "object",
      properties: {
        content: { type: "string", description: "One sentence, written as a fact about them." },
        kind: {
          type: "string",
          enum: ["fact", "preference", "goal", "concern", "context", "relationship", "milestone", "other"],
        },
        importance: { type: "integer", description: "1 minor to 5 defining." },
      },
      required: ["content"],
    },
  },
  {
    type: "function",
    name: "create_task",
    description: "Add a concrete next step you and the student just agreed on.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short imperative action." },
        detail: { type: "string" },
        due_date: { type: "string", description: "YYYY-MM-DD, when there is a real deadline." },
      },
      required: ["title"],
    },
  },
  {
    type: "function",
    name: "search_counseling_library",
    description:
      "Search the counseling library — this practice's own written guidance on essays, testing, activities, aid, summer programs, and admissions strategy. Use it before answering any question about HOW to do something. It beats your training data.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What you want to know, in a sentence." },
      },
      required: ["query"],
    },
  },
  {
    type: "function",
    name: "check_chances",
    description: "This student's admit odds at one school, with the factors behind them.",
    parameters: {
      type: "object",
      properties: {
        college: { type: "string", description: "School name, e.g. 'Michigan'." },
        round: { type: "string", enum: ["ED", "EA", "RD"] },
      },
      required: ["college"],
    },
  },
  {
    type: "function",
    name: "update_profile_fact",
    description: "Record a structured fact they just told you: a new score, GPA, major, or dream school.",
    parameters: {
      type: "object",
      properties: {
        field: {
          type: "string",
          enum: ["sat", "act", "gpaUnweighted", "rigor", "intendedMajor", "dreamSchool", "highSchool", "state", "budgetMax", "name"],
        },
        value: { type: "string" },
      },
      required: ["field", "value"],
    },
  },
];

/** Written for the ear: this is the same counselor, but nobody can see a list read aloud. */
const SPOKEN_RULES = `
YOU ARE ON A VOICE CALL. Everything above still holds, with these on top:
- Talk like a person on the phone. Short turns — two or three sentences, then let them back in.
- Never read a list aloud. If you have three options, say the one you'd pick and why, and offer the others only if asked.
- No markdown, no headings, no bullet characters, no URLs. Say "check Michigan's admissions site", not the address.
- Say numbers the way people say them: "about a fourteen-eighty", "roughly one in five".
- If they interrupt you, stop and listen. Don't finish the sentence you were on.
- Open by getting to the point. No "how can I help you today".
- Before answering how to do something — an essay, an ask for a recommendation, a summer plan — search the counseling library. Say what it says in your own words; never read a passage aloud.
- You cannot search the web on a call. For a deadline, a cost, or a current policy, say you'd rather check it than guess, and offer to look it up in the typed conversation.
`;

export async function POST(req: Request) {
  if (!hasSecret("openai")) {
    return Response.json(
      { error: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart." },
      { status: 500 }
    );
  }
  const key = activeApiSecret("openai");
  if (!key) {
    return Response.json(
      { error: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart." },
      { status: 500 }
    );
  }

  let state: CounselorState;
  let schoolContext: string | undefined;
  try {
    const body = (await req.json()) as { state: CounselorState; schoolContext?: string };
    state = body.state;
    schoolContext = body.schoolContext;
  } catch {
    return Response.json({ error: "Bad request" }, { status: 400 });
  }
  if (!state) return Response.json({ error: "Bad request" }, { status: 400 });

  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      session: {
        type: "realtime",
        model: VOICE_MODEL,
        instructions: `${buildCounselorPrompt(state, schoolContext)}\n${SPOKEN_RULES}`,
        tools: VOICE_TOOLS,
        tool_choice: "auto",
        audio: {
          input: {
            // Without this the call is one-way legible: the counselor hears the
            // student but nothing can show what they said.
            transcription: { model: "gpt-4o-mini-transcribe" },
            turn_detection: {
              type: "semantic_vad",
              // A student thinking mid-sentence shouldn't get cut off, so wait
              // for a real end of turn rather than a gap of silence.
              eagerness: "medium",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: VOICE },
        },
      },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return Response.json(
      { error: `Couldn't start a call (${res.status}). ${detail.slice(0, 300)}` },
      { status: 502 }
    );
  }

  const session = (await res.json()) as { value: string; expires_at: number };
  return Response.json({ token: session.value, expiresAt: session.expires_at, model: VOICE_MODEL });
}
