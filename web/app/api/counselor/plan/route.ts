import { openaiModel, openrouterModel, hasSecret } from "@/lib/ai-usage/clients";
import { noteFromUsage } from "@/lib/ai-usage/note";
import { generateObject } from "ai";

import { getCollege } from "@/lib/counselor/colleges";
import { formatHits, searchLibrary } from "@/lib/counselor/knowledge/store";
import { DEFAULT_COUNSELOR_MODEL, isCounselorModel, normalizeCounselorThinking } from "@/lib/counselor/models";
import { planFingerprint } from "@/lib/counselor/plan";
import { formatTimelineForPrompt } from "@/lib/counselor/plan-timeline";
import { MasterPlanContentSchema, STRATEGY_AREAS, type MasterPlan, type MasterPlanContent } from "@/lib/counselor/plan-types";
import { uid } from "@/lib/counselor/state";
import type { CounselorState } from "@/lib/counselor/types";
import { tutorModelBackend } from "@/lib/tutor-models";

export const maxDuration = 180;

interface PlanRequest {
  state: CounselorState;
  model?: unknown;
  thinking?: unknown;
}

export async function POST(req: Request) {
  let body: PlanRequest;
  try {
    body = await req.json() as PlanRequest;
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }
  if (!body.state?.profile) return Response.json({ error: "A counselor profile is required." }, { status: 400 });

  const model = isCounselorModel(body.model) ? body.model : DEFAULT_COUNSELOR_MODEL;
  const thinking = normalizeCounselorThinking(body.thinking);
  const state = body.state;
  const backend = tutorModelBackend(model);

  if (backend === "openrouter") {
    if (!hasSecret("openrouter")) {
      return Response.json(
        { error: "No OpenRouter key. Link one in AI Usage, or add OPENROUTER_API_KEY to .env and restart." },
        { status: 500 }
      );
    }
  } else if (!hasSecret("openai")) {
    return Response.json(
      { error: "No OpenAI key. Link one in AI Usage, or add OPENAI_API_KEY to .env and restart." },
      { status: 500 }
    );
  }

  let grounding = "";
  try {
    const hits = await searchLibrary(
      `college planning roadmap grade ${state.profile.gradeLevel} class of ${state.profile.applyYear} ${state.profile.intendedMajor || "undecided"} testing activities essays financial aid`,
      { limit: 8 }
    );
    grounding = formatHits(hits);
  } catch {
    grounding = "The local counseling library was unavailable. Use only the supplied student record and state any uncertainty.";
  }

  const basis = [
    "student profile",
    `${state.coursework.length} transcript rows`,
    `${state.testing.length} test records`,
    `${state.awards.length} awards`,
    `${state.profile.activities.length} activities`,
    `${state.list.length} saved colleges`,
  ].join(", ");

  try {
    const result = await generateObject({
      model: backend === "openrouter" ? openrouterModel(model) : openaiModel(model),
      schema: MasterPlanContentSchema,
      system: `You are a senior college counselor building one rigorous, usable strategic plan. Return the complete schema.

Rules:
- Use only the supplied record and reference guidance. Do not invent achievements, scores, finances, deadlines, or school policies.
- Be candid about weaknesses and tradeoffs. Recommendations need a concrete why, impact, next action, timeframe, and success measure.
- Separate strategy from tasks. nextSteps contains only work appropriate now.
- Build a balanced reach, target, and likely list. Existing saved colleges are preferences or constraints, not automatic recommendations.
- Use stable short IDs in every nested object. IDs must be unique inside the plan.
- Never assign application essays or application execution before the timing window opens.
- For grade 13, account for gap-year or transfer positioning and the next viable application cycle.
- Keep prose concise enough to scan in a planning workspace.

${formatTimelineForPrompt(state.profile)}

REFERENCE GUIDANCE:
${grounding}`,
      prompt: `Build the student's master plan from this record.

PROFILE AND RECORD:
${JSON.stringify({
  profile: state.profile,
  memories: state.memories,
  coursework: state.coursework,
  testing: state.testing,
  awards: state.awards,
  collegeList: state.list,
  applications: state.applications,
  essayInventory: state.essays.map((essay) => ({
    title: essay.title,
    kind: essay.kind,
    collegeName: essay.collegeName,
    wordLimit: essay.wordLimit,
    words: essay.content.trim().split(/\s+/).filter(Boolean).length,
  })),
}, null, 2)}`,
      providerOptions: {
        openai: { reasoningEffort: thinking, reasoningSummary: "auto" },
        openrouter: { reasoning: { effort: thinking } },
      },
      abortSignal: req.signal,
    });

    noteFromUsage("plan", model, backend, result.usage);

    const now = Date.now();
    const content = normalizeIds(result.object);
    const plan: MasterPlan = {
      ...content,
      schemaVersion: 1,
      id: "master",
      version: (state.masterPlan?.version ?? 0) + 1,
      generatedAt: now,
      updatedAt: now,
      generator: {
        model,
        dataFingerprint: planFingerprint(state),
        basis,
      },
    };
    return Response.json({ plan });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Plan generation failed.";
    return Response.json({ error: message }, { status: 502 });
  }
}

function normalizeIds(content: MasterPlanContent): MasterPlanContent {
  const strategy = Object.fromEntries(STRATEGY_AREAS.map((area) => [
    area,
    content.strategy[area].map((recommendation) => ({ ...recommendation, id: uid() })),
  ])) as MasterPlanContent["strategy"];

  return {
    ...content,
    evaluation: {
      ...content.evaluation,
      intendedMajors: content.evaluation.intendedMajors.map((item) => ({ ...item, id: uid() })),
      careerDirections: content.evaluation.careerDirections.map((item) => ({ ...item, id: uid() })),
      narrativeThemes: content.evaluation.narrativeThemes.map((item) => ({ ...item, id: uid() })),
    },
    roadmap: {
      years: content.roadmap.years.map((period) => ({ ...period, id: uid(), milestones: period.milestones.map((milestone) => ({ ...milestone, id: uid() })) })),
      terms: content.roadmap.terms.map((period) => ({ ...period, id: uid(), milestones: period.milestones.map((milestone) => ({ ...milestone, id: uid() })) })),
    },
    strategy,
    projects: {
      ...content.projects,
      selectedProjectId: null,
      ideas: content.projects.ideas.map((project) => ({ ...project, id: uid() })),
    },
    colleges: content.colleges.map((college) => {
      const match = getCollege(college.name);
      return { ...college, id: uid(), collegeId: match?.id ?? null, name: match?.name ?? college.name };
    }),
    nextSteps: content.nextSteps.map((step) => ({ ...step, id: uid(), taskId: undefined })),
  };
}
