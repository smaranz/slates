/**
 * Pure text utilities for the counseling library: cleaning, chunking, topic
 * and application-cycle detection. No I/O, so the same code runs in the
 * ingestion script and in retrieval at request time — a chunk is split the
 * same way whether it is being written or looked up.
 */

/* ─────────────────────── cleaning ─────────────────────── */

/** Normalizes extracted document text: whitespace, hyphenation, junk lines. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u200B-\u200D\uFEFF]/g, "")
    .replace(/(\w)-\n(\w)/g, "$1$2") // un-hyphenate line breaks from PDFs
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .replace(/[ \t]{3,}/g, "  ")
    .trim();
}

/** Rough token estimate (~4 chars/token for English prose). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/* ─────────────────────── chunking ─────────────────────── */

export interface Chunk {
  heading: string | null;
  content: string;
}

const MAX_CHUNK_CHARS = 1800; // ~450 tokens
const MIN_CHUNK_CHARS = 200; // drop fragments below this unless they carry a heading
const OVERLAP_CHARS = 180;

/**
 * Splits a document into retrieval-sized chunks.
 * Markdown: heading-aware (sections keep their heading as metadata).
 * Other text: paragraph packing with a small overlap between chunks.
 */
export function chunkDocument(text: string, isMarkdown: boolean): Chunk[] {
  const clean = cleanText(text);
  if (!clean) return [];

  if (isMarkdown) return chunkMarkdown(clean);
  return packParagraphs(splitParagraphs(clean), null);
}

function chunkMarkdown(text: string): Chunk[] {
  const lines = text.split("\n");
  const sections: { heading: string | null; body: string[] }[] = [{ heading: null, body: [] }];

  for (const line of lines) {
    const h = line.match(/^#{1,4}\s+(.+)/);
    if (h) {
      sections.push({ heading: h[1].trim().slice(0, 200), body: [] });
    } else {
      sections[sections.length - 1].body.push(line);
    }
  }

  const chunks: Chunk[] = [];
  for (const section of sections) {
    const body = section.body.join("\n").trim();
    if (!body && !section.heading) continue;
    if (!body) continue;
    chunks.push(...packParagraphs(splitParagraphs(body), section.heading));
  }
  return chunks;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function packParagraphs(paragraphs: string[], heading: string | null): Chunk[] {
  const chunks: Chunk[] = [];
  let current = "";

  const flush = () => {
    const content = current.trim();
    if (content.length >= MIN_CHUNK_CHARS || (heading && content.length > 40)) {
      chunks.push({ heading, content });
    }
    current = "";
  };

  for (const para of paragraphs) {
    // A paragraph larger than the cap gets hard-split on sentence boundaries.
    if (para.length > MAX_CHUNK_CHARS) {
      if (current) flush();
      for (const piece of splitLong(para)) {
        chunks.push({ heading, content: piece });
      }
      continue;
    }
    if (current.length + para.length + 2 > MAX_CHUNK_CHARS) {
      const tail = current.slice(-OVERLAP_CHARS);
      flush();
      current = tail ? tail + "\n" + para : para;
    } else {
      current = current ? current + "\n\n" + para : para;
    }
  }
  if (current) flush();
  return chunks;
}

function splitLong(text: string): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > MAX_CHUNK_CHARS) {
    // Prefer breaking at a sentence end inside the window.
    const window = rest.slice(0, MAX_CHUNK_CHARS);
    const cut = Math.max(window.lastIndexOf(". "), window.lastIndexOf(".\n"), window.lastIndexOf("? "), window.lastIndexOf("! "));
    const at = cut > MAX_CHUNK_CHARS / 2 ? cut + 1 : MAX_CHUNK_CHARS;
    out.push(rest.slice(0, at).trim());
    rest = rest.slice(Math.max(0, at - OVERLAP_CHARS)).trim();
  }
  if (rest) out.push(rest);
  return out.filter((p) => p.length >= MIN_CHUNK_CHARS);
}

/* ─────────────────────── topics ─────────────────────── */

export const KNOWLEDGE_TOPICS = [
  "testing-sat",
  "testing-act",
  "testing-strategy",
  "essays",
  "financial-aid",
  "scholarships",
  "extracurriculars",
  "passion-projects",
  "summer-programs",
  "competitions",
  "admissions-strategy",
  "recommendations",
  "interviews",
  "applications",
  "college-list",
  "majors-careers",
  "study-skills",
  "athletics",
  "arts-portfolio",
  "ap-ib",
  "math",
  "reading-writing",
] as const;

export type KnowledgeTopic = (typeof KNOWLEDGE_TOPICS)[number];

const TOPIC_RULES: Array<{ topic: KnowledgeTopic; patterns: RegExp[] }> = [
  { topic: "testing-sat", patterns: [/\bsat\b/i, /college board/i, /\bpsat\b/i, /bluebook/i, /digital sat/i] },
  { topic: "testing-act", patterns: [/\bact\b(?!ivit)/i] },
  { topic: "testing-strategy", patterns: [/test[- ]optional/i, /superscore/i, /test(ing)? (strategy|timeline|plan)/i, /retake/i] },
  { topic: "essays", patterns: [/essay/i, /personal statement/i, /supplement/i, /\bhook(s)?\b/i, /writing (the|your) college/i, /common app.*(prompt|writing)/i] },
  { topic: "financial-aid", patterns: [/financial aid/i, /\bfafsa\b/i, /css profile/i, /need[- ]based/i, /merit aid/i, /pay(ing)? for college/i, /\befc\b/i, /\bsai\b/i] },
  { topic: "scholarships", patterns: [/scholarship/i] },
  { topic: "extracurriculars", patterns: [/extracurricular/i, /activit(y|ies)/i, /leadership/i, /club(s)?\b/i, /volunteer/i] },
  { topic: "passion-projects", patterns: [/passion project/i, /nonprofit/i, /501\(c\)/i, /start(ing)? a (business|blog|podcast|youtube)/i, /personal brand/i] },
  { topic: "summer-programs", patterns: [/summer program/i, /\brsi\b/i, /pre[- ]college/i, /summer (plan|application)/i] },
  { topic: "competitions", patterns: [/competition/i, /olympiad/i, /science fair/i, /\bisef\b/i, /\bamc\b/i] },
  { topic: "admissions-strategy", patterns: [/admission/i, /acceptance rate/i, /ivy league/i, /holistic/i, /early (action|decision)/i, /demonstrated interest/i, /waitlist/i, /defer/i] },
  { topic: "recommendations", patterns: [/recommendation letter/i, /recommender/i, /brag sheet/i, /counselor letter/i] },
  { topic: "interviews", patterns: [/interview/i] },
  { topic: "applications", patterns: [/common app/i, /coalition/i, /application (platform|checklist|timeline|organizer)/i, /apply(ing)? to college/i] },
  { topic: "college-list", patterns: [/college list/i, /reach.*(target|likely)|safety school/i, /college fair/i, /fly[- ]in/i, /campus visit/i, /liberal arts college/i] },
  { topic: "majors-careers", patterns: [/major(s)?\b/i, /career/i, /pre[- ]med/i, /engineering path/i] },
  { topic: "study-skills", patterns: [/study (strateg|skill|habit)/i, /productivity/i, /time management/i, /metacognitive/i, /learning techniq/i, /second brain/i, /note[- ]taking/i] },
  { topic: "athletics", patterns: [/athletic/i, /recruit/i, /\bncaa\b/i] },
  { topic: "arts-portfolio", patterns: [/portfolio/i, /music school/i, /art school/i, /audition/i] },
  { topic: "ap-ib", patterns: [/\bap\b(?![a-z])/i, /advanced placement/i, /\bib\b(?![a-z])/i, /international baccalaureate/i, /dual enrollment/i] },
  { topic: "math", patterns: [/algebra/i, /geometr/i, /trigonometr/i, /quadratic/i, /polynomial/i, /circle(s)? (answer|no answer)/i, /exponent/i, /linear equation/i] },
  { topic: "reading-writing", patterns: [/reading comprehension/i, /grammar/i, /punctuation/i, /rhetorical/i, /literary analysis/i, /vocab/i] },
];

/**
 * Classifies a document into topics from its filename plus a content sample.
 * Filename matches are weighted heavier than body matches.
 */
export function detectTopics(filename: string, contentSample: string): KnowledgeTopic[] {
  const name = filename.toLowerCase();
  const sample = contentSample.slice(0, 6000);
  const scores = new Map<KnowledgeTopic, number>();

  for (const rule of TOPIC_RULES) {
    let score = 0;
    for (const pattern of rule.patterns) {
      if (pattern.test(name)) score += 3;
      const matches = sample.match(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g"));
      if (matches) score += Math.min(matches.length, 5);
    }
    if (score >= 3) scores.set(rule.topic, score);
  }

  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([topic]) => topic);
}

/* ─────────────────────── application cycle ─────────────────────── */

/**
 * Detects the application cycle/year a document is tied to, if any.
 * Filename years win; otherwise a year prominent in the opening content.
 * Returns null for evergreen content.
 */
export function detectCycleYear(filename: string, contentSample: string): number | null {
  // Underscores are word characters, so normalize them before \b matching
  // ("Admissions in 2026_ Key Insights.pdf").
  const fromName = filename.replace(/_/g, " ").match(/\b(20[2-3]\d)\b/);
  if (fromName) return Number(fromName[1]);

  const head = contentSample.slice(0, 1200);
  const hits = head.match(/\b(20[2-3]\d)\b/g);
  if (!hits) return null;
  // Only treat it as cycle-bound if a year appears repeatedly up front
  // (e.g. "Admissions in 2026") rather than once in passing.
  const counts = new Map<string, number>();
  for (const y of hits) counts.set(y, (counts.get(y) ?? 0) + 1);
  const [year, count] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return count >= 2 ? Number(year) : null;
}

/** The application cycle a student is currently in (fall-start convention). */
export function currentCycleYear(now: Date = new Date()): number {
  // Aug–Dec belongs to the cycle labeled with the following calendar year.
  return now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear();
}
