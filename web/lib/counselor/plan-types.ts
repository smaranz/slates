import { z } from "zod";

export const STRATEGY_AREAS = [
  "courses",
  "rigor",
  "testing",
  "activities",
  "leadership",
  "summer",
  "opportunities",
  "community",
] as const;

export const StrategyAreaSchema = z.enum(STRATEGY_AREAS);
export type StrategyArea = z.infer<typeof StrategyAreaSchema>;

export const PLAN_TASK_CATEGORIES = [
  "academics",
  "testing",
  "activities",
  "college-research",
  "applications",
  "essays",
  "financial-aid",
  "personal",
] as const;

export const PlanTaskCategorySchema = z.enum(PLAN_TASK_CATEGORIES);
export type PlanTaskCategory = z.infer<typeof PlanTaskCategorySchema>;

const PositionAssessmentSchema = z.object({
  rating: z.enum(["developing", "competitive", "strong", "distinctive", "unknown"]),
  summary: z.string().min(1),
  evidence: z.array(z.string().min(1)).max(8),
});

const RatedDirectionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  fit: z.enum(["explore", "promising", "strong"]),
  why: z.string().min(1),
});

const NarrativeThemeSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  evidence: z.array(z.string().min(1)).max(6),
  direction: z.string().min(1),
});

export const PlanRecommendationSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  why: z.string().min(1),
  impact: z.string().min(1),
  nextAction: z.string().min(1),
  timeframe: z.string().min(1),
  measure: z.string().min(1),
});

const PlanMilestoneSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  status: z.enum(["later", "soon", "now", "past"]),
});

const PlanPeriodSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(["academic-year", "term"]),
  label: z.string().min(1),
  focus: z.string().optional(),
  startsOn: z.string().optional(),
  endsOn: z.string().optional(),
  milestones: z.array(PlanMilestoneSchema).max(12),
});

const PassionProjectSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  concept: z.string().min(1),
  whyItFits: z.string().min(1),
  firstStep: z.string().min(1),
  evidenceOfImpact: z.string().min(1),
});

const PlanCollegeSchema = z.object({
  id: z.string().min(1),
  collegeId: z.string().nullable(),
  name: z.string().min(1),
  category: z.enum(["reach", "target", "likely"]),
  priority: z.number().int().min(1).max(5),
  fit: z.string().min(1),
  weakness: z.string().min(1),
  nextAction: z.string().min(1),
});

const PlanNextStepSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().optional(),
  category: PlanTaskCategorySchema,
  targetDate: z.string().optional(),
  taskId: z.string().optional(),
});

export const MasterPlanContentSchema = z.object({
  evaluation: z.object({
    profileSummary: z.string().min(1),
    academic: PositionAssessmentSchema,
    extracurricular: PositionAssessmentSchema,
    advantages: z.array(z.string().min(1)).max(10),
    risks: z.array(z.string().min(1)).max(10),
    intendedMajors: z.array(RatedDirectionSchema).max(8),
    careerDirections: z.array(RatedDirectionSchema).max(8),
    narrativeThemes: z.array(NarrativeThemeSchema).max(6),
    competitivenessReadout: z.string().min(1),
    improvements: z.array(z.string().min(1)).max(10),
  }),
  roadmap: z.object({
    years: z.array(PlanPeriodSchema).max(6),
    terms: z.array(PlanPeriodSchema).max(12),
  }),
  strategy: z.object(Object.fromEntries(
    STRATEGY_AREAS.map((area) => [area, z.array(PlanRecommendationSchema).max(8)])
  ) as Record<StrategyArea, z.ZodArray<typeof PlanRecommendationSchema>>),
  projects: z.object({
    ideas: z.array(PassionProjectSchema).max(6),
    selectedProjectId: z.string().nullable(),
    essayPositioning: z.array(z.string().min(1)).max(8),
  }),
  colleges: z.array(PlanCollegeSchema).max(24),
  nextSteps: z.array(PlanNextStepSchema).max(16),
  missingInfo: z.array(z.string().min(1)).max(12),
});

export type MasterPlanContent = z.infer<typeof MasterPlanContentSchema>;
export type PlanRecommendation = z.infer<typeof PlanRecommendationSchema>;
export type PlanNextStep = z.infer<typeof PlanNextStepSchema>;

export interface MasterPlan extends MasterPlanContent {
  schemaVersion: 1;
  id: "master";
  version: number;
  generatedAt: number;
  updatedAt: number;
  generator: {
    model: string;
    dataFingerprint: string;
    basis: string;
  };
}

export type PlanOperation =
  | {
      type: "update-recommendation";
      area: StrategyArea;
      recommendationId: string;
      changes: Partial<Omit<PlanRecommendation, "id">>;
    }
  | { type: "select-project"; projectId: string | null }
  | { type: "remove-college"; collegeId: string }
  | { type: "remove-next-step"; stepId: string }
  /**
   * "I'm not doing that any more."
   *
   * The other operations each touch one item by id, which is the wrong shape
   * for dropping an activity: a project the student has stopped working on is
   * named in their advantages, their risks, a narrative theme's evidence, two
   * roadmap milestones, a strategy recommendation, a next step and the essay
   * angles. Removing it one id at a time means the counselor reports it gone
   * while most of the plan still assumes it.
   */
  | { type: "drop-activity"; name: string }
  /**
   * The assessment paragraphs, which no id-based operation can reach and which
   * a keyword sweep must not edit — cutting a sentence out of a judgement
   * changes its meaning. The counselor rewrites these itself.
   */
  /**
   * Rewrite one exact sentence wherever it sits.
   *
   * The id-based operations reach items, not the prose inside them — a
   * college's `weakness`, a recommendation's `why`, a career direction's
   * rationale. Without this the counselor can only report those as
   * untouchable, which is honest but still leaves the plan wrong.
   */
  | { type: "revise-text"; find: string; replace: string }
  | {
      type: "revise-evaluation";
      profileSummary?: string;
      competitivenessReadout?: string;
      academicSummary?: string;
      extracurricularSummary?: string;
    };

export interface PlanProposal {
  id: string;
  baseVersion: number;
  status: "pending" | "approved" | "rejected";
  summary: string;
  reason: string;
  evidence: string;
  downside?: string;
  operation: PlanOperation;
  createdAt: number;
  resolvedAt?: number;
}

export interface PlanRevision {
  id: string;
  version: number;
  summary: string;
  plan: MasterPlan;
  createdAt: number;
}
