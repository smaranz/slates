import type { EssayKind, Rubric } from "./types";

/**
 * What each kind of essay is actually being judged on.
 *
 * These aren't one rubric with the names changed. A personal statement is read
 * for whether a stranger finishes it knowing the writer; a "why us" supplement
 * is read for whether the student did the research; a UC PIQ is read against a
 * published set of criteria that explicitly does not reward literary flair.
 * Scoring all three against "structure, voice, mechanics" would produce
 * feedback that is true of essays in general and useless about this one.
 *
 * Five criteria each, because a rubric a student can hold in their head while
 * revising is worth more than an exhaustive one they read once.
 */

// The shape lives in types.ts so an essay can carry one without a cycle.
export type { Rubric } from "./types";

const PERSONAL: Rubric = {
  label: "Personal statement",
  criteria: [
    {
      name: "Opening",
      detail:
        "Does the first sentence make a reader want the second? Score low for scene-setting throat-clearing, a dictionary definition, a quotation, or a thesis statement announcing what the essay will show.",
    },
    {
      name: "Specificity",
      detail:
        "Is it full of things only this student could have written — names, objects, numbers, overheard lines? Score low if the details would fit a thousand other applicants.",
    },
    {
      name: "Reflection",
      detail:
        "Does the student think on the page, or just report events and then assert a lesson? The insight has to be earned by the story, not appended to it.",
    },
    {
      name: "Voice",
      detail:
        "Does it sound like a seventeen-year-old talking, or like an essay about a seventeen-year-old? Score low for inflated vocabulary and formal register.",
    },
    {
      name: "Ending",
      detail:
        "Does it land somewhere the beginning couldn't have predicted? Score low for a summary, a restatement of the lesson, or a promise about college.",
    },
  ],
  note:
    "A personal statement's job is to make an admissions officer feel they have met someone. Trauma is not a requirement and neither is a triumph — an ordinary subject observed precisely beats an extraordinary one told generically.",
};

const SUPPLEMENT: Rubric = {
  label: "Supplement",
  criteria: [
    {
      name: "Answers the prompt",
      detail:
        "Does it answer the question actually asked, in the first third? Score low if it is a general essay with the college's name inserted.",
    },
    {
      name: "Research",
      detail:
        "Are the specifics real and checkable — a named course, a lab, a professor's work, a tradition? Score low for anything true of every school: prestige, class size, 'vibrant community'.",
    },
    {
      name: "Fit both ways",
      detail:
        "Does it say what the student would do there, not just what the school has? A list of offerings with no student in it scores low.",
    },
    {
      name: "Economy",
      detail:
        "Supplements are short. Is every sentence load-bearing? Score low for preamble and for restating the prompt.",
    },
    {
      name: "Non-duplication",
      detail:
        "Does it add something the personal statement and activities list don't already say?",
    },
  ],
  note:
    "The test for a 'why us' essay: if you swapped in another college's name, would it still make sense? If yes, it has said nothing.",
};

const UC: Rubric = {
  label: "UC personal insight question",
  criteria: [
    {
      name: "Answers the question",
      detail:
        "UC readers score against the question asked, directly. Score low for a narrative that circles the topic without answering it.",
    },
    {
      name: "Evidence of the thing",
      detail:
        "Does it demonstrate the quality claimed — leadership, creativity, resilience — with what the student actually did, including numbers and outcomes?",
    },
    {
      name: "Your role",
      detail:
        "Is the student's own contribution unmistakable? 'We' throughout is a common and costly failure here.",
    },
    {
      name: "Directness",
      detail:
        "UC PIQs reward plain, complete answers over literary openings. Score low for a slow scene before the substance.",
    },
    {
      name: "Word use",
      detail:
        "350 words is a hard ceiling. Is the space spent on substance rather than atmosphere?",
    },
  ],
  note:
    "UC applications are read against a published rubric and are not looking for a personal statement. Plain and complete beats lyrical and partial. Nothing here should repeat another PIQ.",
};

const SCHOLARSHIP: Rubric = {
  label: "Scholarship essay",
  criteria: [
    { name: "Answers the prompt", detail: "Scholarship committees read for the criteria they published. Does it hit them explicitly?" },
    { name: "Specific need or merit", detail: "Is the case concrete — real circumstances, real numbers — rather than a general appeal?" },
    { name: "What you'd do with it", detail: "Does it connect the money to a specific plan?" },
    { name: "Credibility", detail: "Is every claim something a reader would believe and the student could support?" },
    { name: "Economy", detail: "Is it within the limit and free of filler?" },
  ],
  note: "Scholarship readers process hundreds of these. The essay that names a specific use for a specific amount stands out from the ones that describe a dream.",
};

const ADDITIONAL: Rubric = {
  label: "Additional information",
  criteria: [
    { name: "Necessity", detail: "Does this need to exist? Score low if it repeats the application or adds an essay nobody asked for." },
    { name: "Facts, not feelings", detail: "This section explains circumstances. Score low for emotional framing where a plain statement would serve." },
    { name: "Brevity", detail: "Is it as short as the explanation allows?" },
    { name: "No excuses", detail: "Does it explain without pleading? Context, then what the student did about it." },
    { name: "Clarity", detail: "Could a reader with no background understand the situation in one pass?" },
  ],
  note: "Additional Information is for context an admissions officer needs and cannot get elsewhere — an illness, a school's limitations, a grading anomaly. It is not a second personal statement.",
};

const GENERIC: Rubric = {
  label: "Essay",
  criteria: [
    { name: "Answers the prompt", detail: "Does it do what was asked, early and clearly?" },
    { name: "Specificity", detail: "Is it grounded in concrete, checkable detail rather than generalities?" },
    { name: "Structure", detail: "Does each paragraph earn its place and lead somewhere?" },
    { name: "Voice", detail: "Does it sound like a person rather than an essay?" },
    { name: "Economy", detail: "Is every sentence doing work?" },
  ],
  note: "Judge it against what this piece is trying to do, and say plainly where it falls short.",
};

export const RUBRICS: Record<EssayKind, Rubric> = {
  "personal-statement": PERSONAL,
  supplement: SUPPLEMENT,
  "uc-piq": UC,
  scholarship: SCHOLARSHIP,
  "additional-info": ADDITIONAL,
  other: GENERIC,
};

export const ESSAY_KIND_LABEL: Record<EssayKind, string> = {
  "personal-statement": "Personal statement",
  supplement: "Supplement",
  "uc-piq": "UC PIQ",
  scholarship: "Scholarship",
  "additional-info": "Additional info",
  other: "Other",
};

/** The conventional ceiling, offered as a default the student can override. */
export const DEFAULT_LIMIT: Record<EssayKind, number | null> = {
  "personal-statement": 650,
  supplement: 250,
  "uc-piq": 350,
  scholarship: 500,
  "additional-info": 650,
  other: null,
};
