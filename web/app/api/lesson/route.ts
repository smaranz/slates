import type { NextRequest } from "next/server";

import { cancelLesson, listLessons, readLessonStatus, startLesson } from "@/lib/lesson/job";
import { MissingVoiceKeyError } from "@/lib/lesson/voice";

/**
 * Teaching videos: start one, or ask how one is getting on.
 *
 * Starting returns as soon as the job is on disk — a render runs for minutes,
 * far past any sensible request timeout — and the tutor polls the status here
 * until the video is ready.
 */
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  let body: { topic?: string; context?: string; images?: boolean };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  const topic = String(body.topic ?? "").trim();
  if (!topic) return Response.json({ error: "No topic to teach." }, { status: 400 });

  try {
    return Response.json(
      await startLesson({
        // The topic reaches a prompt and a status line, never a shell or a
        // path, but it is still capped — the tutor writes it, and a runaway
        // tag shouldn't turn into an unbounded prompt.
        topic: topic.slice(0, 300),
        context: body.context?.slice(0, 20_000),
        images: body.images === true,
      })
    );
  } catch (e) {
    // A missing key is a setup problem with a clear fix, not a server fault.
    if (e instanceof MissingVoiceKeyError) {
      return Response.json({ error: e.message }, { status: 503 });
    }
    return Response.json(
      { error: e instanceof Error ? e.message : "Couldn't start that video." },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return Response.json({ lessons: await listLessons() });

  const status = await readLessonStatus(id);
  if (!status) return Response.json({ error: "No such video." }, { status: 404 });
  return Response.json(status);
}

/**
 * Stop a lesson that's still being built.
 *
 * The tutor stays occupied for the whole build, so this is the way out of it.
 * Already-finished lessons report `stopped: false` rather than an error —
 * pressing stop as the render lands is a race, not a mistake.
 */
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id") ?? "";
  return Response.json({ stopped: cancelLesson(id) });
}
