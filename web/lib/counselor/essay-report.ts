import type { Essay, EssayReport } from "./types";

/**
 * The report as a document, for the download button.
 *
 * Markdown because the app already turns markdown into a real .docx
 * (lib/tutor-export.ts), so this one function gets both formats. It is written
 * to be read on paper by someone who wasn't at the screen — a teacher, a
 * parent, the student in a week — so every number carries its scale and every
 * quote stays attached to the thing being said about it.
 */

function pct(score: number, max: number): string {
  return `${score}/${max}`;
}

export function reportMarkdown(essay: Essay, report: EssayReport): string {
  const rubricGot = report.rubric.scores.reduce((sum, s) => sum + s.score, 0);
  const rubricMax = report.rubric.scores.reduce((sum, s) => sum + s.max, 0);
  const when = new Date(report.at).toLocaleString([], {
    dateStyle: "long",
    timeStyle: "short",
  });

  const out: string[] = [
    `# ${essay.title}`,
    "",
    `${essay.kind.replace(/-/g, " ")}${essay.collegeName ? ` · ${essay.collegeName}` : ""} · ${report.words} words${essay.wordLimit ? ` of ${essay.wordLimit}` : ""}`,
    `Checked ${when}`,
    "",
    "## The one thing to do next",
    "",
    report.rubric.verdict,
    "",
    "## Scores",
    "",
    `- Rubric: **${pct(rubricGot, rubricMax)}**`,
    `- Line-by-line: **${report.lines.score}/100**`,
  ];

  const meld = report.detection.meld;
  if (meld) {
    out.push(
      `- Reads as machine-written: **${meld.flagged ? "yes — flagged" : "no"}** (score ${meld.score.toFixed(2)} against a ${meld.threshold.toFixed(2)} line)`
    );
  } else {
    out.push(`- Reads as machine-written: not measured (${report.detection.unavailable ?? "detector unavailable"})`);
  }

  out.push("", report.lines.impression, "", "## The rubric, line by line", "");
  for (const s of report.rubric.scores) {
    out.push(`### ${s.criterion} — ${pct(s.score, s.max)}`, "", `> ${s.evidence}`, "", s.fix, "");
  }

  if (report.lines.strengths.length) {
    out.push("## Keep", "");
    for (const x of report.lines.strengths) out.push(`- **${x.title}.** ${x.detail}`);
    out.push("");
  }

  if (report.lines.improvements.length) {
    out.push("## Change", "");
    for (const x of report.lines.improvements) out.push(`- **${x.title}.** ${x.detail}`);
    out.push("");
  }

  if (report.rubric.cuts.length) {
    out.push("## Cut", "");
    for (const x of report.rubric.cuts) out.push(`- "${x}"`);
    out.push("");
  }

  const weak = report.lines.lines.filter((l) => l.verdict === "weak");
  const strong = report.lines.lines.filter((l) => l.verdict === "strong");

  if (weak.length) {
    out.push("## Sentences that need work", "");
    for (const l of weak) {
      out.push(`> ${l.text}`, "", l.note, "");
      l.steps.forEach((step, i) => out.push(`${i + 1}. ${step}`));
      out.push("");
    }
  }

  if (strong.length) {
    out.push("## Sentences carrying the essay", "");
    for (const l of strong) out.push(`> ${l.text}`, "", l.note, "");
  }

  out.push("## How machine-written it sounds", "");
  if (meld) {
    out.push(
      meld.flagged
        ? `MELD scored this draft ${meld.score.toFixed(2)}, above the ${meld.threshold.toFixed(2)} line where 99% of human writing falls below. It read ${meld.tokensRead} tokens${meld.truncated ? " (the draft was longer than it reads)" : ""}.`
        : `MELD scored this draft ${meld.score.toFixed(2)}, below the ${meld.threshold.toFixed(2)} line where 99% of human writing falls. It read ${meld.tokensRead} tokens${meld.truncated ? " (the draft was longer than it reads)" : ""}.`,
      ""
    );
    if (meld.passages.length) {
      out.push("Passages that stand out against the rest of the draft:", "");
      for (const p of meld.passages) out.push(`- (${p.score.toFixed(2)}) "${p.text}"`);
      out.push("");
    } else if (meld.flagged) {
      out.push(
        "No single passage stands out against the rest — the whole draft reads this way, rather than one pasted paragraph inside it.",
        ""
      );
    }
  } else {
    out.push(report.detection.unavailable ?? "The local detector didn't run.", "");
  }

  out.push("What was measured in the prose itself:", "");
  for (const s of report.detection.signals) out.push(`- **${s.label}.** ${s.detail}`);

  out.push(
    "",
    "---",
    "",
    "Advisory, not evidence. No detector can prove who wrote something, and they misfire most often on careful, formal writing — which a college essay is by definition. A high score means the prose reads flat; fix it the way you'd fix any flat paragraph, by putting the specifics back in.",
    ""
  );

  return out.join("\n");
}
