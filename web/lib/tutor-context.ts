import { fmtMinutes } from "./format";
import type { useStore } from "./store";

type Store = ReturnType<typeof useStore>;

/** Truncates a long description without cutting mid-word. */
function clip(text: string, max: number): string {
  // One fact per line is the whole shape of this context, so a write-up's own
  // paragraph breaks have to be flattened rather than shipped through.
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, trimmed.lastIndexOf(" ", max)).trimEnd()}…`;
}

/**
 * Everything the tutor can see: every assignment (not just open ones), what
 * each one actually is, submission state, grades, and teacher/student notes.
 * Assignment ids are included so the tutor can target actions at them — see
 * lib/tutor-actions.ts.
 */
export function buildTutorContext(s: Store): string {
  const { courses, assignments, gradebook } = s.snapshot;
  const lines: string[] = [];

  lines.push("COURSES");
  for (const c of courses) {
    const projection = s.projectionFor(c.id);
    const projectionNote =
      projection.pct !== null && Math.round(projection.pct * 10) !== Math.round(c.pct * 10)
        ? ` (projected ${projection.pct.toFixed(1)}%, ${projection.letter}, with your custom scores)`
        : "";
    lines.push(`- ${c.name} [${c.short}], period ${c.period}: ${c.grade} (${c.letter})${projectionNote}`);
    for (const cat of gradebook[c.id] ?? []) {
      const pct = cat.pct != null ? `${cat.pct.toFixed(1)}%` : cat.letter ?? "ungraded";
      lines.push(`    ${cat.cat} (${cat.weight}% of grade): ${pct} — ${cat.earned}/${cat.possible} pts`);
    }
  }

  const myScores = s.customScores;
  if (myScores.length) {
    lines.push("", "YOUR HYPOTHETICAL SCORES (added for grade projections, not real Schoology grades)");
    for (const sc of myScores) {
      const course = s.courseById(sc.courseId);
      lines.push(`- ${sc.name} (${course?.short ?? sc.courseId}, ${sc.cat}): ${sc.earned}/${sc.possible}`);
    }
  }

  lines.push("", "ASSIGNMENTS (id in brackets — use it to target an action)");
  for (const a of assignments) {
    const course = s.courseById(a.courseId);
    const status = s.statusOf(a);
    const bucket = s.bucketOf(a);
    lines.push(
      `[${a.id}] ${a.title} — ${course?.short ?? a.courseId} — ${a.kind} — status:${status} bucket:${bucket} — due:${a.due} — impact:${a.impact}`
    );
    if (a.brief) lines.push(`    what it is: ${clip(a.brief, 240)}`);
    // Work with no write-up is often nothing but its attachment — a Quizlet
    // set, a worksheet — so naming it is the only description there is.
    for (const at of a.attachments ?? []) {
      lines.push(`    attached ${at.kind}: ${at.title}${at.target ? ` (${at.target})` : ""}`);
    }
    if (a.impactNote) lines.push(`    why it matters: ${a.impactNote}`);

    const submittedAt = s.submittedAt[a.id] ?? a.submittedAt;
    if (status === "done") {
      lines.push(`    submitted: ${submittedAt ? `yes, ${submittedAt}` : "yes"}`);
    } else if (a.submit === "none") {
      lines.push("    submission: nothing to hand in — just needs to be done");
    } else if (a.submit === "overlay") {
      lines.push("    submission: happens on the real Schoology page (quiz/assessment/Drive)");
    }

    if (a.grade) {
      lines.push(
        `    grade: ${a.grade.earned}/${a.grade.possible}${a.grade.feedback ? ` — feedback: ${clip(a.grade.feedback, 160)}` : ""}`
      );
    }
    for (const c of a.comments ?? []) {
      lines.push(`    teacher comment (${c.from ?? "teacher"}, ${c.time}): ${clip(c.text, 160)}`);
    }
    for (const c of s.localComments[a.id] ?? []) {
      lines.push(`    your note (${c.time}): ${clip(c.text, 160)}`);
    }

    const tracked = s.timeTotals[a.id];
    if (tracked) lines.push(`    time you've tracked: ${fmtMinutes(Math.round(tracked / 60000))}`);
  }

  return lines.join("\n");
}
