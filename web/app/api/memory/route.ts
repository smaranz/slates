import { publish } from "@/lib/agent/hub";
import { skills } from "@/lib/agent/store";
import { editBook, studentBook, tutorBook, viewBook, type Book } from "@/lib/learning/memory";

/**
 * What the helpers remember, for the student to see and correct: the student
 * profile every agent and the tutor share, and the tutor's own notes (each
 * agent's notes are on its details panel, through /api/agent).
 */

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    student: viewBook(studentBook()),
    tutor: viewBook(tutorBook()),
    skills: skills.all().map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, by: skill.by, uses: skill.uses ?? 0, updatedAt: skill.updatedAt })),
  });
}

function book(name: unknown): Book | null {
  return name === "student" ? studentBook() : name === "tutor" ? tutorBook() : null;
}

export async function POST(request: Request) {
  let body: { op?: string; book?: string; id?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const target = book(body.book);
  if (!target) return Response.json({ error: "Unknown memory." }, { status: 404 });
  const id = typeof body.id === "string" ? body.id : "";
  const text = typeof body.text === "string" ? body.text : "";

  const outcome =
    body.op === "forget"
      ? editBook(target, { action: "remove", old_text: id }, "You")
      : body.op === "add"
        ? editBook(target, { action: "add", content: text }, "You")
        : body.op === "edit"
          ? editBook(target, { action: "replace", old_text: id, content: text }, "You")
          : null;
  if (!outcome) return Response.json({ error: "Unknown operation." }, { status: 400 });
  // The whole book, not the model's instructions for making room, when there isn't any.
  if (!outcome.ok) return Response.json({ error: outcome.message.split("\n")[0] }, { status: 400 });
  publish({ kind: "roster" });
  return Response.json({ ok: true, book: viewBook(target) });
}
