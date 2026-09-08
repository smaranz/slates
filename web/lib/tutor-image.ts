/**
 * An illustration the tutor drew, from ElevenLabs' image flow.
 *
 * Same shape as a pasted attachment: a data URL while the tab that made it
 * is still around, dropped on save the same way `lib/tutor-chats.ts` already
 * drops a pasted image's bytes — the prompt is worth remembering, the bytes
 * aren't worth the storage quota.
 */
export interface TutorImage {
  prompt: string;
  dataUrl: string;
  dropped?: boolean;
}

const MODEL_ID = "gpt-image-2";
const POLL_MS = 1500;
const TIMEOUT_MS = 60_000;

export class MissingImageKeyError extends Error {
  constructor() {
    super("ElevenLabs isn't connected. Add ELEVENLABS_API_KEY to ~/.slates/.env and restart Slates.");
    this.name = "MissingImageKeyError";
  }
}

interface CreateResponse {
  id: string;
}

interface StatusResponse {
  status: "pending" | "generating" | "completed" | "failed";
  content_url?: string;
  content_mime_type?: string;
  error_message?: string;
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
 * One illustration, as a data URL ready to sit on a chat message.
 *
 * ElevenLabs' image flow is async — create, then poll until it lands — but
 * generation itself takes seconds, not the minutes a video render does, so
 * this polls out the wait itself rather than handing the caller a job id to
 * track the way the lesson pipeline has to.
 */
export async function generateTutorImage(prompt: string): Promise<string> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new MissingImageKeyError();

  const createRes = await fetch("https://api.elevenlabs.io/v1/flows/image", {
    method: "POST",
    headers: { "xi-api-key": key, "content-type": "application/json" },
    body: JSON.stringify({
      model_id: MODEL_ID,
      prompt: `${prompt}. Clean educational illustration, no watermarks, no captions unless they're part of a labeled diagram.`,
      aspect_ratio: "1:1",
      quality: "high",
    }),
  });
  if (!createRes.ok) {
    throw new Error(`ElevenLabs returned ${createRes.status}: ${await readError(createRes)}`);
  }
  const { id } = (await createRes.json()) as CreateResponse;

  const deadline = Date.now() + TIMEOUT_MS;
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));

    const statusRes = await fetch(`https://api.elevenlabs.io/v1/flows/image/${encodeURIComponent(id)}`, {
      headers: { "xi-api-key": key },
    });
    if (!statusRes.ok) {
      throw new Error(`ElevenLabs returned ${statusRes.status}: ${await readError(statusRes)}`);
    }
    const body = (await statusRes.json()) as StatusResponse;

    if (body.status === "completed") {
      if (!body.content_url) throw new Error("ElevenLabs reported the image done but sent no file.");
      // The signed URL expires in about an hour — fetched immediately and
      // folded into a data URL rather than handed to the client to chase later.
      const imgRes = await fetch(body.content_url);
      if (!imgRes.ok) throw new Error(`Couldn't download the generated image (${imgRes.status}).`);
      const bytes = Buffer.from(await imgRes.arrayBuffer());
      const mime = body.content_mime_type || imgRes.headers.get("content-type") || "image/png";
      return `data:${mime};base64,${bytes.toString("base64")}`;
    }
    if (body.status === "failed") {
      throw new Error(body.error_message || "Image generation failed.");
    }
    if (Date.now() > deadline) throw new Error("Timed out waiting for the image.");
  }
}
