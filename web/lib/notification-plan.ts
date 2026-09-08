import type { Assignment, Status } from "./types";

export const REMINDER_VERSION = 1;
export const REMINDER_LEAD_MS = 60 * 60_000;
export const REMINDER_HORIZON_MS = 14 * 24 * 60 * 60_000;
export const MAX_PENDING_REMINDERS = 32;

export interface ReminderCandidate {
  assignment: Assignment;
  courseName: string;
  status: Status;
  archived: boolean;
  submitted: boolean;
}

export interface PlannedReminder {
  id: number;
  assignmentId: string;
  title: string;
  body: string;
  at: Date;
  signature: string;
}

function hashId(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) & 0x7fffffff;
}

function notificationId(assignmentId: string, used: Set<number>): number {
  let id = hashId(`slates-assignment:${assignmentId}`) || 1;
  while (used.has(id)) id = id === 0x7fffffff ? 1 : id + 1;
  used.add(id);
  return id;
}

/**
 * A deliberately small plan: one alert, one hour before an exact due time,
 * only for the next two weeks. Completed, submitted, archived, date-only and
 * already-too-close work never enter the plan.
 */
export function planAssignmentReminders(
  candidates: ReminderCandidate[],
  now = new Date()
): PlannedReminder[] {
  const nowMs = now.getTime();
  const eligible = candidates
    .filter(({ assignment, status, archived, submitted }) => {
      if (status === "done" || archived || submitted || assignment.allDay || !assignment.dueAt) {
        return false;
      }
      const dueMs = Date.parse(assignment.dueAt);
      if (Number.isNaN(dueMs)) return false;
      const reminderMs = dueMs - REMINDER_LEAD_MS;
      return reminderMs > nowMs && reminderMs <= nowMs + REMINDER_HORIZON_MS;
    })
    .sort((a, b) => Date.parse(a.assignment.dueAt!) - Date.parse(b.assignment.dueAt!))
    .slice(0, MAX_PENDING_REMINDERS);

  const used = new Set<number>();
  return eligible.map(({ assignment, courseName }) => {
    const at = new Date(Date.parse(assignment.dueAt!) - REMINDER_LEAD_MS);
    const id = notificationId(assignment.id, used);
    const body = courseName ? `${courseName} · ${assignment.due}` : assignment.due;
    const signature = [REMINDER_VERSION, assignment.id, assignment.title, body, at.toISOString()].join("|");
    return { id, assignmentId: assignment.id, title: assignment.title, body, at, signature };
  });
}
