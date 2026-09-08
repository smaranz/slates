import type { College } from "./types";

/**
 * The schools the chance engine knows about.
 *
 * Figures are approximate — rounded from publicly reported Common Data Set /
 * IPEDS-style summaries. They are estimates for reasoning about fit, not
 * guarantees, and Slates is not affiliated with any of these schools.
 */
export const COLLEGES: College[] = [
  { id: "mit", name: "MIT", city: "Cambridge", state: "MA", type: "private", acceptanceRate: 0.04, sat25: 1520, sat75: 1580, gpaAvg: 3.96, edBoost: 1.0, size: "medium", setting: "urban", costPerYear: 82000, topMajors: ["Computer Science", "Engineering", "Physics", "Mathematics"] },
  { id: "stanford", name: "Stanford University", city: "Stanford", state: "CA", type: "private", acceptanceRate: 0.04, sat25: 1500, sat75: 1570, gpaAvg: 3.95, edBoost: 1.4, size: "large", setting: "suburban", costPerYear: 84000, topMajors: ["Computer Science", "Biology", "Engineering", "Economics"] },
  { id: "harvard", name: "Harvard University", city: "Cambridge", state: "MA", type: "private", acceptanceRate: 0.035, sat25: 1500, sat75: 1580, gpaAvg: 3.95, edBoost: 1.5, size: "large", setting: "urban", costPerYear: 83000, topMajors: ["Economics", "Political Science", "Computer Science", "Biology"] },
  { id: "yale", name: "Yale University", city: "New Haven", state: "CT", type: "private", acceptanceRate: 0.045, sat25: 1490, sat75: 1560, gpaAvg: 3.94, edBoost: 1.5, size: "medium", setting: "urban", costPerYear: 83000, topMajors: ["Economics", "Political Science", "History", "Biology"] },
  { id: "princeton", name: "Princeton University", city: "Princeton", state: "NJ", type: "private", acceptanceRate: 0.04, sat25: 1500, sat75: 1570, gpaAvg: 3.95, edBoost: 1.5, size: "medium", setting: "suburban", costPerYear: 80000, topMajors: ["Computer Science", "Economics", "Public Policy", "Engineering"] },
  { id: "columbia", name: "Columbia University", city: "New York", state: "NY", type: "private", acceptanceRate: 0.04, sat25: 1490, sat75: 1560, gpaAvg: 3.93, edBoost: 1.5, size: "large", setting: "urban", costPerYear: 85000, topMajors: ["Economics", "Computer Science", "Political Science", "Engineering"] },
  { id: "upenn", name: "University of Pennsylvania", city: "Philadelphia", state: "PA", type: "private", acceptanceRate: 0.06, sat25: 1490, sat75: 1560, gpaAvg: 3.9, edBoost: 1.6, size: "large", setting: "urban", costPerYear: 84000, topMajors: ["Finance", "Economics", "Nursing", "Computer Science"] },
  { id: "cornell", name: "Cornell University", city: "Ithaca", state: "NY", type: "private", acceptanceRate: 0.07, sat25: 1470, sat75: 1550, gpaAvg: 3.9, edBoost: 1.6, size: "large", setting: "rural", costPerYear: 83000, topMajors: ["Engineering", "Biology", "Business", "Agriculture"] },
  { id: "brown", name: "Brown University", city: "Providence", state: "RI", type: "private", acceptanceRate: 0.05, sat25: 1490, sat75: 1560, gpaAvg: 3.92, edBoost: 1.6, size: "medium", setting: "urban", costPerYear: 84000, topMajors: ["Computer Science", "Economics", "Biology", "International Relations"] },
  { id: "dartmouth", name: "Dartmouth College", city: "Hanover", state: "NH", type: "private", acceptanceRate: 0.06, sat25: 1480, sat75: 1560, gpaAvg: 3.91, edBoost: 1.6, size: "small", setting: "rural", costPerYear: 84000, topMajors: ["Economics", "Computer Science", "Government", "Engineering"] },
  { id: "duke", name: "Duke University", city: "Durham", state: "NC", type: "private", acceptanceRate: 0.06, sat25: 1490, sat75: 1560, gpaAvg: 3.94, edBoost: 1.6, size: "large", setting: "suburban", costPerYear: 84000, topMajors: ["Computer Science", "Economics", "Biology", "Public Policy"] },
  { id: "northwestern", name: "Northwestern University", city: "Evanston", state: "IL", type: "private", acceptanceRate: 0.07, sat25: 1480, sat75: 1560, gpaAvg: 3.92, edBoost: 1.6, size: "large", setting: "suburban", costPerYear: 85000, topMajors: ["Economics", "Journalism", "Engineering", "Theatre"] },
  { id: "jhu", name: "Johns Hopkins University", city: "Baltimore", state: "MD", type: "private", acceptanceRate: 0.07, sat25: 1500, sat75: 1560, gpaAvg: 3.93, edBoost: 1.6, size: "large", setting: "urban", costPerYear: 83000, topMajors: ["Biomedical Engineering", "Public Health", "Biology", "Neuroscience"] },
  { id: "caltech", name: "Caltech", city: "Pasadena", state: "CA", type: "private", acceptanceRate: 0.03, sat25: 1530, sat75: 1590, gpaAvg: 3.97, edBoost: 1.0, size: "small", setting: "suburban", costPerYear: 82000, topMajors: ["Physics", "Computer Science", "Engineering", "Mathematics"] },
  { id: "uchicago", name: "University of Chicago", city: "Chicago", state: "IL", type: "private", acceptanceRate: 0.05, sat25: 1500, sat75: 1570, gpaAvg: 3.93, edBoost: 1.7, size: "large", setting: "urban", costPerYear: 86000, topMajors: ["Economics", "Mathematics", "Biology", "Political Science"] },
  { id: "vanderbilt", name: "Vanderbilt University", city: "Nashville", state: "TN", type: "private", acceptanceRate: 0.07, sat25: 1480, sat75: 1560, gpaAvg: 3.91, edBoost: 1.6, size: "medium", setting: "urban", costPerYear: 84000, topMajors: ["Economics", "Engineering", "Medicine, Health", "Music"] },
  { id: "rice", name: "Rice University", city: "Houston", state: "TX", type: "private", acceptanceRate: 0.08, sat25: 1490, sat75: 1560, gpaAvg: 3.92, edBoost: 1.5, size: "medium", setting: "urban", costPerYear: 76000, topMajors: ["Engineering", "Computer Science", "Biology", "Economics"] },
  { id: "wustl", name: "Washington University in St. Louis", city: "St. Louis", state: "MO", type: "private", acceptanceRate: 0.11, sat25: 1480, sat75: 1560, gpaAvg: 3.9, edBoost: 1.6, size: "large", setting: "suburban", costPerYear: 84000, topMajors: ["Biology", "Engineering", "Business", "Pre-Med"] },
  { id: "nyu", name: "New York University", city: "New York", state: "NY", type: "private", acceptanceRate: 0.12, sat25: 1440, sat75: 1540, gpaAvg: 3.8, edBoost: 1.5, size: "large", setting: "urban", costPerYear: 86000, topMajors: ["Business", "Film", "Economics", "Computer Science"] },
  { id: "usc", name: "University of Southern California", city: "Los Angeles", state: "CA", type: "private", acceptanceRate: 0.1, sat25: 1440, sat75: 1530, gpaAvg: 3.83, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 85000, topMajors: ["Business", "Film", "Computer Science", "Communications"] },
  { id: "cmu", name: "Carnegie Mellon University", city: "Pittsburgh", state: "PA", type: "private", acceptanceRate: 0.11, sat25: 1500, sat75: 1560, gpaAvg: 3.9, edBoost: 1.5, size: "medium", setting: "urban", costPerYear: 80000, topMajors: ["Computer Science", "Engineering", "Drama", "Business"] },
  { id: "berkeley", name: "UC Berkeley", city: "Berkeley", state: "CA", type: "public", acceptanceRate: 0.11, sat25: 1330, sat75: 1530, gpaAvg: 3.89, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 45000, topMajors: ["Computer Science", "Economics", "Engineering", "Biology"] },
  { id: "ucla", name: "UCLA", city: "Los Angeles", state: "CA", type: "public", acceptanceRate: 0.09, sat25: 1300, sat75: 1530, gpaAvg: 3.9, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 44000, topMajors: ["Biology", "Psychology", "Economics", "Political Science"] },
  { id: "umich", name: "University of Michigan", city: "Ann Arbor", state: "MI", type: "public", acceptanceRate: 0.18, sat25: 1350, sat75: 1530, gpaAvg: 3.88, edBoost: 1.0, size: "large", setting: "suburban", costPerYear: 36000, topMajors: ["Engineering", "Business", "Computer Science", "Economics"] },
  { id: "uva", name: "University of Virginia", city: "Charlottesville", state: "VA", type: "public", acceptanceRate: 0.19, sat25: 1380, sat75: 1520, gpaAvg: 3.9, edBoost: 1.3, size: "large", setting: "suburban", costPerYear: 35000, topMajors: ["Economics", "Business", "Biology", "Engineering"] },
  { id: "unc", name: "UNC Chapel Hill", city: "Chapel Hill", state: "NC", type: "public", acceptanceRate: 0.19, sat25: 1340, sat75: 1510, gpaAvg: 3.85, edBoost: 1.2, size: "large", setting: "suburban", costPerYear: 24000, topMajors: ["Biology", "Business", "Psychology", "Media"] },
  { id: "gatech", name: "Georgia Tech", city: "Atlanta", state: "GA", type: "public", acceptanceRate: 0.16, sat25: 1400, sat75: 1540, gpaAvg: 3.9, edBoost: 1.3, size: "large", setting: "urban", costPerYear: 30000, topMajors: ["Computer Science", "Engineering", "Business", "Physics"] },
  { id: "utaustin", name: "UT Austin", city: "Austin", state: "TX", type: "public", acceptanceRate: 0.31, sat25: 1230, sat75: 1480, gpaAvg: 3.8, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 28000, topMajors: ["Business", "Engineering", "Computer Science", "Communications"] },
  { id: "uiuc", name: "UIUC", city: "Champaign", state: "IL", type: "public", acceptanceRate: 0.45, sat25: 1290, sat75: 1480, gpaAvg: 3.78, edBoost: 1.0, size: "large", setting: "suburban", costPerYear: 34000, topMajors: ["Engineering", "Computer Science", "Business", "Agriculture"] },
  { id: "uwmadison", name: "University of Wisconsin–Madison", city: "Madison", state: "WI", type: "public", acceptanceRate: 0.49, sat25: 1330, sat75: 1480, gpaAvg: 3.8, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 39000, topMajors: ["Biology", "Business", "Engineering", "Economics"] },
  { id: "umass", name: "UMass Amherst", city: "Amherst", state: "MA", type: "public", acceptanceRate: 0.58, sat25: 1240, sat75: 1420, gpaAvg: 3.75, edBoost: 1.0, size: "large", setting: "rural", costPerYear: 33000, topMajors: ["Computer Science", "Business", "Biology", "Psychology"] },
  { id: "psu", name: "Penn State", city: "University Park", state: "PA", type: "public", acceptanceRate: 0.55, sat25: 1210, sat75: 1390, gpaAvg: 3.7, edBoost: 1.0, size: "large", setting: "rural", costPerYear: 36000, topMajors: ["Engineering", "Business", "Biology", "Communications"] },
  { id: "osu", name: "Ohio State University", city: "Columbus", state: "OH", type: "public", acceptanceRate: 0.53, sat25: 1240, sat75: 1420, gpaAvg: 3.75, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 35000, topMajors: ["Business", "Engineering", "Psychology", "Biology"] },
  { id: "purdue", name: "Purdue University", city: "West Lafayette", state: "IN", type: "public", acceptanceRate: 0.5, sat25: 1190, sat75: 1440, gpaAvg: 3.7, edBoost: 1.0, size: "large", setting: "suburban", costPerYear: 28000, topMajors: ["Engineering", "Computer Science", "Agriculture", "Business"] },
  { id: "asu", name: "Arizona State University", city: "Tempe", state: "AZ", type: "public", acceptanceRate: 0.9, sat25: 1120, sat75: 1350, gpaAvg: 3.5, edBoost: 1.0, size: "large", setting: "urban", costPerYear: 30000, topMajors: ["Business", "Engineering", "Communications", "Psychology"] },
  { id: "msu", name: "Michigan State University", city: "East Lansing", state: "MI", type: "public", acceptanceRate: 0.83, sat25: 1100, sat75: 1320, gpaAvg: 3.6, edBoost: 1.0, size: "large", setting: "suburban", costPerYear: 30000, topMajors: ["Business", "Engineering", "Biology", "Education"] },
  { id: "northeastern", name: "Northeastern University", city: "Boston", state: "MA", type: "private", acceptanceRate: 0.06, sat25: 1460, sat75: 1550, gpaAvg: 3.9, edBoost: 1.6, size: "large", setting: "urban", costPerYear: 83000, topMajors: ["Computer Science", "Business", "Engineering", "Health Sciences"] },
  { id: "bu", name: "Boston University", city: "Boston", state: "MA", type: "private", acceptanceRate: 0.11, sat25: 1420, sat75: 1510, gpaAvg: 3.8, edBoost: 1.5, size: "large", setting: "urban", costPerYear: 82000, topMajors: ["Business", "Communications", "Engineering", "Biology"] },
  { id: "tufts", name: "Tufts University", city: "Medford", state: "MA", type: "private", acceptanceRate: 0.1, sat25: 1450, sat75: 1540, gpaAvg: 3.9, edBoost: 1.6, size: "medium", setting: "suburban", costPerYear: 85000, topMajors: ["International Relations", "Computer Science", "Biology", "Economics"] },
  { id: "ucsd", name: "UC San Diego", city: "La Jolla", state: "CA", type: "public", acceptanceRate: 0.24, sat25: 1300, sat75: 1500, gpaAvg: 3.87, edBoost: 1.0, size: "large", setting: "suburban", costPerYear: 44000, topMajors: ["Biology", "Computer Science", "Engineering", "Economics"] },
];

export function getCollege(id: string): College | undefined {
  return COLLEGES.find((c) => c.id === id);
}

function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\buniversity of\b/g, "")
    .replace(/\buniversity\b|\bcollege\b|\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Common shorthands the AI may emit that don't match our stored names verbatim. */
const NAME_ALIASES: Record<string, string> = {
  "uc berkeley": "berkeley",
  "university of california berkeley": "berkeley",
  "ucla": "ucla",
  "university of california los angeles": "ucla",
  "uc san diego": "ucsd",
  "ucsd": "ucsd",
  "penn": "upenn",
  "u penn": "upenn",
  "georgia institute of technology": "gatech",
  "georgia tech": "gatech",
  "mit": "mit",
  "massachusetts institute of technology": "mit",
  "ut austin": "utaustin",
  "university of texas at austin": "utaustin",
  "university of texas austin": "utaustin",
  "california institute of technology": "caltech",
  "unc chapel hill": "unc",
  "university of north carolina at chapel hill": "unc",
  "washington university in st louis": "wustl",
  "washu": "wustl",
  "university of illinois urbana champaign": "uiuc",
  "university of illinois at urbana champaign": "uiuc",
  "ohio state": "osu",
  "penn state": "psu",
};

/** Best-effort match of an AI-produced college name to our dataset id (for logos + chances). */
export function findCollegeByName(name: string): College | undefined {
  const raw = name.trim().toLowerCase();
  if (NAME_ALIASES[raw]) return getCollege(NAME_ALIASES[raw]);

  // Same lookup, but with punctuation flattened (e.g. "University of
  // California, Berkeley" → "university of california berkeley").
  const rawAlias = raw.replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  if (rawAlias !== raw && NAME_ALIASES[rawAlias]) return getCollege(NAME_ALIASES[rawAlias]);

  const target = normalizeName(name);
  if (!target) return undefined;

  let best: College | undefined;
  for (const c of COLLEGES) {
    const candidate = normalizeName(c.name);
    if (candidate === target) return c;
    if (!best && (candidate.includes(target) || target.includes(candidate))) best = c;
  }
  return best;
}
