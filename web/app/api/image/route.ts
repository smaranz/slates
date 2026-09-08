import { generateTutorImage, MissingImageKeyError } from "@/lib/tutor-image";

// ElevenLabs' own generation typically finishes in well under a minute;
// this is headroom, not an expectation.
export const maxDuration = 60;

export async function POST(req: Request) {
  const { prompt } = (await req.json()) as { prompt?: string };
  if (!prompt || !prompt.trim()) {
    return Response.json({ error: "A prompt is required." }, { status: 400 });
  }

  try {
    const dataUrl = await generateTutorImage(prompt.trim());
    return Response.json({ dataUrl });
  } catch (e) {
    if (e instanceof MissingImageKeyError) {
      return Response.json({ error: e.message }, { status: 400 });
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "Couldn't generate that image." },
      { status: 502 }
    );
  }
}
