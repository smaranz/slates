import type { Assignment, Bucket, Impact, SyncSnapshot } from "./types";

/** Where the model thinks the work belongs, in its own words. */
type Place = "tonight" | "tomorrow" | "later";

interface Estimate {
  id: string;
  minutes: number;
  impact: Impact;
  impactNote: string;
  place?: Place;
}

const PLACE_BUCKET: Record<Place, Bucket> = {
  tonight: "tonight",
  tomorrow: "soon",
  later: "week",
};

function validEstimate(value: unknown): value is Estimate {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Estimate>;
  return (
    typeof item.id === "string" &&
    typeof item.minutes === "number" &&
    Number.isFinite(item.minutes) &&
    ["high", "medium", "low"].includes(item.impact ?? "") &&
    typeof item.impactNote === "string"
  );
}

/**
 * The columns are days — Today, Tomorrow, Later — so anything with a due date
 * goes where its date says, whatever the model thought. The model placing
 * dated work is what put today's work under Tomorrow and tomorrow's under
 * Later. It still sizes every item, and it still places undated work, where
 * reading what the work *is* is all there is to go on.
 */
function placedBucket(assignment: Assignment, place: Place | undefined): Bucket {
  if (assignment.bucket === "done") return "done";
  if (!place || assignment.dateOffset !== null) return assignment.bucket;
  return PLACE_BUCKET[place];
}

/** Send every open assignment through the estimator on every successful sync. */
export async function estimateAssignments(snapshot: SyncSnapshot): Promise<Assignment[]> {
  const open = snapshot.assignments.filter((assignment) => assignment.bucket !== "done");
  if (!open.length) return snapshot.assignments;

  const courses = new Map(snapshot.courses.map((course) => [course.id, course.name]));
  const response = await fetch("/api/estimate", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assignments: open.map((assignment) => ({
        id: assignment.id,
        title: assignment.title,
        brief: assignment.brief,
        kind: assignment.kind,
        due: assignment.due,
        dueInDays: assignment.dateOffset,
        course: courses.get(assignment.courseId) ?? "Unknown course",
        /*
         * Everything that makes work long, not just what it is called. The
         * handouts go across as references; the server fetches their text
         * through the scraper's session, which the browser has no way to do.
         */
        submissionTypes: assignment.submissionTypes,
        points: assignment.grade?.possible ?? null,
        attachments: assignment.attachments?.map((a) => ({
          kind: a.kind,
          title: a.title,
          url: a.url,
          size: a.size,
        })),
        assessment: assignment.assessment
          ? {
              timeLimitMin: assignment.assessment.timeLimitMin,
              questionPoints: assignment.assessment.questionPoints,
            }
          : null,
      })),
    }),
  });

  if (!response.ok) throw new Error(`Estimate request failed (${response.status})`);
  const body = (await response.json()) as { estimates?: unknown[] };
  const estimates = new Map(
    (body.estimates ?? []).filter(validEstimate).map((estimate) => [estimate.id, estimate])
  );

  return snapshot.assignments.map((assignment) => {
    const estimate = estimates.get(assignment.id);
    if (!estimate) return assignment;
    return {
      ...assignment,
      minutes: Math.max(5, Math.min(480, Math.round(estimate.minutes / 5) * 5)),
      impact: estimate.impact,
      impactNote: estimate.impactNote,
      bucket: placedBucket(assignment, estimate.place),
    };
  });
}
