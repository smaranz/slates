/**
 * Seed data ported from the Slates design file. Used until the extension
 * reports a real sync, so the portal is fully explorable before you install it.
 */

import type {
  Assignment,
  Course,
  GradeCategory,
  HistoryPoint,
  Message,
  SyncSnapshot,
} from "./types";

export const DEMO_COURSES: Course[] = [
  { id: "apbio", name: "AP Biology", short: "AP Bio", period: "Period 2", grade: "88%", pct: 88, letter: "B+", trend: "+2.1", tone: "success", dot: "oklch(0.72 0.13 145)", url: "#" },
  { id: "apush", name: "AP US History", short: "APUSH", period: "Period 4", grade: "91%", pct: 91, letter: "A-", trend: "+0.4", tone: "warning", dot: "oklch(0.76 0.13 75)", url: "#" },
  { id: "calc", name: "Calculus BC", short: "Calc BC", period: "Period 1", grade: "79%", pct: 79, letter: "C+", trend: "-3.6", tone: "speed", dot: "oklch(0.72 0.14 250)", url: "#" },
  { id: "eng", name: "English 11", short: "English", period: "Period 6", grade: "94%", pct: 94, letter: "A", trend: "+1.2", tone: "premium", dot: "oklch(0.72 0.14 300)", url: "#" },
  { id: "span", name: "Spanish III", short: "Spanish", period: "Period 7", grade: "85%", pct: 85, letter: "B", trend: "0.0", tone: "secondary", dot: "oklch(0.72 0 0)", url: "#" },
];

export const DEMO_ASSIGNMENTS: Assignment[] = [
  {
    id: "t1", courseId: "calc", kind: "assignment", submit: "native",
    title: "Unit 6 problem set — series convergence",
    bucket: "tonight", minutes: 75, impact: "high",
    due: "Due tomorrow, 8:00 AM", code: "CALC-114", dateOffset: 1, start: "7:10 PM",
    impactNote: "Worth 12% of the quarter — your lowest grade moves most here.",
    brief: "Solve problems 1–14 from the series convergence packet. Show your work for the ratio and integral tests — answers alone won't get full credit.",
    url: "#", comments: [{ from: "Mr. Alvarez", text: "Show your work for the ratio test — no credit for answer-only.", time: "Yesterday" }],
  },
  {
    id: "t2", courseId: "apbio", kind: "assignment", submit: "native",
    title: "Lab writeup: enzyme rates",
    bucket: "tonight", minutes: 45, impact: "high",
    due: "Due tomorrow, 11:59 PM", code: "BIO-231", dateOffset: 1,
    impactNote: "Last lab of the unit; missing it drops you a letter grade.",
    brief: "Write up Tuesday's enzyme rate lab: hypothesis, data table, graph, and a short discussion tying your results back to temperature and pH.",
    url: "#", comments: [{ from: "Dr. Nakamura", text: "Don't forget to include your control group data in the table.", time: "2 days ago" }],
  },
  {
    id: "t3", courseId: "apush", kind: "assignment", submit: "native",
    title: "Read Ch. 14 + margin notes",
    bucket: "tonight", minutes: 40, impact: "medium",
    due: "Due Thursday", code: "USH-088", dateOffset: 3,
    impactNote: "Reading checks are 5% — worth doing, not worth an hour.",
    brief: "Read Chapter 14 and add margin notes on at least 8 key terms. Bring your annotated copy to Thursday's discussion.",
    url: "#",
  },
  {
    id: "t4", courseId: "span", kind: "assessment", submit: "overlay",
    title: "Vocab set 9 quiz",
    bucket: "tonight", minutes: 20, impact: "low",
    due: "Quiz Friday", code: "SPN-045", dateOffset: 4,
    impactNote: "Timed assessment — opens in Schoology with your Slates timer on top.",
    brief: "20-question vocabulary assessment covering Set 9. One attempt, 15 minute limit.",
    url: "#", timeLimitMin: 15, attemptsUsed: 0, attemptsAllowed: 1, resumable: true,
  },
  {
    id: "t5", courseId: "eng", kind: "drive", submit: "overlay",
    title: "Rough draft — Gatsby essay",
    bucket: "soon", minutes: 90, impact: "high",
    due: "Due Thursday, 8:00 AM", code: "ENG-160", dateOffset: 3,
    impactNote: "Google Docs assignment — Slates tracks the doc, Schoology owns the handoff.",
    brief: "Submit a full rough draft of your Gatsby analysis, 800–1000 words with a clear thesis. Peer review is Thursday, so it needs to be complete.",
    url: "#",
  },
  {
    id: "t6", courseId: "apbio", kind: "assignment", submit: "native",
    title: "Free response practice #4",
    bucket: "soon", minutes: 35, impact: "medium",
    due: "Due Wednesday", code: "BIO-236", dateOffset: 2,
    brief: "Complete FRQ set 4 under timed conditions (35 min) and submit your written responses.",
    url: "#",
  },
  {
    id: "t7", courseId: "apush", kind: "assignment", submit: "native",
    title: "DBQ outline — Reconstruction",
    bucket: "week", minutes: 60, impact: "high",
    due: "Due Monday", code: "USH-092", dateOffset: 7,
    brief: "Outline your Reconstruction DBQ: thesis, contextualization, and at least 3 documents per body paragraph.",
    url: "#",
  },
  {
    id: "t8", courseId: "calc", kind: "assignment", submit: "native",
    title: "Unit 6 test corrections",
    bucket: "week", minutes: 50, impact: "medium",
    due: "Due Friday", code: "CALC-118", dateOffset: 4,
    brief: "Redo up to 3 missed problems from the Unit 6 test for half credit back. Show full work for each.",
    url: "#",
  },
  {
    id: "t9", courseId: "span", kind: "assignment", submit: "native",
    title: "Oral presentation slides",
    bucket: "week", minutes: 45, impact: "low",
    due: "Due next Tuesday", code: "SPN-051", dateOffset: 8,
    brief: "Build your presentation slides (5–8 slides) for the oral unit. Upload the deck before your assigned slot.",
    url: "#",
  },
  {
    id: "t10", courseId: "eng", kind: "assignment", submit: "native",
    title: "Annotated bibliography",
    bucket: "done", minutes: 40, impact: "medium",
    due: "Turned in Monday", code: "ENG-155", dateOffset: -6,
    brief: "Annotated bibliography with 5 sources for the Gatsby unit.",
    url: "#",
    grade: { earned: 23, possible: 25, feedback: "Well organized and properly cited — add page numbers for print sources next time." },
  },
  {
    id: "t11", courseId: "apbio", kind: "assignment", submit: "native",
    title: "Cell respiration diagram",
    bucket: "done", minutes: 25, impact: "low",
    due: "Turned in Sunday", code: "BIO-229", dateOffset: -7,
    brief: "Labeled diagram of the cell respiration pathway.",
    url: "#",
    grade: { earned: 9, possible: 10, feedback: "Clear diagram. Label each step of the electron transport chain for full credit next time." },
  },
];

export const DEMO_GRADEBOOK: Record<string, GradeCategory[]> = {
  apbio: [
    { cat: "Labs", weight: 40, earned: 178, possible: 200, items: [{ name: "Enzyme rates lab", score: "44/50", date: "Apr 2" }, { name: "Osmosis lab", score: "48/50", date: "Mar 24" }] },
    { cat: "Tests", weight: 40, earned: 141, possible: 165, items: [{ name: "Unit 5 test", score: "86/100", date: "Mar 28" }, { name: "Unit 4 test", score: "55/65", date: "Mar 6" }] },
    { cat: "Homework", weight: 20, earned: 92, possible: 95, items: [{ name: "Ch. 9 reading guide", score: "20/20", date: "Apr 4" }] },
  ],
  apush: [
    { cat: "Essays", weight: 45, earned: 82, possible: 90, items: [{ name: "DBQ: Gilded Age", score: "6/7", date: "Mar 30" }, { name: "LEQ: Civil War", score: "5/6", date: "Mar 12" }] },
    { cat: "Tests", weight: 35, earned: 128, possible: 140, items: [{ name: "Unit 5 exam", score: "64/70", date: "Mar 26" }] },
    { cat: "Reading checks", weight: 20, earned: 44, possible: 50, items: [{ name: "Ch. 13 check", score: "8/10", date: "Apr 3" }] },
  ],
  calc: [
    { cat: "Tests", weight: 60, earned: 212, possible: 285, items: [{ name: "Unit 6 test", score: "62/95", date: "Apr 1" }, { name: "Unit 5 test", score: "78/95", date: "Mar 14" }] },
    { cat: "Problem sets", weight: 25, earned: 118, possible: 130, items: [{ name: "PS 11 — series", score: "22/25", date: "Apr 4" }] },
    { cat: "Quizzes", weight: 15, earned: 51, possible: 60, items: [{ name: "Convergence quiz", score: "17/20", date: "Mar 29" }] },
  ],
  eng: [
    { cat: "Essays", weight: 50, earned: 94, possible: 100, items: [{ name: "Gatsby analysis", score: "47/50", date: "Mar 27" }] },
    { cat: "Participation", weight: 25, earned: 48, possible: 50, items: [{ name: "Socratic seminar", score: "24/25", date: "Apr 2" }] },
    { cat: "Reading", weight: 25, earned: 71, possible: 75, items: [{ name: "Annotated bibliography", score: "23/25", date: "Mar 31" }] },
  ],
  span: [
    { cat: "Exams", weight: 40, earned: 132, possible: 160, items: [{ name: "Unit 8 exam", score: "68/80", date: "Mar 25" }] },
    { cat: "Speaking", weight: 35, earned: 63, possible: 70, items: [{ name: "Oral interview", score: "31/35", date: "Apr 1" }] },
    { cat: "Vocab quizzes", weight: 25, earned: 42, possible: 50, items: [{ name: "Set 8 quiz", score: "17/20", date: "Mar 28" }] },
  ],
};

export const DEMO_HISTORY: Record<string, HistoryPoint[]> = {
  apbio: [{ d: "Feb 3", v: 84 }, { d: "Feb 21", v: 86 }, { d: "Mar 6", v: 85 }, { d: "Mar 24", v: 87 }, { d: "Apr 4", v: 88 }],
  apush: [{ d: "Feb 3", v: 89 }, { d: "Feb 21", v: 92 }, { d: "Mar 6", v: 90 }, { d: "Mar 26", v: 91 }, { d: "Apr 3", v: 91 }],
  calc: [{ d: "Feb 3", v: 86 }, { d: "Feb 21", v: 84 }, { d: "Mar 14", v: 83 }, { d: "Apr 1", v: 80 }, { d: "Apr 4", v: 79 }],
  eng: [{ d: "Feb 3", v: 91 }, { d: "Feb 21", v: 92 }, { d: "Mar 10", v: 93 }, { d: "Mar 27", v: 93 }, { d: "Apr 2", v: 94 }],
  span: [{ d: "Feb 3", v: 85 }, { d: "Feb 21", v: 87 }, { d: "Mar 12", v: 84 }, { d: "Mar 28", v: 85 }, { d: "Apr 1", v: 85 }],
};

export const DEMO_MESSAGES: Message[] = [
  { id: "msg1", from: "Mr. Alvarez", courseId: "calc", subject: "Unit 6 test corrections available", body: "You can redo up to 3 problems for half credit back. Corrections are due by Friday — stop by during office hours if you want to talk through the series convergence tests first.", time: "9:12 AM", unread: true },
  { id: "msg2", from: "Ms. Whitfield", courseId: "eng", subject: "Great work on your Gatsby draft", body: "Your thesis is sharp — tighten the second body paragraph and you're in great shape for the final draft. Bring a printed copy to Thursday's peer review.", time: "Yesterday", unread: true },
  { id: "msg3", from: "Dr. Nakamura", courseId: "apbio", subject: "Lab makeup slot open", body: "If you missed Tuesday's enzyme lab, there's a makeup slot Thursday at lunch. Reply to reserve a spot — space is limited to 6 students.", time: "Yesterday", unread: false },
  { id: "msg4", from: "Mrs. Douglas", courseId: "apush", subject: "DBQ rubric updated", body: "I've posted an updated rubric for the Reconstruction DBQ with clearer point breakdowns for the contextualization and evidence rows.", time: "Monday", unread: false },
  { id: "msg5", from: "Señora Petit", courseId: "span", subject: "Oral presentation sign-ups", body: "Sign up for your presentation slot by Friday. First-come first-served for the earlier dates if you'd rather get it done early.", time: "Monday", unread: false },
];

export const DEMO_SNAPSHOT: SyncSnapshot = {
  domain: "demo.schoology.com",
  courses: DEMO_COURSES,
  assignments: DEMO_ASSIGNMENTS,
  gradebook: DEMO_GRADEBOOK,
  courseGrades: {},
  history: DEMO_HISTORY,
  messages: DEMO_MESSAGES,
  syncedAt: 0,
};

export const IMPACT_LABEL = {
  high: { label: "High impact", tone: "warning" },
  medium: { label: "Some impact", tone: "secondary" },
  low: { label: "Low impact", tone: "outline" },
} as const;

/**
 * Starting state before anything has synced.
 *
 * Deliberately empty rather than sample data: fabricated assignments are
 * indistinguishable from real ones at a glance, so showing them on load
 * misrepresents what Slates actually knows.
 */
export const EMPTY_SNAPSHOT: SyncSnapshot = {
  domain: "",
  courses: [],
  assignments: [],
  gradebook: {},
  courseGrades: {},
  history: {},
  messages: [],
  syncedAt: 0,
};
