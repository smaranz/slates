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
 * The model reads what the work *is* — that a lab gets done in class, that a
 * posted syllabus needs nothing — which a due date alone can't tell you. It
 * doesn't get the last word, though: overdue work stays in Tonight no matter
 * how relaxed the description sounds.
 */
function placedBucket(assignment: Assignment, place: Place | undefined): Bucket {
  if (assignment.bucket === "done") return "done";
  if (!place) return assignment.bucket;
  if (assignment.dateOffset !== null && assignment.dateOffset < 0) return "tonight";
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
