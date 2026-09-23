import type { Essay } from "./counselor/types";
import { fmtMinutes } from "./format";
import type { useStore } from "./store";

type Store = ReturnType<typeof useStore>;

/**
 * `@`-mentions in the tutor composer.
 *
 * The tutor already receives the whole board with every message, so this is
 * not about handing it data it lacks — it is about pointing. "How do I start
 * this?" against forty assignments is a guess; "how do I start @Lab 4?" is a
 * question. A mention says which one, and the answer stops opening with a
 * paragraph asking which class you mean.
 *
 * Two things a mention does add. An essay's actual draft is not in the board
 * context at all, so mentioning one is the only way the tutor can read what
 * you wrote. And a mention carries the assignment id, which is what the
 * board-action tools target — see lib/tutor-actions.ts.
 */

export type MentionKind = "class" | "assignment" | "essay" | "material";

export interface Mention {
  kind: MentionKind;
  /** Course id, assignment id, essay id; for a material, its Schoology URL. */
  id: string;
  /** What the chip and the inserted token read as. */
  label: string;
  /** The line under the label in the picker: a course, a due date, a word count. */
  detail?: string;
  /**
   * The course's colour, the same `dot` the board, grades and calendar use.
   * Carried on the mention rather than looked up at render time so a chip on
   * an old turn keeps its colour even if the class is gone from the snapshot.
   */
  color?: string;
  /** Finished work. Still mentionable — "how did I do on X" is a real question. */
  done?: boolean;
}

export const MENTION_KIND_LABEL: Record<MentionKind, string> = {
  class: "Classes",
  assignment: "Assignments",
  essay: "Essays",
  material: "Materials",
};

/** A material the picker has learned about, keyed by the course it came from. */
export interface MaterialHint {
  courseId: string;
  title: string;
  url: string;
  kind: string;
}

/**
 * Everything mentionable, in the order a student would expect to find it.
 *
 * Assignments come first and are sorted by how soon they matter, because that
 * is what "@" is reached for nine times in ten. Classes and essays follow;
 * materials come last because they are the least often the subject and the
 * most numerous.
 */
export function mentionCandidates(
  s: Store,
  essays: Essay[],
  materials: MaterialHint[] = []
): Mention[] {
  const out: Mention[] = [];

  /*
   * Open work first, then what's finished. Both are mentionable: "how did I do
   * on the last test" and "what did I get marked down for" are asked about
   * completed work constantly, and a picker that only offers what's still due
   * answers neither.
   */
  const open = s.snapshot.assignments.filter((a) => s.statusOf(a) !== "done");
  const done = s.snapshot.assignments.filter((a) => s.statusOf(a) === "done");

  for (const a of [...open, ...done]) {
    const course = s.courseById(a.courseId);
    const finished = s.statusOf(a) === "done";
    out.push({
      kind: "assignment",
      id: a.id,
      label: a.title,
      // `a.due` is already a human phrase — "Due Friday…", "13 days overdue" —
      // so prefixing it produced "due Due Friday".
      detail: [
        course?.short,
        finished ? (a.grade ? `${a.grade.earned}/${a.grade.possible}` : "done") : a.due || null,
      ]
        .filter(Boolean)
        .join(" · "),
      color: course?.dot,
      done: finished,
    });
  }

  for (const c of s.snapshot.courses) {
    out.push({
      kind: "class",
      id: c.id,
      label: c.name,
      detail: [c.short, `period ${c.period}`, c.grade].filter(Boolean).join(" · "),
      color: c.dot,
    });
  }

  for (const e of essays) {
    const words = e.content.trim() ? e.content.trim().split(/\s+/).length : 0;
    out.push({
      kind: "essay",
      id: e.id,
      label: e.title,
      detail: [e.collegeName, `${words}${e.wordLimit ? `/${e.wordLimit}` : ""} words`]
        .filter(Boolean)
        .join(" · "),
    });
  }

  for (const m of materials) {
    const course = s.courseById(m.courseId);
    out.push({
      kind: "material",
      id: m.url,
      label: m.title,
      detail: [course?.short, m.kind].filter(Boolean).join(" · "),
      color: course?.dot,
    });
  }

  return out;
}

/**
 * Matching what was typed after the `@`.
 *
 * Subsequence matching on purpose — "lab4" should find "Lab 4: Titration",
 * and a student who remembers three letters of a title should not have to
 * remember which three were consecutive. Earlier matches rank first so a
 * prefix still wins, and the pre-sorted order breaks ties, which keeps the
 * soonest-due assignment at the top of an empty query.
 */
export function searchMentions(all: Mention[], query: string, limit = 8): Mention[] {
  const q = query.trim().toLowerCase();

  /*
   * An empty query is someone who has just pressed `@` and wants to see what
   * is attachable. Taking the first eight of a pre-sorted list showed eight
   * assignments and hid every class and essay behind a filter they had no
   * reason to guess, so each kind gets a share of the space instead.
   */
  if (!q) {
    /*
     * Shares per kind, and one of the assignment slots is held for finished
     * work. Without that reservation the list is filled by open work — it is
     * sorted that way — and a student who wanted to ask about the test they
     * just got back sees no sign that finished work can be mentioned at all.
     */
    const share: Record<MentionKind, number> = { assignment: 3, class: 2, essay: 2, material: 1 };
    const taken: Record<MentionKind, number> = { assignment: 0, class: 0, essay: 0, material: 0 };

    const picked = new Set<Mention>();
    for (const m of all) {
      if (m.kind === "assignment" && m.done) continue;
      if (taken[m.kind] >= share[m.kind]) continue;
      taken[m.kind] += 1;
      picked.add(m);
    }
    for (const m of all) {
      if (picked.size >= limit) break;
      if (m.kind === "assignment" && m.done) {
        picked.add(m);
        break;
      }
    }

    // Back into the canonical order so the groups stay contiguous.
    return all.filter((m) => picked.has(m)).slice(0, limit);
  }

  const scored: { mention: Mention; score: number }[] = [];

  for (const mention of all) {
    const label = mention.label.toLowerCase();
    const detail = (mention.detail ?? "").toLowerCase();

    /*
     * What the student typed is almost always the start of a word in the
     * title, so that ranks first, then anywhere in the title, then the detail
     * — a course code or a due date. Subsequence matching comes last and only
     * because "lab4" should still find "Lab 4: Titration"; scored on its own
     * it floats junk to the top, which is how a done Spanish quiz beat the
     * vocab quiz that was actually being asked about.
     */
    const labelAt = label.indexOf(q);
    const wordStart = labelAt === 0 || (labelAt > 0 && /[\s\-—:.,(/]/.test(label[labelAt - 1] ?? ""));

    if (labelAt !== -1) {
      scored.push({ mention, score: (wordStart ? 0 : 100) + labelAt });
      continue;
    }

    const detailAt = detail.indexOf(q);
    if (detailAt !== -1) {
      scored.push({ mention, score: 300 + detailAt });
      continue;
    }

    let at = -1;
    let ok = true;
    for (const ch of q) {
      at = label.indexOf(ch, at + 1);
      if (at === -1) {
        ok = false;
        break;
      }
    }
    if (ok) scored.push({ mention, score: 600 + at });
  }

  // Stable within a score, so the caller's ordering (soonest work first)
  // still decides ties.
  return scored
    .map((entry, i) => ({ ...entry, i }))
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.mention);
}

/** Truncates without cutting a word in half. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, flat.lastIndexOf(" ", max)).trimEnd()}…`;
}

/**
 * What the model is told about the things that were mentioned.
 *
 * Deliberately verbose where the board context is thin. An essay ships its
 * whole draft — truncated only at a length no student essay reaches — because
 * a tutor asked about an essay it cannot read gives advice about essays in
 * general. A class ships its category weights, since "what do I do to pull
 * this up" is answered by which bucket is worth 60%.
 */
export function buildMentionFocus(s: Store, essays: Essay[], mentions: Mention[]): string {
  if (!mentions.length) return "";

  const lines: string[] = [
    "WHAT THEY POINTED AT",
    "",
    "The student attached these with @ in their message. It is what the question is about —",
    "answer about these specifically, and don't ask them which one they mean.",
    "",
  ];

  for (const mention of mentions) {
    if (mention.kind === "assignment") {
      const a = s.assignmentById(mention.id);
      if (!a) continue;
      const course = s.courseById(a.courseId);
      lines.push(`ASSIGNMENT [${a.id}] ${a.title}`);
      lines.push(
        `  ${course?.name ?? a.courseId} · ${a.kind} · due ${a.due} · status ${s.statusOf(a)} · impact ${a.impact}`
      );
      if (a.brief) lines.push(`  what it is: ${clip(a.brief, 1200)}`);
      for (const at of a.attachments ?? []) {
        lines.push(`  attached ${at.kind}: ${at.title}${at.target ? ` (${at.target})` : ""}`);
      }
      if (a.grade) {
        lines.push(
          `  grade: ${a.grade.earned}/${a.grade.possible}${a.grade.feedback ? ` — ${clip(a.grade.feedback, 400)}` : ""}`
        );
      }
      for (const c of a.comments ?? []) {
        lines.push(`  teacher comment (${c.from ?? "teacher"}): ${clip(c.text, 300)}`);
      }
      const tracked = s.timeTotals[a.id];
      if (tracked) lines.push(`  time tracked: ${fmtMinutes(Math.round(tracked / 60000))}`);
    }

    if (mention.kind === "class") {
      const c = s.courseById(mention.id);
      if (!c) continue;
      lines.push(`CLASS ${c.name} [${c.short}]`);
      lines.push(`  period ${c.period} · grade ${c.grade} (${c.letter}) · trend ${c.trend}`);
      for (const cat of s.snapshot.gradebook[c.id] ?? []) {
        const pct = cat.pct != null ? `${cat.pct.toFixed(1)}%` : cat.letter ?? "ungraded";
        lines.push(`  ${cat.cat} — ${cat.weight}% of the grade — ${pct} (${cat.earned}/${cat.possible} pts)`);
      }
      const openWork = s.snapshot.assignments.filter((a) => a.courseId === c.id && s.statusOf(a) !== "done");
      if (openWork.length) {
        lines.push(`  still open: ${openWork.map((a) => `${a.title} (due ${a.due})`).join("; ")}`);
      }
    }

    if (mention.kind === "essay") {
      const e = essays.find((x) => x.id === mention.id);
      if (!e) continue;
      const words = e.content.trim() ? e.content.trim().split(/\s+/).length : 0;
      lines.push(`ESSAY ${e.title}`);
      lines.push(
        `  ${e.kind}${e.collegeName ? ` for ${e.collegeName}` : ""} · ${words} words${e.wordLimit ? ` of ${e.wordLimit}` : ""}`
      );
      if (e.prompt) lines.push(`  prompt: ${clip(e.prompt, 600)}`);
      if (e.content.trim()) {
        lines.push("  the draft, in full:", "  ---");
        for (const line of clip(e.content, 12_000).split("\n")) lines.push(`  ${line}`);
        lines.push("  ---");
        lines.push(
          "  You may quote a line back and say what is wrong with it. Do not write or rewrite",
          "  their sentences — an essay in your words is not theirs."
        );
      } else {
        lines.push("  nothing written yet — it is an empty draft.");
      }
    }

    if (mention.kind === "material") {
      lines.push(`MATERIAL ${mention.label}`);
      lines.push(`  ${mention.detail ?? ""}`.trimEnd());
      lines.push(`  on Schoology at ${mention.id}`);
      lines.push(
        "  You cannot read this file's contents. Ask what it says if you need it, or work from",
        "  its title and the assignment it belongs to — do not invent what is in it."
      );
    }

    lines.push("");
  }

  return lines.join("\n");
}
