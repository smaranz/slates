import type {
  ChanceBand,
  ChanceFactor,
  ChanceResult,
  College,
  CounselorProfile,
} from "./types";

/**
 * Admit odds, as an honest range.
 *
 * A logistic model over the school's own acceptance rate: the student's test
 * and GPA position inside the middle 50% move the log-odds, rigor / activities
 * / first-gen / round nudge them, and then two clamps keep the answer sane —
 * nobody is a lock at a school that takes 4%, and nobody is at zero either.
 *
 * The output is deliberately a band rather than a number. A point estimate off
 * a dataset this coarse would be false precision, and false precision is the
 * thing that makes a student drop a school they should have applied to.
 */

const logit = (p: number) => Math.log(p / (1 - p));
const expit = (x: number) => 1 / (1 + Math.exp(-x));
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** Rough ACT → SAT concordance. */
export function actToSat(act: number): number {
  const table: Record<number, number> = {
    36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370,
    29: 1340, 28: 1310, 27: 1280, 26: 1240, 25: 1210, 24: 1180, 23: 1140,
    22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890,
  };
  return table[Math.round(act)] ?? 1000;
}

/** The best score on hand as an SAT equivalent, or null when applying test-optional. */
export function effectiveSat(profile: CounselorProfile): number | null {
  if (profile.sat && profile.sat >= 400) return profile.sat;
  if (profile.act && profile.act >= 1) return actToSat(profile.act);
  return null;
}

const RIGOR_ADJ: Record<CounselorProfile["rigor"], number> = {
  low: -0.5,
  medium: 0,
  high: 0.35,
  "very-high": 0.6,
};

/** The best activity dominates; a few more add a little depth on top. */
function ecStrength(profile: CounselorProfile): number {
  if (profile.activities.length === 0) return -0.15;
  const tierVal: Record<number, number> = { 1: 0.9, 2: 0.5, 3: 0.22, 4: 0.07 };
  const sorted = [...profile.activities].sort((a, b) => a.tier - b.tier);
  const best = tierVal[sorted[0].tier] ?? 0.1;
  const depth = Math.min(sorted.length, 5) * 0.04;
  return clamp(best + depth, -0.15, 1.1);
}

function bandFor(p: number): ChanceBand {
  if (p >= 0.65) return "safety";
  if (p >= 0.3) return "match";
  if (p >= 0.12) return "reach";
  return "hard-reach";
}

export function computeChance(
  profile: CounselorProfile,
  college: College,
  round: "ED" | "EA" | "RD" = "RD"
): ChanceResult {
  const acc = clamp(college.acceptanceRate, 0.02, 0.97);

  const sat = effectiveSat(profile);
  const mid = (college.sat25 + college.sat75) / 2;
  const spread = Math.max((college.sat75 - college.sat25) / 2, 30);
  const satEdge = sat == null ? 0 : clamp((sat - mid) / spread, -2.5, 2.5);

  const gpa = profile.gpaUnweighted ?? college.gpaAvg;
  const gpaEdge = clamp((gpa - college.gpaAvg) / 0.25, -2.5, 2.5);

  const rigorAdj = RIGOR_ADJ[profile.rigor];
  const ecAdj = ecStrength(profile);
  const hookAdj = profile.firstGen ? 0.2 : 0;
  const edAdj = round === "RD" ? 0 : Math.log(Math.max(college.edBoost, 1));

  const strength = 0.62 * satEdge + 0.62 * gpaEdge + rigorAdj + ecAdj + hookAdj;

  let p = expit(logit(acc) + 0.95 * strength + edAdj);

  // Honesty clamps. You are never a lock at a school that rejects almost
  // everyone, and never truly at zero at one that doesn't.
  const maxOdds = clamp(acc * 4 + 0.05, 0.16, 0.95);
  const minOdds = Math.max(acc * 0.12, 0.01);
  p = clamp(p, minOdds, maxOdds);

  const band = bandFor(p);

  const widthBase = p < 0.2 ? 0.05 : 0.09;
  const low = Math.round(clamp(p - widthBase, minOdds, 0.97) * 100);
  let high = Math.round(clamp(p + widthBase, 0.02, maxOdds) * 100);
  if (high <= low) high = low + 3;

  const factors = buildFactors(profile, college, { satEdge, gpaEdge, sat, round, gpa });
  return { collegeId: college.id, band, low, high, factors, summary: summarize(college, band, low, high, factors) };
}

function buildFactors(
  profile: CounselorProfile,
  college: College,
  ctx: { satEdge: number; gpaEdge: number; sat: number | null; round: string; gpa: number }
): ChanceFactor[] {
  const f: ChanceFactor[] = [];

  if (ctx.sat == null) {
    f.push({
      label: "Test scores",
      status: "neutral",
      detail: "Test-optional: applying without a score. A score inside this school's range would help.",
    });
  } else {
    const status = ctx.satEdge >= 0.4 ? "strong" : ctx.satEdge <= -0.4 ? "weak" : "neutral";
    f.push({
      label: "Test scores",
      status,
      detail: `Your ${ctx.sat} against a middle 50% of ${college.sat25}–${college.sat75}. ${
        status === "strong"
          ? "Above their median — an asset."
          : status === "weak"
            ? "Below their median. The biggest lever to pull."
            : "Right in their range."
      }`,
    });
  }

  const gStatus = ctx.gpaEdge >= 0.4 ? "strong" : ctx.gpaEdge <= -0.4 ? "weak" : "neutral";
  f.push({
    label: "GPA",
    status: gStatus,
    detail: `Your ${ctx.gpa.toFixed(2)} against an average of about ${college.gpaAvg.toFixed(2)}. ${
      gStatus === "strong"
        ? "Above average here."
        : gStatus === "weak"
          ? "Below average — context and an upward trend matter."
          : "About average for admits."
    }`,
  });

  const rStatus =
    profile.rigor === "very-high" || profile.rigor === "high"
      ? "strong"
      : profile.rigor === "low"
        ? "weak"
        : "neutral";
  f.push({
    label: "Course rigor",
    status: rStatus,
    detail: `${profile.rigor.replace("-", " ")} rigor. Selective schools weigh the hardest schedule you can handle heavily.`,
  });

  const best = [...profile.activities].sort((a, b) => a.tier - b.tier)[0];
  f.push({
    label: "Activities",
    status: !best ? "weak" : best.tier <= 2 ? "strong" : "neutral",
    detail: !best
      ? "No activities listed yet. This is where a clear spike can change the story."
      : best.tier <= 2
        ? `Your strongest activity (${best.name}) reads as a real spike.`
        : "Solid involvement. A standout leadership or impact role would lift this.",
  });

  if (ctx.round !== "RD" && college.edBoost > 1.05) {
    f.push({
      label: "Application round",
      status: "strong",
      detail: `Applying ${ctx.round} meaningfully boosts odds here versus Regular Decision.`,
    });
  }

  if (profile.firstGen) {
    f.push({
      label: "First-generation",
      status: "strong",
      detail: "Many schools weigh first-generation status as context in your favour.",
    });
  }

  return f;
}

function summarize(
  college: College,
  band: ChanceBand,
  low: number,
  high: number,
  factors: ChanceFactor[]
): string {
  const word = { safety: "a safety", match: "a match", reach: "a reach", "hard-reach": "a hard reach" }[band];
  const weak = factors.find((x) => x.status === "weak");
  const lever = weak ? ` Your biggest lever: ${weak.label.toLowerCase()}.` : "";
  return `${college.name} looks like ${word} for you, roughly ${low}–${high}% admit odds.${lever}`;
}

export const BAND_META: Record<ChanceBand, { label: string; color: string }> = {
  safety: { label: "Safety", color: "var(--good)" },
  match: { label: "Match", color: "var(--warn)" },
  reach: { label: "Reach", color: "var(--bad)" },
  "hard-reach": { label: "Hard reach", color: "oklch(0.62 0.19 20)" },
};

export const BAND_ORDER: ChanceBand[] = ["safety", "match", "reach", "hard-reach"];
