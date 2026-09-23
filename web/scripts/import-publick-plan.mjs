#!/usr/bin/env node
/**
 * Bring a Publick plan across into Slates.
 *
 * Publick stored the whole plan as one jsonb blob on `pc_profiles.data`, under
 * `onboardingAnalysis.plan`. Slates' master plan is the same five-part idea
 * with a stricter schema — every recommendation, milestone, college and step
 * carries a stable id so the counselor can revise one without rewriting the
 * document. So this is a translation, not a copy.
 *
 * Two shapes genuinely differ and are worth knowing about:
 *
 *   - Publick's roadmap milestones are bare sentences. Slates wants a title, a
 *     detail and a status, so the first clause becomes the title and the status
 *     is derived from the period's own year against today — a plan written for
 *     "Grade 10 (2025-26)" should not still be telling a student in 2026-27
 *     that those things are upcoming.
 *   - Publick's strategy entries have `how`, where Slates has `impact`. The
 *     text describes what the move does for you, so it lands there rather than
 *     being dropped.
 *
 * Usage:
 *   node scripts/import-publick-plan.mjs <publick-profile.json> [out.json]
 */

import fs from "node:fs";
import path from "node:path";

const [, , inputPath, outputPath = "publick-plan.slates.json"] = process.argv;
if (!inputPath) {
  console.error("usage: import-publick-plan.mjs <publick-profile.json> [out.json]");
  process.exit(1);
}

const profile = JSON.parse(fs.readFileSync(inputPath, "utf8"));
const plan = profile?.onboardingAnalysis?.plan;
if (!plan) {
  console.error("No onboardingAnalysis.plan in that profile.");
  process.exit(1);
}

/** Stable, readable ids — the same input always yields the same id. */
const slug = (prefix, value, index) =>
  `${prefix}-${index}-${String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 32) || "item"}`;

const text = (value, fallback = "—") => {
  const s = typeof value === "string" ? value.trim() : "";
  return s || fallback;
};

const list = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim()) : []);

const RATINGS = new Set(["developing", "competitive", "strong", "distinctive", "unknown"]);
function position(source) {
  const rating = String(source?.rating ?? "").toLowerCase();
  return {
    rating: RATINGS.has(rating) ? rating : "unknown",
    // `detail` is the paragraph; `headline` is a few words and would read as a
    // second title next to the rating that is already displayed large.
    summary: text(source?.detail ?? source?.headline, "No assessment recorded."),
    evidence: list(source?.evidence).slice(0, 8),
  };
}

/**
 * A milestone's status, from the school year its period names.
 *
 * Publick wrote fixed prose with no state on it, so a straight copy would show
 * a student everything as equally pending — including the year they have
 * already finished.
 */
const NOW = new Date();
const CURRENT_SCHOOL_YEAR = NOW.getMonth() >= 6 ? NOW.getFullYear() : NOW.getFullYear() - 1;

/** The student's current grade, which is what the periods are measured against. */
const CURRENT_GRADE = Number(profile?.gradeLevel ?? profile?.grade) || null;

function statusForPeriod(label) {
  const s = String(label);

  /*
   * Grade first, years second.
   *
   * Publick's plan labels this student's tenth-grade year "Grade 10 (2025-26)"
   * while the same profile records them as a tenth grader — the calendar in
   * the prose is a year behind the student it describes. Trusting those years
   * marked the whole of grade 10 as already finished, in green, for someone
   * living through it. The grade number is the thing Publick got right.
   */
  const grade = Number(/grade\s*(\d{1,2})/i.exec(s)?.[1]);
  if (CURRENT_GRADE && Number.isFinite(grade)) {
    if (grade < CURRENT_GRADE) return "past";
    if (grade === CURRENT_GRADE) return "now";
    if (grade === CURRENT_GRADE + 1) return "soon";
    return "later";
  }

  const years = [...s.matchAll(/(20\d{2})/g)].map((m) => Number(m[1]));
  if (years.length === 0) return "later";
  const start = Math.min(...years);
  if (start < CURRENT_SCHOOL_YEAR) return "past";
  if (start === CURRENT_SCHOOL_YEAR) return "now";
  if (start === CURRENT_SCHOOL_YEAR + 1) return "soon";
  return "later";
}

/**
 * "Do X, especially Y." → title "Do X", detail "Especially Y."
 *
 * The detail is the *remainder*, not the whole sentence: repeating the title
 * underneath itself is how the first pass read, and it made every milestone
 * look like a rendering bug. A sentence with no second clause gets no detail
 * at all rather than a duplicate of its own title.
 */
function splitMilestone(sentence) {
  const s = String(sentence).trim();
  const cut = s.search(/[,;:]| — | – /);

  if (cut > 12 && cut < 110) {
    const title = s.slice(0, cut).trim().replace(/[.,;:]$/, "");
    const rest = s
      .slice(cut)
      .replace(/^[\s,;:—–]+/, "")
      .trim();
    const detail = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : "";
    return { title, detail: detail && detail !== title ? detail : "" };
  }

  // One long clause: keep it whole as the title, trimmed at a word boundary.
  if (s.length <= 110) return { title: s.replace(/\.$/, ""), detail: "" };
  const clipped = s.slice(0, 110);
  const lastSpace = clipped.lastIndexOf(" ");
  return { title: `${clipped.slice(0, lastSpace > 40 ? lastSpace : 110).trim()}…`, detail: s };
}

function period(kind, label, focus, milestones, index) {
  const status = statusForPeriod(label);
  return {
    id: slug(kind === "academic-year" ? "year" : "term", label, index),
    kind,
    label: text(label, `Period ${index + 1}`),
    ...(focus ? { focus: text(focus) } : {}),
    milestones: list(milestones)
      .slice(0, 12)
      .map((m, i) => {
        const { title, detail } = splitMilestone(m);
        // The schema wants a non-empty detail, so a one-clause milestone
        // repeats its own sentence rather than inventing filler.
        return { id: slug("ms", title, i), title, detail: detail || title, status };
      }),
  };
}

const recommendation = (area) => (row, i) => ({
  id: slug(area, row?.title, i),
  title: text(row?.title, "Untitled recommendation"),
  why: text(row?.why),
  // Publick's `how`: what the move actually does for you.
  impact: text(row?.how),
  nextAction: text(row?.next),
  timeframe: text(row?.timeline),
  measure: text(row?.measure),
});

const STRATEGY_FROM = {
  courses: "courseStrategy",
  rigor: "rigorStrategy",
  testing: "testingStrategy",
  activities: "extracurricularStrategy",
  leadership: "leadershipStrategy",
  summer: "summerPlan",
  opportunities: "opportunityIdeas",
  community: "communityImpactIdeas",
};

const strategy = Object.fromEntries(
  Object.entries(STRATEGY_FROM).map(([area, key]) => [
    area,
    (Array.isArray(plan[key]) ? plan[key] : []).slice(0, 8).map(recommendation(area)),
  ])
);

const CATEGORIES = new Set(["reach", "target", "likely"]);
const colleges = (Array.isArray(plan.collegeList) ? plan.collegeList : []).slice(0, 24).map((c, i) => {
  const category = String(c?.category ?? "").toLowerCase();
  return {
    id: slug("college", c?.name, i),
    collegeId: typeof c?.collegeId === "string" && c.collegeId ? c.collegeId : null,
    name: text(c?.name, "Unnamed school"),
    category: CATEGORIES.has(category) ? category : "target",
    priority: Math.min(5, Math.max(1, Math.round(Number(c?.priority) || 3))),
    fit: text(c?.whyFit ?? c?.programFit),
    weakness: text(c?.improveToCompete),
    nextAction: text(c?.nextAction),
  };
});

/** Guess a task category from the words, so steps sort into the right bucket. */
const CATEGORY_HINTS = [
  [/essay|personal statement|supplement/i, "essays"],
  [/sat|act|psat|test|exam/i, "testing"],
  [/fafsa|aid|scholarship|cost|budget|tuition/i, "financial-aid"],
  [/apply|application|deadline|common app/i, "applications"],
  [/college|visit|campus|list/i, "college-research"],
  [/club|activity|volunteer|project|competition|internship/i, "activities"],
  [/course|class|grade|gpa|transcript|schedule/i, "academics"],
];

const nextSteps = list(plan.nextSteps)
  .slice(0, 16)
  .map((s, i) => {
    const { title, detail } = splitMilestone(s);
    const category = CATEGORY_HINTS.find(([re]) => re.test(s))?.[1] ?? "personal";
    return { id: slug("step", title, i), title, ...(detail !== title ? { detail } : {}), category };
  });

const content = {
  evaluation: {
    profileSummary: text(plan.profileSummary, "No summary recorded."),
    academic: position(plan.academicPosition),
    extracurricular: position(plan.extracurricularPosition),
    advantages: list(plan.topAdvantages).slice(0, 10),
    risks: list(plan.gapsAndRisks).slice(0, 10),
    intendedMajors: (Array.isArray(plan.intendedMajors) ? plan.intendedMajors : []).slice(0, 8).map((m, i) => ({
      id: slug("major", m?.label, i),
      name: text(m?.label, "Undecided"),
      fit: "promising",
      why: text(m?.detail),
    })),
    careerDirections: (Array.isArray(plan.careerDirections) ? plan.careerDirections : []).slice(0, 8).map((c, i) => ({
      id: slug("career", c?.label, i),
      name: text(c?.label, "Undecided"),
      fit: "explore",
      why: text(c?.detail),
    })),
    narrativeThemes: (Array.isArray(plan.narrativeThemes) ? plan.narrativeThemes : []).slice(0, 6).map((t, i) => ({
      id: slug("theme", t?.theme, i),
      title: text(t?.theme, "Theme"),
      evidence: list(t?.evidence).slice(0, 6),
      direction: [text(t?.description, ""), text(t?.howToStrengthen, "")].filter(Boolean).join(" ") || "—",
    })),
    competitivenessReadout: text(plan.competitivenessReadout, "No readout recorded."),
    improvements: list(plan.whatNeedsToImprove).slice(0, 10),
  },
  roadmap: {
    years: (Array.isArray(plan.yearByYearPlan) ? plan.yearByYearPlan : [])
      .slice(0, 6)
      .map((y, i) => period("academic-year", y?.year, y?.focus, y?.milestones, i)),
    terms: (Array.isArray(plan.semesterPlan) ? plan.semesterPlan : [])
      .slice(0, 12)
      .map((t, i) => period("term", t?.term, undefined, t?.actions, i)),
  },
  strategy,
  projects: {
    ideas: (Array.isArray(plan.passionProjects) ? plan.passionProjects : []).slice(0, 6).map((p, i) => ({
      id: slug("project", p?.name, i),
      title: text(p?.name, "Project"),
      concept: text(p?.concept),
      whyItFits: text(p?.whyItFits),
      firstStep: text(p?.firstMilestone),
      evidenceOfImpact: text(p?.measurableImpact),
    })),
    selectedProjectId: null,
    essayPositioning: list(plan.essayPositioning).slice(0, 8),
  },
  colleges,
  nextSteps,
  missingInfo: list(plan.missingInfo).slice(0, 12),
};

const now = Date.now();
const master = {
  ...content,
  schemaVersion: 1,
  id: "master",
  version: Number(plan.version) || 1,
  generatedAt: now,
  updatedAt: now,
  generator: {
    model: "publick-import",
    dataFingerprint: `publick-v${plan.version ?? 1}`,
    /*
     * The view already says "Built from …", and Publick's basis string starts
     * with those same words and ends in a full stop — so copied verbatim it
     * read "Built from Built from Smaran's intro quiz responses….".
     */
    basis: text(plan.basis, "your Publick plan")
      .replace(/^built from\s+/i, "")
      .replace(/\s*\.\s*$/, ""),
  },
};

fs.writeFileSync(path.resolve(outputPath), JSON.stringify(master, null, 1));

const counts = {
  advantages: content.evaluation.advantages.length,
  risks: content.evaluation.risks.length,
  majors: content.evaluation.intendedMajors.length,
  careers: content.evaluation.careerDirections.length,
  themes: content.evaluation.narrativeThemes.length,
  years: content.roadmap.years.length,
  terms: content.roadmap.terms.length,
  strategy: Object.values(strategy).reduce((a, v) => a + v.length, 0),
  projects: content.projects.ideas.length,
  colleges: content.colleges.length,
  nextSteps: content.nextSteps.length,
  missingInfo: content.missingInfo.length,
};
console.log("wrote", outputPath);
console.log(Object.entries(counts).map(([k, v]) => `${k}:${v}`).join("  "));
