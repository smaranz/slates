/**
 * The handful of facts the counselor must never get wrong.
 *
 * Everything else it says can come from the library, from research, or from
 * its own judgement. These twelve are different: they are the load-bearing
 * mechanics of the process — how long the SAT is, what ED actually binds you
 * to, when FAFSA opens — and a model that hallucinates one of them sends a
 * student to the wrong test date or into a contract they didn't understand.
 *
 * So they are hard-coded, carry their source, and are stated in the system
 * prompt with an explicit instruction that they beat training data.
 */

export interface VerifiedFact {
  id: string
  category: "sat" | "college" | "financial-aid" | "essay" | "general"
  topic: string
  fact: string
  source: string
  sourceUrl: string
  verifiedDate: string
}

export const VERIFIED_FACTS: VerifiedFact[] = [
  {
    id: "sat-format",
    category: "sat",
    topic: "SAT Format",
    fact: "The digital SAT is 2 hours 14 minutes total. Reading & Writing is 64 minutes (2 modules of 32 minutes each, 54 questions total). Math is 70 minutes (2 modules of 35 minutes each, 44 questions total). Total: 98 questions.",
    source: "College Board",
    sourceUrl: "https://satsuite.collegeboard.org/digital",
    verifiedDate: "2025-06-01",
  },
  {
    id: "sat-scoring",
    category: "sat",
    topic: "SAT Scoring",
    fact: "The digital SAT is scored out of 1600 (800 Reading & Writing + 800 Math). There is no penalty for wrong answers — only correct answers count toward the score.",
    source: "College Board",
    sourceUrl: "https://satsuite.collegeboard.org/digital/score",
    verifiedDate: "2025-06-01",
  },
  {
    id: "sat-module-adaptivity",
    category: "sat",
    topic: "SAT Module Adaptivity",
    fact: "The second module of each section is adaptive — performance on the first module determines the difficulty of the second. A harder second module means you performed well on the first and can score higher.",
    source: "College Board",
    sourceUrl: "https://satsuite.collegeboard.org/digital/test-day/adaptive-testing",
    verifiedDate: "2025-06-01",
  },
  {
    id: "sat-resources",
    category: "sat",
    topic: "Official SAT Resources",
    fact: "Free official SAT prep is available through Khan Academy's Official Digital SAT Prep (khanacademy.org/digital-sat) and College Board's Bluebook app for full-length practice tests.",
    source: "College Board",
    sourceUrl: "https://www.khanacademy.org/digital-sat",
    verifiedDate: "2025-06-01",
  },
  {
    id: "fafsa-deadline",
    category: "financial-aid",
    topic: "FAFSA Deadline",
    fact: "The FAFSA (Free Application for Federal Student Aid) opens on October 1 each year. Some states have priority deadlines as early as November. The federal deadline is June 30 of the academic year.",
    source: "Federal Student Aid",
    sourceUrl: "https://studentaid.gov/apply-for-aid/fafsa",
    verifiedDate: "2025-06-01",
  },
  {
    id: "css-profile",
    category: "financial-aid",
    topic: "CSS Profile",
    fact: "The CSS Profile is a financial aid application used by about 400 colleges and scholarship programs to award non-federal institutional aid. It requires more detailed financial information than FAFSA and costs $25 for the first school, $16 for additional schools.",
    source: "College Board",
    sourceUrl: "https://cssprofile.collegeboard.org",
    verifiedDate: "2025-06-01",
  },
  {
    id: "common-app-essay",
    category: "essay",
    topic: "Common App Essay Length",
    fact: "The Common App personal statement has a 650-word maximum and a minimum of 250 words. The prompt choices for 2025-2026 include 7 options plus a 'topic of your choice' option.",
    source: "Common App",
    sourceUrl: "https://www.commonapp.org/apply/essay-prompts",
    verifiedDate: "2025-06-01",
  },
  {
    id: "college-admissions-factors",
    category: "college",
    topic: "Holistic Admissions Factors",
    fact: "Colleges typically evaluate: 1) Course rigor and GPA, 2) Standardized test scores (if submitted), 3) Extracurricular involvement and leadership, 4) Essays/personal statements, 5) Letters of recommendation, 6) Demonstrated interest (at some schools), 7) Context (background, challenges overcome).",
    source: "NACAC",
    sourceUrl: "https://www.nacacnet.org/advocacy/definitions/",
    verifiedDate: "2025-06-01",
  },
  {
    id: "test-optional",
    category: "college",
    topic: "Test Optional Policy",
    fact: "Many colleges remain test-optional for 2025-2026, meaning SAT/ACT scores are not required but will be considered if submitted. A few schools have returned to requiring scores. Check each college's current policy on their admissions website.",
    source: "FairTest",
    sourceUrl: "https://fairtest.org/test-optional-list/",
    verifiedDate: "2025-06-01",
  },
  {
    id: "early-decision",
    category: "college",
    topic: "Early Decision Binding",
    fact: "Early Decision (ED) is a binding application agreement. If admitted ED, the student must attend that school and withdraw all other applications. ED I deadlines are typically November 1-15, and ED II deadlines are typically January 1-15.",
    source: "Common App",
    sourceUrl: "https://www.commonapp.org/apply/early-decision",
    verifiedDate: "2025-06-01",
  },
  {
    id: "sat-math-domains",
    category: "sat",
    topic: "SAT Math Domains",
    fact: "The digital SAT Math section covers four domains: Algebra (13-15 questions), Advanced Math (13-15 questions), Problem-Solving and Data Analysis (5-7 questions), and Geometry and Trigonometry (5-7 questions).",
    source: "College Board",
    sourceUrl: "https://satsuite.collegeboard.org/digital/test-day/domains",
    verifiedDate: "2025-06-01",
  },
  {
    id: "sat-rw-domains",
    category: "sat",
    topic: "SAT Reading & Writing Domains",
    fact: "The digital SAT Reading & Writing section covers four domains: Craft and Structure (13-15 questions), Information and Ideas (13-15 questions), Standard English Conventions (11-15 questions), and Expression of Ideas (8-12 questions).",
    source: "College Board",
    sourceUrl: "https://satsuite.collegeboard.org/digital/test-day/domains",
    verifiedDate: "2025-06-01",
  },
]

export function findFacts(query: string): VerifiedFact[] {
  const lower = query.toLowerCase()
  return VERIFIED_FACTS.filter(
    (f) =>
      f.fact.toLowerCase().includes(lower) ||
      f.topic.toLowerCase().includes(lower) ||
      f.category.toLowerCase().includes(lower)
  )
}

export function factsForCategory(category: VerifiedFact["category"]): VerifiedFact[] {
  return VERIFIED_FACTS.filter((f) => f.category === category)
}

export function formatFactsForPrompt(facts: VerifiedFact[]): string {
  if (!facts.length) return ""
  return (
    "VERIFIED FACTS (use these instead of your training data when relevant):\n" +
    facts
      .map((f) => `- [${f.category}] ${f.fact} (Source: ${f.source})`)
      .join("\n")
  )
}
