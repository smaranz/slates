import { tool } from "ai";
import { z } from "zod";

import { BAND_META, computeChance, effectiveSat } from "./chances";
import { formatHits, libraryStatus, searchLibrary } from "./knowledge/store";
import type { SchoolRecord } from "./school";
import { KNOWLEDGE_TOPICS } from "./knowledge/text";
import { COLLEGES, getCollege } from "./colleges";
import { uid } from "./state";
import {
  APPLICATION_ITEMS,
  DOCUMENT_KINDS,
  type Application,
  type ChanceBand,
  type CounselorState,
  type DocRef,
  type AskQuestion,
  type MeetingRef,
  type Source,
  type StatePatch,
} from "./types";

/**
 * The counselor's hands.
 *
 * These run on the server but own nothing: the whole student record arrives in
 * the request, the tools mutate that copy, and whatever they touched is
 * streamed back for the browser to keep. So a tool call is a real, durable
 * edit to the student's record — just one that gets committed at the far end.
 *
 * `touch()` is the bookkeeping that makes that work. Every mutating tool marks
 * which collection it changed so only those are sent back, rather than
 * shipping the entire state after every turn.
 */

export interface ToolContext {
  /** The working copy. Mutated in place. */
  state: CounselorState;
  /** Collections that changed this turn. */
  touched: Set<keyof StatePatch>;
  /** Documents written this turn, surfaced as cards under the reply. */
  docs: DocRef[];
  /** Meetings booked or moved this turn. */
  meetings: MeetingRef[];
  /** Where this turn's claims came from, shown under the reply. */
  sources: Source[];
  /** A structured question set the counselor wants answered, if it asked one. */
  ask: AskQuestion[] | null;
  /**
   * The live school side, when the student has synced Schoology.
   *
   * Read-only here. The counselor advises on grades; it does not get to
   * change them, and the school half owns that data outright.
   */
  school: SchoolRecord | null;
}

export function newToolContext(state: CounselorState, school?: SchoolRecord | null): ToolContext {
  return {
    state,
    touched: new Set(),
    docs: [],
    meetings: [],
    sources: [],
    ask: null,
    school: school?.synced ? school : null,
  };
}

/** What the browser needs to write back, given what the turn actually touched. */
export function patchOf(ctx: ToolContext): StatePatch {
  const patch: StatePatch = {};
  for (const key of ctx.touched) {
    switch (key) {
      case "profile": patch.profile = ctx.state.profile; break;
      case "memories": patch.memories = ctx.state.memories; break;
      case "tasks": patch.tasks = ctx.state.tasks; break;
      case "documents": patch.documents = ctx.state.documents; break;
      case "meetings": patch.meetings = ctx.state.meetings; break;
      case "applications": patch.applications = ctx.state.applications; break;
      case "list": patch.list = ctx.state.list; break;
      case "coursework": patch.coursework = ctx.state.coursework; break;
      case "testing": patch.testing = ctx.state.testing; break;
      case "awards": patch.awards = ctx.state.awards; break;
    }
  }
  return patch;
}

const ROUNDS = ["ED", "EA", "RD"] as const;

/** A college by id, name, or something close enough to a name. */
function resolveCollege(nameOrId: string) {
  return getCollege(nameOrId);
}

export function counselorTools(ctx: ToolContext) {
  const s = ctx.state;
  const touch = (k: keyof StatePatch) => ctx.touched.add(k);

  return {
    /* ───────────────────────────── memory ───────────────────────────── */

    get_memories: tool({
      description:
        "Everything you remember about this student. Read it before saving something new so you correct rather than duplicate.",
      inputSchema: z.object({
        kind: z.string().optional().describe("Optional filter, e.g. 'goal' or 'concern'."),
      }),
      execute: async ({ kind }) => {
        const rows = kind ? s.memories.filter((m) => m.kind === kind) : s.memories;
        return rows
          .slice()
          .sort((a, b) => b.importance - a.importance)
          .map((m) => ({ id: m.id, kind: m.kind, content: m.content, importance: m.importance }));
      },
    }),

    save_memory: tool({
      description:
        "Remember something durable about this student — a goal, a worry, family or money context, a person who matters, a commitment, a win. One clear memory beats several fragments. Never save chit-chat.",
      inputSchema: z.object({
        content: z.string().min(4).describe("Written as a fact about them, in your own words. One sentence."),
        kind: z
          .enum(["fact", "preference", "goal", "concern", "context", "relationship", "milestone", "other"])
          .default("fact"),
        importance: z.number().int().min(1).max(5).default(3).describe("1 minor, 5 defining."),
      }),
      execute: async ({ content, kind, importance }) => {
        const memory = {
          id: uid(),
          kind,
          content: content.trim(),
          importance,
          source: "counselor" as const,
          updatedAt: Date.now(),
        };
        s.memories = [memory, ...s.memories];
        touch("memories");
        return { saved: memory.id };
      },
    }),

    update_memory: tool({
      description: "Correct, re-weight, or forget a memory. Use this instead of saving a near-duplicate.",
      inputSchema: z.object({
        id: z.string(),
        content: z.string().optional(),
        importance: z.number().int().min(1).max(5).optional(),
        forget: z.boolean().optional().describe("True deletes it outright."),
      }),
      execute: async ({ id, content, importance, forget }) => {
        const found = s.memories.find((m) => m.id === id);
        if (!found) return { error: "No memory with that id." };
        if (forget) {
          s.memories = s.memories.filter((m) => m.id !== id);
          touch("memories");
          return { forgotten: id };
        }
        s.memories = s.memories.map((m) =>
          m.id === id
            ? { ...m, content: content ?? m.content, importance: importance ?? m.importance, updatedAt: Date.now() }
            : m
        );
        touch("memories");
        return { updated: id };
      },
    }),

    /* ───────────────────────────── profile ──────────────────────────── */

    update_profile_fact: tool({
      description:
        "Record a structured fact the student just told you: a new SAT or ACT score, GPA, intended major, dream school, high school, state, course rigor, or budget. Confirm what you recorded afterwards.",
      inputSchema: z.object({
        field: z.enum([
          "sat",
          "act",
          "gpaUnweighted",
          "rigor",
          "intendedMajor",
          "dreamSchool",
          "highSchool",
          "state",
          "budgetMax",
          "gradeLevel",
          "firstGen",
          "name",
        ]),
        value: z.string().describe("The new value as text; numbers are parsed."),
      }),
      execute: async ({ field, value }) => {
        const p = { ...s.profile };
        const num = Number(value.replace(/[^0-9.]/g, ""));
        switch (field) {
          case "sat": p.sat = Number.isFinite(num) ? Math.round(num) : null; break;
          case "act": p.act = Number.isFinite(num) ? Math.round(num) : null; break;
          case "gpaUnweighted": p.gpaUnweighted = Number.isFinite(num) ? num : null; break;
          case "budgetMax": p.budgetMax = Number.isFinite(num) ? Math.round(num) : null; break;
          case "gradeLevel": {
            const g = Math.round(num);
            if (g >= 9 && g <= 13) p.gradeLevel = g as typeof p.gradeLevel;
            break;
          }
          case "rigor": {
            const r = value.toLowerCase().replace(/\s+/g, "-");
            if (r === "low" || r === "medium" || r === "high" || r === "very-high") p.rigor = r;
            break;
          }
          case "firstGen": p.firstGen = /^(y|t|1)/i.test(value.trim()); break;
          case "intendedMajor": p.intendedMajor = value; break;
          case "dreamSchool": p.dreamSchool = value; break;
          case "highSchool": p.highSchool = value; break;
          case "state": p.state = value.toUpperCase().slice(0, 2); break;
          case "name": p.name = value; break;
        }
        s.profile = p;
        touch("profile");
        return { recorded: field, value: p[field as keyof typeof p] };
      },
    }),

    /* ────────────────────────────── tasks ───────────────────────────── */

    get_tasks: tool({
      description: "The student's action items, with status and due dates.",
      inputSchema: z.object({
        status: z.enum(["open", "done", "dismissed", "all"]).default("open"),
      }),
      execute: async ({ status }) =>
        s.tasks
          .filter((t) => status === "all" || t.status === status)
          .map((t) => ({ id: t.id, title: t.title, detail: t.detail, dueDate: t.dueDate, status: t.status })),
    }),

    create_task: tool({
      description:
        "Turn a concrete next step from this conversation into a task on their plan. Never for vague advice, and never more than three in one turn.",
      inputSchema: z.object({
        title: z.string().min(4).describe("A short imperative action, e.g. 'Email Ms. Rivera about a recommendation'."),
        detail: z.string().optional().describe("One or two sentences: why it matters and how to do it."),
        due_date: z.string().optional().describe("YYYY-MM-DD. Omit when there is no real deadline."),
      }),
      execute: async ({ title, detail, due_date }) => {
        const now = Date.now();
        const task = {
          id: uid(),
          title: title.trim(),
          detail: detail?.trim(),
          dueDate: due_date,
          status: "open" as const,
          source: "counselor" as const,
          createdAt: now,
          updatedAt: now,
        };
        s.tasks = [task, ...s.tasks];
        touch("tasks");
        return { created: task.id };
      },
    }),

    update_task: tool({
      description: "Complete, dismiss, reopen, or reschedule a task.",
      inputSchema: z.object({
        id: z.string(),
        action: z.enum(["complete", "dismiss", "reopen", "reschedule"]),
        due_date: z.string().optional().describe("YYYY-MM-DD, required for reschedule."),
      }),
      execute: async ({ id, action, due_date }) => {
        const found = s.tasks.find((t) => t.id === id);
        if (!found) return { error: "No task with that id." };
        s.tasks = s.tasks.map((t) => {
          if (t.id !== id) return t;
          const next = { ...t, updatedAt: Date.now() };
          if (action === "complete") next.status = "done";
          if (action === "dismiss") next.status = "dismissed";
          if (action === "reopen") next.status = "open";
          if (action === "reschedule" && due_date) next.dueDate = due_date;
          return next;
        });
        touch("tasks");
        return { updated: id, action };
      },
    }),

    /* ──────────────────────────── documents ─────────────────────────── */

    list_documents: tool({
      description: "Every document you've written with this student. Check here before creating one so you revise instead of duplicating.",
      inputSchema: z.object({}),
      execute: async () =>
        s.documents.map((d) => ({ id: d.id, kind: d.kind, title: d.title, updatedAt: new Date(d.updatedAt).toISOString() })),
    }),

    get_document: tool({
      description: "Read one document in full before revising it.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const doc = s.documents.find((d) => d.id === id);
        return doc ? { id: doc.id, title: doc.title, kind: doc.kind, content: doc.content } : { error: "Not found." };
      },
    }),

    create_document: tool({
      description:
        "Write a lasting artifact instead of a wall of chat: an activity list, brag sheet, deadline checklist, college research summary, essay OUTLINE or brainstorm, study plan, timeline, or a draft of an email they will send. Clean Markdown. Never their finished personal statement.",
      inputSchema: z.object({
        kind: z.enum(DOCUMENT_KINDS as [string, ...string[]]),
        title: z.string().min(3).describe("Specific, e.g. 'UC activities list — draft 1'."),
        content: z.string().min(20).describe("The full body in Markdown: headings, lists, tables where they help."),
      }),
      execute: async ({ kind, title, content }) => {
        const now = Date.now();
        const doc = {
          id: uid(),
          kind: kind as (typeof DOCUMENT_KINDS)[number],
          title: title.trim(),
          content,
          source: "counselor" as const,
          createdAt: now,
          updatedAt: now,
        };
        s.documents = [doc, ...s.documents];
        touch("documents");
        ctx.docs.push({ id: doc.id, kind: doc.kind, title: doc.title, action: "created" });
        return { created: doc.id, title: doc.title };
      },
    }),

    update_document: tool({
      description: "Replace a document's body (and optionally its title). Read it with get_document first.",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        content: z.string().min(20).describe("The full replacement Markdown body."),
      }),
      execute: async ({ id, title, content }) => {
        const found = s.documents.find((d) => d.id === id);
        if (!found) return { error: "No document with that id." };
        s.documents = s.documents.map((d) =>
          d.id === id ? { ...d, title: title ?? d.title, content, updatedAt: Date.now() } : d
        );
        touch("documents");
        ctx.docs.push({ id, kind: found.kind, title: title ?? found.title, action: "updated" });
        return { updated: id };
      },
    }),

    /* ───────────────────────────── meetings ─────────────────────────── */

    list_meetings: tool({
      description: "Check-ins already on the calendar, so you never double-book.",
      inputSchema: z.object({ status: z.enum(["scheduled", "completed", "cancelled", "all"]).default("scheduled") }),
      execute: async ({ status }) =>
        s.meetings
          .filter((m) => status === "all" || m.status === status)
          .map((m) => ({ id: m.id, topic: m.topic, scheduledFor: m.scheduledFor, mode: m.mode, status: m.status })),
    }),

    schedule_meeting: tool({
      description:
        "Book the next check-in you and the student agreed on. Suggest a concrete date and get agreement first. One clear next check-in beats several.",
      inputSchema: z.object({
        date: z.string().describe("YYYY-MM-DD."),
        time: z.string().default("16:00").describe("24-hour HH:MM local."),
        topic: z.string().min(4).describe("A short subject line, e.g. 'Review your UC essay drafts'."),
        agenda: z.string().optional().describe("One to three sentences on what you'll cover or what they should bring."),
        mode: z.enum(["chat", "voice"]).default("chat"),
      }),
      execute: async ({ date, time, topic, agenda, mode }) => {
        const when = new Date(`${date}T${time}:00`);
        if (Number.isNaN(when.getTime())) return { error: "That date/time didn't parse." };
        const meeting = {
          id: uid(),
          scheduledFor: when.toISOString(),
          topic: topic.trim(),
          agenda,
          mode,
          status: "scheduled" as const,
          createdAt: Date.now(),
        };
        s.meetings = [...s.meetings, meeting].sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
        touch("meetings");
        ctx.meetings.push({ id: meeting.id, topic: meeting.topic, scheduledFor: meeting.scheduledFor, mode, action: "scheduled" });
        return { scheduled: meeting.id, when: meeting.scheduledFor };
      },
    }),

    reschedule_meeting: tool({
      description: "Move an existing check-in.",
      inputSchema: z.object({ id: z.string(), date: z.string(), time: z.string().default("16:00") }),
      execute: async ({ id, date, time }) => {
        const found = s.meetings.find((m) => m.id === id);
        if (!found) return { error: "No meeting with that id." };
        const when = new Date(`${date}T${time}:00`);
        if (Number.isNaN(when.getTime())) return { error: "That date/time didn't parse." };
        s.meetings = s.meetings
          .map((m) => (m.id === id ? { ...m, scheduledFor: when.toISOString() } : m))
          .sort((a, b) => a.scheduledFor.localeCompare(b.scheduledFor));
        touch("meetings");
        ctx.meetings.push({ id, topic: found.topic, scheduledFor: when.toISOString(), mode: found.mode, action: "rescheduled" });
        return { rescheduled: id };
      },
    }),

    cancel_meeting: tool({
      description: "Cancel a check-in.",
      inputSchema: z.object({ id: z.string() }),
      execute: async ({ id }) => {
        const found = s.meetings.find((m) => m.id === id);
        if (!found) return { error: "No meeting with that id." };
        s.meetings = s.meetings.map((m) => (m.id === id ? { ...m, status: "cancelled" as const } : m));
        touch("meetings");
        ctx.meetings.push({ id, topic: found.topic, scheduledFor: found.scheduledFor, mode: found.mode, action: "cancelled" });
        return { cancelled: id };
      },
    }),

    /* ───────────────────────────── colleges ─────────────────────────── */

    find_matching_colleges: tool({
      description:
        "Rank real schools by this student's computed admit odds. Use this whenever they ask what to apply to, for similar schools, for safeties or matches, or to build or widen their list. Recommend from these results and name the band — never from memory.",
      inputSchema: z.object({
        band: z
          .enum(["safety", "match", "reach", "hard-reach", "any"])
          .default("any")
          .describe("Restrict to one band, e.g. 'safety' when they need floor schools."),
        major: z.string().optional().describe("Bias toward schools that list this among their top majors."),
        type: z.enum(["public", "private", "any"]).default("any"),
        size: z.enum(["small", "medium", "large", "any"]).default("any"),
        setting: z.enum(["urban", "suburban", "rural", "any"]).default("any"),
        state: z.string().optional().describe("Two-letter state code to restrict to."),
        max_cost: z.number().optional().describe("Maximum sticker price per year in USD."),
        round: z.enum(ROUNDS).default("RD"),
        exclude_listed: z.boolean().default(true).describe("Skip schools already on their list."),
        limit: z.number().int().min(1).max(20).default(10),
      }),
      execute: async ({ band, major, type, size, setting, state, max_cost, round, exclude_listed, limit }) => {
        const listed = new Set(s.list.map((e) => e.collegeId));
        const wantedMajor = major?.toLowerCase();

        const rows = COLLEGES.filter((c) => {
          if (exclude_listed && listed.has(c.id)) return false;
          if (type !== "any" && c.type !== type) return false;
          if (size !== "any" && c.size !== size) return false;
          if (setting !== "any" && c.setting !== setting) return false;
          if (state && c.state !== state.toUpperCase()) return false;
          if (max_cost && c.costPerYear > max_cost) return false;
          if (wantedMajor && !c.topMajors.some((m) => m.toLowerCase().includes(wantedMajor))) return false;
          return true;
        })
          .map((c) => ({ college: c, chance: computeChance(s.profile, c, round) }))
          .filter((r) => band === "any" || r.chance.band === band)
          .sort((a, b) => b.chance.high - a.chance.high)
          .slice(0, limit);

        if (!rows.length) return { results: [], note: "Nothing in the database matched those filters. Say so rather than inventing a school." };

        return {
          round,
          results: rows.map(({ college, chance }) => ({
            id: college.id,
            name: college.name,
            where: `${college.city}, ${college.state}`,
            type: college.type,
            band: chance.band,
            odds: `${chance.low}–${chance.high}%`,
            sat_range: `${college.sat25}–${college.sat75}`,
            avg_gpa: college.gpaAvg,
            cost_per_year: college.costPerYear,
            top_majors: college.topMajors,
          })),
        };
      },
    }),

    check_chances: tool({
      description: "Odds and the factors behind them for one specific school.",
      inputSchema: z.object({
        college: z.string().describe("Name or id, e.g. 'Michigan' or 'umich'."),
        round: z.enum(ROUNDS).default("RD"),
      }),
      execute: async ({ college, round }) => {
        const found = resolveCollege(college);
        if (!found) return { error: `Not in the database. Say you don't have verified numbers for ${college} rather than guessing.` };
        const chance = computeChance(s.profile, found, round);
        return {
          name: found.name,
          band: BAND_META[chance.band].label,
          odds: `${chance.low}–${chance.high}%`,
          summary: chance.summary,
          factors: chance.factors,
        };
      },
    }),

    add_to_list: tool({
      description: "Put a school on the student's list in a given round.",
      inputSchema: z.object({ college: z.string(), round: z.enum(ROUNDS).default("RD") }),
      execute: async ({ college, round }) => {
        const found = resolveCollege(college);
        if (!found) return { error: `Not in the database: ${college}.` };
        s.list = [...s.list.filter((e) => e.collegeId !== found.id), { collegeId: found.id, round, addedAt: Date.now() }];
        touch("list");
        return { added: found.name, round };
      },
    }),

    remove_from_list: tool({
      description: "Take a school off the list — cutting schools is part of the job.",
      inputSchema: z.object({ college: z.string() }),
      execute: async ({ college }) => {
        const found = resolveCollege(college);
        if (!found) return { error: `Not in the database: ${college}.` };
        s.list = s.list.filter((e) => e.collegeId !== found.id);
        touch("list");
        return { removed: found.name };
      },
    }),

    college_list_health_check: tool({
      description:
        "Whether the list is actually balanced: how many safeties, matches, and reaches it holds at this student's numbers. Run it before telling them where they stand.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!s.list.length) return { note: "The list is empty." };
        const counts: Record<ChanceBand, number> = { safety: 0, match: 0, reach: 0, "hard-reach": 0 };
        const rows = s.list.flatMap((entry) => {
          const college = getCollege(entry.collegeId);
          if (!college) return [];
          const chance = computeChance(s.profile, college, entry.round);
          counts[chance.band] += 1;
          return [{ name: college.name, round: entry.round, band: chance.band, odds: `${chance.low}–${chance.high}%`, cost: college.costPerYear }];
        });
        const overBudget = s.profile.budgetMax
          ? rows.filter((r) => r.cost > (s.profile.budgetMax ?? Infinity)).map((r) => r.name)
          : [];
        return { total: rows.length, counts, schools: rows, over_budget: overBudget };
      },
    }),

    scenario_simulator: tool({
      description:
        "A what-if. Recomputes odds against a hypothetical score, GPA, or round without touching anything real. Present the result as a hypothetical, never a promise.",
      inputSchema: z.object({
        sat: z.number().optional().describe("Hypothetical SAT."),
        gpa: z.number().optional().describe("Hypothetical unweighted GPA."),
        round: z.enum(ROUNDS).default("RD"),
        colleges: z.array(z.string()).optional().describe("Names or ids. Defaults to their saved list."),
      }),
      execute: async ({ sat, gpa, round, colleges }) => {
        const hypothetical = {
          ...s.profile,
          ...(sat != null ? { sat } : {}),
          ...(gpa != null ? { gpaUnweighted: gpa } : {}),
        };
        const targets = (colleges?.length
          ? colleges.map(resolveCollege).filter(Boolean)
          : s.list.map((e) => getCollege(e.collegeId)).filter(Boolean)) as (typeof COLLEGES)[number][];
        if (!targets.length) return { error: "No schools to run this against — their list is empty and none were named." };
        return {
          assuming: { sat: hypothetical.sat, gpa: hypothetical.gpaUnweighted, round },
          results: targets.map((college) => {
            const now = computeChance(s.profile, college, round);
            const then = computeChance(hypothetical, college, round);
            return {
              name: college.name,
              now: `${now.low}–${now.high}% (${now.band})`,
              hypothetical: `${then.low}–${then.high}% (${then.band})`,
            };
          }),
        };
      },
    }),

    /* ──────────────────────────── applications ──────────────────────── */

    list_applications: tool({
      description: "The application tracker: rounds, deadlines, what's still outstanding, decisions.",
      inputSchema: z.object({}),
      execute: async () =>
        s.applications.map((a) => ({
          id: a.id,
          college: a.collegeName,
          round: a.round,
          deadline: a.deadline,
          status: a.status,
          decision: a.decision,
          outstanding: APPLICATION_ITEMS.filter((k) => (a.items[k] ?? "todo") === "todo"),
          recommenders: a.recommenders,
        })),
    }),

    upsert_application: tool({
      description: "Start or update a tracked application when the student commits to a school.",
      inputSchema: z.object({
        college: z.string(),
        round: z.enum(["ED", "ED2", "EA", "REA", "RD", "Rolling"]).default("RD"),
        deadline: z.string().optional().describe("YYYY-MM-DD."),
        status: z.enum(["planning", "in_progress", "submitted"]).optional(),
        notes: z.string().optional(),
      }),
      execute: async ({ college, round, deadline, status, notes }) => {
        const known = resolveCollege(college);
        const name = known?.name ?? college;
        const now = Date.now();
        const existing = s.applications.find((a) => a.collegeName.toLowerCase() === name.toLowerCase());
        if (existing) {
          s.applications = s.applications.map((a) =>
            a.id === existing.id
              ? { ...a, round, deadline: deadline ?? a.deadline, status: status ?? a.status, notes: notes ?? a.notes, updatedAt: now }
              : a
          );
          touch("applications");
          return { updated: existing.id, college: name };
        }
        const app: Application = {
          id: uid(),
          collegeId: known?.id ?? null,
          collegeName: name,
          round,
          deadline: deadline ?? null,
          status: status ?? "planning",
          decision: "pending",
          items: {},
          recommenders: [],
          notes,
          createdAt: now,
          updatedAt: now,
        };
        s.applications = [...s.applications, app];
        touch("applications");
        return { created: app.id, college: name };
      },
    }),

    set_application_item: tool({
      description: "Mark one requirement on an application — transcript sent, essay done, FAFSA filed.",
      inputSchema: z.object({
        college: z.string(),
        item: z.enum(APPLICATION_ITEMS as unknown as [string, ...string[]]),
        status: z.enum(["todo", "in_progress", "done", "na"]),
      }),
      execute: async ({ college, item, status }) => {
        const app = s.applications.find((a) => a.collegeName.toLowerCase().includes(college.toLowerCase()));
        if (!app) return { error: `No tracked application for ${college}. Add it with upsert_application first.` };
        s.applications = s.applications.map((a) =>
          a.id === app.id
            ? { ...a, items: { ...a.items, [item]: status }, updatedAt: Date.now() }
            : a
        );
        touch("applications");
        return { college: app.collegeName, item, status };
      },
    }),

    set_recommender: tool({
      description: "Track who is writing a recommendation and whether it has landed.",
      inputSchema: z.object({
        college: z.string(),
        name: z.string(),
        role: z.string().optional().describe("e.g. 'AP Chemistry teacher'."),
        status: z.enum(["requested", "received"]).default("requested"),
      }),
      execute: async ({ college, name, role, status }) => {
        const app = s.applications.find((a) => a.collegeName.toLowerCase().includes(college.toLowerCase()));
        if (!app) return { error: `No tracked application for ${college}.` };
        s.applications = s.applications.map((a) =>
          a.id === app.id
            ? {
                ...a,
                recommenders: [...a.recommenders.filter((r) => r.name !== name), { name, role, status }],
                updatedAt: Date.now(),
              }
            : a
        );
        touch("applications");
        return { college: app.collegeName, recommender: name, status };
      },
    }),

    record_decision: tool({
      description: "Record an admissions outcome.",
      inputSchema: z.object({
        college: z.string(),
        decision: z.enum(["pending", "accepted", "waitlisted", "deferred", "rejected"]),
      }),
      execute: async ({ college, decision }) => {
        const app = s.applications.find((a) => a.collegeName.toLowerCase().includes(college.toLowerCase()));
        if (!app) return { error: `No tracked application for ${college}.` };
        s.applications = s.applications.map((a) => (a.id === app.id ? { ...a, decision, updatedAt: Date.now() } : a));
        touch("applications");
        return { college: app.collegeName, decision };
      },
    }),

    application_readiness: tool({
      description:
        "Where every application actually stands: what's outstanding and which deadlines are close. Run this before telling them what to prioritise.",
      inputSchema: z.object({}),
      execute: async () => {
        const today = new Date();
        return s.applications.map((a) => {
          const days = a.deadline
            ? Math.round((new Date(`${a.deadline}T23:59:59`).getTime() - today.getTime()) / 86_400_000)
            : null;
          const outstanding = APPLICATION_ITEMS.filter((k) => (a.items[k] ?? "todo") === "todo");
          return {
            college: a.collegeName,
            round: a.round,
            deadline: a.deadline,
            days_left: days,
            status: a.status,
            outstanding,
            at_risk: days != null && days <= 21 && outstanding.length > 2,
          };
        });
      },
    }),

    /* ────────────────────────────── essays ─────────────────────────── */

    list_essays: tool({
      description:
        "The student's essays: title, kind, prompt, word count against the limit, and whether each has been reviewed. Check here before essay advice so you know what already exists.",
      inputSchema: z.object({}),
      execute: async () =>
        s.essays.map((e) => ({
          id: e.id,
          title: e.title,
          kind: e.kind,
          college: e.collegeName,
          prompt: e.prompt || undefined,
          words: (e.content.trim().match(/\S+/g) ?? []).length,
          word_limit: e.wordLimit,
          reviewed: Boolean(e.feedback),
          drafts_saved: e.versions.length,
        })),
    }),

    get_essay: tool({
      description:
        "Read one essay in full, with its prompt and its last rubric review. Use it before giving feedback so you are talking about what they actually wrote.",
      inputSchema: z.object({ id: z.string().describe("From list_essays.") }),
      execute: async ({ id }) => {
        const essay = s.essays.find((e) => e.id === id);
        if (!essay) return { error: "No essay with that id. Call list_essays first." };
        return {
          title: essay.title,
          kind: essay.kind,
          prompt: essay.prompt || undefined,
          word_limit: essay.wordLimit,
          content: essay.content,
          last_review: essay.feedback
            ? { verdict: essay.feedback.verdict, scores: essay.feedback.scores, at: new Date(essay.feedback.at).toISOString() }
            : undefined,
        };
      },
    }),

    /* ──────────────────────────── transcript ───────────────────────── */

    get_transcript: tool({
      description:
        "Their four-year record: every course by grade level with its level and grade, every test attempt, and every award. Read it before advising on rigor, course selection, testing strategy, or how their record reads to an admissions office. The school side only knows the current term; this is the rest.",
      inputSchema: z.object({
        year: z.number().int().min(9).max(12).optional().describe("Just one grade level. Omit for all four."),
      }),
      execute: async ({ year }) => {
        const rows = year ? s.coursework.filter((c) => c.year === year) : s.coursework;
        if (!rows.length && !s.testing.length && !s.awards.length) {
          return { error: "Nothing is recorded yet. Ask them about their courses and scores rather than assuming." };
        }
        return {
          coursework: rows.map((c) => ({ year: c.year, course: c.course, level: c.level, grade: c.grade, term: c.term })),
          testing: s.testing.map((t) => ({ test: t.test, date: t.date, score: t.score })),
          awards: s.awards.map((a) => ({ name: a.name, level: a.level, year: a.year })),
        };
      },
    }),

    record_transcript_course: tool({
      description:
        "Add a course to their transcript when they mention one that isn't recorded — a class from an earlier year, or one you learn about mid-conversation.",
      inputSchema: z.object({
        year: z.number().int().min(9).max(12),
        course: z.string().min(2),
        level: z.enum(["regular", "honors", "AP", "IB", "dual-enrollment"]).default("regular"),
        grade: z.string().optional().describe("Exactly as their transcript prints it."),
        term: z.string().optional().describe('When the grade is per-term, e.g. "S1".'),
      }),
      execute: async ({ year, course, level, grade, term }) => {
        const clash = s.coursework.find(
          (c) => c.year === year && c.course.toLowerCase() === course.toLowerCase() && (c.term ?? "") === (term ?? "")
        );
        if (clash) return { error: `Already recorded: ${course} in grade ${year}.` };
        s.coursework = [
          ...s.coursework,
          { id: uid(), year: year as 9 | 10 | 11 | 12, course, level, grade, term },
        ];
        touch("coursework");
        return { recorded: course, year };
      },
    }),

    record_test_score: tool({
      description:
        "Record a score they just told you — an SAT or ACT sitting, a PSAT, an AP result. Kept per attempt, since superscoring and score choice both need the history. For their headline SAT/ACT also call update_profile_fact.",
      inputSchema: z.object({
        test: z.string().min(2).describe('"SAT", "ACT", "PSAT", "AP Chemistry".'),
        score: z.string().min(1).describe('As reported — "1480", "1510 (740 RW / 770 M)", "5".'),
        date: z.string().optional().describe("YYYY-MM or YYYY-MM-DD."),
      }),
      execute: async ({ test, score, date }) => {
        s.testing = [...s.testing, { id: uid(), test, score, date }];
        touch("testing");
        return { recorded: test, score };
      },
    }),

    record_award: tool({
      description: "Record an award, honor, ranking, or publication.",
      inputSchema: z.object({
        name: z.string().min(2),
        level: z.enum(["school", "regional", "state", "national", "international"]).default("school"),
        year: z.number().int().optional(),
      }),
      execute: async ({ name, level, year }) => {
        if (s.awards.some((a) => a.name.toLowerCase() === name.toLowerCase())) {
          return { error: `Already recorded: ${name}.` };
        }
        s.awards = [...s.awards, { id: uid(), name, level, year }];
        touch("awards");
        return { recorded: name, level };
      },
    }),

    /* ─────────────────────────── school side ───────────────────────── */

    get_school_grades: tool({
      description:
        "This student's REAL current classes and grades, live from Schoology — course names, percentages, letters, and how each grade is weighted by category. Use it before saying anything about their transcript, rigor, GPA, or a class that's slipping. This is the actual gradebook, not what they typed into their profile.",
      inputSchema: z.object({
        course: z.string().optional().describe("Narrow to one class by name or short code. Omit for all of them."),
      }),
      execute: async ({ course }) => {
        if (!ctx.school) {
          return {
            error:
              "Their Schoology hasn't synced, so you have no real gradebook. Ask them about their classes rather than assuming.",
          };
        }
        const q = course?.toLowerCase();
        const rows = q
          ? ctx.school.courses.filter(
              (c) => c.name.toLowerCase().includes(q) || c.short.toLowerCase().includes(q)
            )
          : ctx.school.courses;
        if (!rows.length) return { error: `No class matching "${course}". Their classes: ${ctx.school.courses.map((c) => c.name).join(", ")}.` };
        return {
          term_gpa_unweighted: ctx.school.gpa,
          note: "term_gpa_unweighted is this term's percentages on a 4.0 scale, not a cumulative transcript GPA.",
          courses: rows,
        };
      },
    }),

    get_school_workload: tool({
      description:
        "What this student actually owes right now — overdue work, what's due next, and recently graded items. Use it before telling them to take on something new, and when a grade drop needs explaining.",
      inputSchema: z.object({}),
      execute: async () => {
        if (!ctx.school) {
          return { error: "Their Schoology hasn't synced. Ask what their week looks like instead of guessing." };
        }
        return {
          overdue: ctx.school.overdue,
          due_next: ctx.school.upcoming,
          recently_graded: ctx.school.recent,
        };
      },
    }),

    /* ──────────────────────────── research ─────────────────────────── */

    search_counseling_library: tool({
      description:
        "Search the counseling library — the real guides, workshops, and strategy documents this practice has written on essays, testing, activities, aid, summer programs, competitions, and admissions strategy. Use it before answering anything about HOW to do something: how to structure a 'why us' essay, what makes a tier-1 activity, how to ask for a recommendation, how to plan a summer. This is the house view and it beats your training data.",
      inputSchema: z.object({
        query: z.string().min(3).describe("What you actually want to know, in a sentence. Not a keyword."),
        topics: z
          .array(z.enum(KNOWLEDGE_TOPICS as unknown as [string, ...string[]]))
          .optional()
          .describe("Narrow to these topics when you're confident which apply. Omit to search everything."),
      }),
      execute: async ({ query, topics }) => {
        const status = libraryStatus();
        if (!status.ready) {
          return {
            error:
              "No counseling library is indexed on this machine. Answer from your own knowledge and say plainly that you're doing so.",
          };
        }
        const hits = await searchLibrary(query, {
          topics: topics as never,
          limit: 6,
        });
        if (!hits.length) return { note: "Nothing in the library covers that. Say so rather than implying it does." };
        ctx.sources.push(
          ...hits.map((hit) => ({ title: hit.title, origin: "library" as const }))
        );
        return { passages: formatHits(hits) };
      },
    }),

    /* ──────────────────────────── asking ───────────────────────────── */

    ask_user_questions: tool({
      description:
        "Ask the student 1-4 short structured questions when you need a concrete decision or fact to advise well — which round, which essay to prioritise, a budget ceiling, which school to cut. It opens a small form rather than burying the questions in prose. After calling this, STOP: their next message carries the answers. Do not also ask the same things in text.",
      inputSchema: z.object({
        questions: z
          .array(
            z.object({
              question: z.string().min(4).describe("One clear question."),
              options: z
                .array(z.string().min(1))
                .max(5)
                .describe("2-5 choices. Leave empty for a free-text answer."),
              multi: z.boolean().default(false).describe("True when several answers can apply at once."),
            })
          )
          .min(1)
          .max(4),
      }),
      execute: async ({ questions }) => {
        ctx.ask = questions.map((q) => ({
          question: q.question,
          options: q.options ?? [],
          multi: Boolean(q.multi),
        }));
        return { asked: questions.length, note: "The form is open. Stop here and wait for their answers." };
      },
    }),

    student_snapshot: tool({
      description:
        "The student's own numbers as the chance engine sees them, including their SAT-equivalent when they only have an ACT.",
      inputSchema: z.object({}),
      execute: async () => ({
        name: s.profile.name,
        grade: s.profile.gradeLevel,
        gpa: s.profile.gpaUnweighted,
        rigor: s.profile.rigor,
        sat: s.profile.sat,
        act: s.profile.act,
        sat_equivalent: effectiveSat(s.profile),
        major: s.profile.intendedMajor,
        budget: s.profile.budgetMax,
        activities: s.profile.activities,
        list: s.list.map((e) => ({ college: getCollege(e.collegeId)?.name ?? e.collegeId, round: e.round })),
      }),
    }),
  };
}

/** What the working panel calls each tool while it runs. */
export const TOOL_LABEL: Record<string, string> = {
  get_memories: "Checking what I remember",
  save_memory: "Remembering that",
  update_memory: "Updating a memory",
  update_profile_fact: "Recording that on your profile",
  get_tasks: "Reading your next steps",
  create_task: "Adding a next step",
  update_task: "Updating a next step",
  list_documents: "Looking through your documents",
  get_document: "Reading a document",
  create_document: "Writing a document",
  update_document: "Revising a document",
  list_meetings: "Checking your calendar",
  schedule_meeting: "Booking a check-in",
  reschedule_meeting: "Moving a check-in",
  cancel_meeting: "Cancelling a check-in",
  find_matching_colleges: "Ranking schools against your numbers",
  check_chances: "Running your odds",
  add_to_list: "Adding to your list",
  remove_from_list: "Cutting from your list",
  college_list_health_check: "Checking your list's balance",
  scenario_simulator: "Running the what-if",
  list_applications: "Reading your tracker",
  upsert_application: "Updating your tracker",
  set_application_item: "Ticking off a requirement",
  set_recommender: "Tracking a recommender",
  record_decision: "Recording a decision",
  application_readiness: "Checking deadline risk",
  student_snapshot: "Pulling up your numbers",
  search_counseling_library: "Reading the counseling library",
  list_essays: "Looking at your essays",
  get_essay: "Reading your essay",
  get_transcript: "Reading your transcript",
  record_transcript_course: "Recording a course",
  record_test_score: "Recording a score",
  record_award: "Recording an award",
  get_school_grades: "Pulling your real gradebook",
  get_school_workload: "Checking what you owe this week",
  ask_user_questions: "Asking you something",
  web_search: "Searching the web",
};
