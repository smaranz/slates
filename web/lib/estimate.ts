import type { Assignment, Impact, SyncSnapshot } from "./types";

interface Estimate {
  id: string;
  minutes: number;
  impact: Impact;
  impactNote: string;
}

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
    };
  });
}
