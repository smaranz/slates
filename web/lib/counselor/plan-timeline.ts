import type { CounselorProfile } from "./types";

export type MilestoneStatus = "later" | "soon" | "now" | "past";

export interface TimelineMilestone {
  key: string;
  label: string;
  action: string;
  whenPhrase: string;
  start: Date;
  end: Date;
  status: MilestoneStatus;
  startLabel: string;
}

const DAY = 24 * 60 * 60 * 1000;
const SOON_LEAD_DAYS = 120;

function seasonLabel(date: Date): string {
  const month = date.getMonth();
  if (month >= 5 && month <= 6) return "Summer";
  if (month >= 7 && month <= 10) return "Fall";
  if (month >= 2 && month <= 4) return "Spring";
  return "Winter";
}

function statusFor(start: Date, end: Date, now: Date): MilestoneStatus {
  if (now.getTime() > end.getTime()) return "past";
  if (now.getTime() >= start.getTime()) return "now";
  if (now.getTime() >= start.getTime() - SOON_LEAD_DAYS * DAY) return "soon";
  return "later";
}

export function studentTimeline(profile: CounselorProfile, now: Date = new Date()): TimelineMilestone[] {
  const graduationYear = profile.applyYear;
  const date = (year: number, month: number, day: number) => new Date(year, month, day);
  const definitions = [
    ["foundation", "Build your foundation", "Protect GPA, choose rigorous courses, and explore activities deeply.", "9th-10th grade", date(graduationYear - 4, 7, 15), date(graduationYear - 2, 5, 15)],
    ["test-prep", "Establish a testing baseline", "Take a diagnostic and begin steady SAT or ACT preparation.", "10th grade", date(graduationYear - 3, 7, 15), date(graduationYear - 2, 7, 15)],
    ["official-testing", "Complete official testing", "Take the SAT or ACT and reserve time for one purposeful retake.", "11th grade through early senior fall", date(graduationYear - 2, 7, 15), date(graduationYear - 1, 10, 15)],
    ["college-list", "Build the college list", "Research fit and assemble a balanced reach, target, and likely list.", "11th grade", date(graduationYear - 2, 7, 15), date(graduationYear - 1, 7, 15)],
    ["recommendations", "Line up recommendations", "Ask teachers who know your work before the senior-fall rush.", "spring of 11th grade", date(graduationYear - 1, 2, 1), date(graduationYear - 1, 8, 15)],
    ["essay-brainstorm", "Develop essay themes", "Reflect on stories and themes without drafting application prose too early.", "spring of 11th grade", date(graduationYear - 1, 2, 1), date(graduationYear - 1, 5, 1)],
    ["main-essay", "Draft the personal statement", "Write and revise the main essay before senior coursework accelerates.", "summer before 12th grade", date(graduationYear - 1, 5, 1), date(graduationYear - 1, 8, 30)],
    ["applications", "Complete applications", "Finish forms and supplements, then submit ahead of each deadline.", "12th-grade fall", date(graduationYear - 1, 7, 15), date(graduationYear, 0, 15)],
    ["financial-aid", "File financial aid forms", "Complete the FAFSA and CSS Profile where required.", "12th-grade fall and winter", date(graduationYear - 1, 9, 1), date(graduationYear, 1, 15)],
    ["decisions", "Compare offers and decide", "Compare admission, aid, cost, and fit before committing.", "spring of 12th grade", date(graduationYear, 2, 1), date(graduationYear, 4, 1)],
  ] as const;

  return definitions.map(([key, label, action, whenPhrase, start, end]) => ({
    key,
    label,
    action,
    whenPhrase,
    start,
    end,
    status: profile.gradeLevel === 13 && key !== "decisions" ? "past" : statusFor(start, end, now),
    startLabel: `${seasonLabel(start)} ${start.getFullYear()}`,
  }));
}

export function formatTimelineForPrompt(profile: CounselorProfile, now: Date = new Date()): string {
  const timeline = studentTimeline(profile, now);
  const format = (status: MilestoneStatus) => timeline
    .filter((milestone) => milestone.status === status)
    .map((milestone) => `${milestone.label} (${milestone.startLabel})`)
    .join("; ") || "none";

  return `TIMING AND PACING (today is ${now.toISOString().slice(0, 10)}):
- Active now: ${format("now")}
- Starting soon: ${format("soon")}
- Not yet: ${format("later")}
- Past or should already be underway: ${format("past")}
Do not assign application essays or application work before its window. For grade 13, prioritize unresolved applications, transfer or gap-year positioning, current academics, and the next viable cycle.`;
}
