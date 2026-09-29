import { browserRunning } from "@/lib/agent/browser";
import { agentState, listModels, resetRuntime, runRoutine, stop } from "@/lib/agent/engine";
import { publish } from "@/lib/agent/hub";
import { nextRunAfter, normalizeSchedule } from "@/lib/agent/schedule";
import { agents, clearChat, ensureDirs, getAgent, groups, newId, routines, skills, updateAgent, WORKSPACE } from "@/lib/agent/store";
import { DEFAULT_MODEL, type AgentProfile, type Roster } from "@/lib/agent/types";
import { studentBook, viewBook } from "@/lib/learning/memory";

/** The Agent app's roster and settings: agents, groups, routines, skills. */

export const dynamic = "force-dynamic";

type Body = Record<string, unknown>;
const text = (value: unknown, max = 4000) => (typeof value === "string" ? value.trim().slice(0, max) : "");

export async function GET() {
  ensureDirs();
  const roster: Roster = {
    agents: agents.all().map((agent) => ({ ...agent, ...agentState(agent.id) })),
    groups: groups.all(),
    routines: routines.all(),
    skills: skills.all(),
    models: await listModels(),
    browser: { running: await browserRunning() },
    workspace: WORKSPACE,
    student: viewBook(studentBook()),
  };
  return Response.json(roster);
}

function fail(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return fail("Invalid JSON.");
  }
  ensureDirs();
  const id = text(body.id, 80);
  try {
    switch (body.op) {
      case "create-agent": {
        const name = text(body.name, 40).replace(/[@\n]/g, "");
        if (!name) return fail("Give the agent a name.");
        if (agents.all().some((a) => a.name.toLowerCase() === name.toLowerCase())) return fail(`There's already an agent called ${name}.`);
        const agent: AgentProfile = {
          id: newId("agt"),
          name,
          job: text(body.job, 200),
          rules: text(body.rules),
          model: text(body.model, 80) || DEFAULT_MODEL,
          hue: Math.floor(Math.random() * 360),
          voiceReplies: body.voiceReplies === true,
          createdAt: Date.now(),
          memory: [],
        };
        agents.save([...agents.all(), agent]);
        publish({ kind: "roster" });
        return Response.json({ agent });
      }
      case "update-agent": {
        const updated = updateAgent(id, (agent) => ({
          ...agent,
          ...(typeof body.name === "string" && text(body.name, 40) ? { name: text(body.name, 40).replace(/[@\n]/g, "") } : {}),
          ...(typeof body.job === "string" ? { job: text(body.job, 200) } : {}),
          ...(typeof body.rules === "string" ? { rules: text(body.rules) } : {}),
          ...(typeof body.model === "string" && text(body.model, 80) ? { model: text(body.model, 80) } : {}),
          ...(typeof body.voiceReplies === "boolean" ? { voiceReplies: body.voiceReplies } : {}),
        }));
        if (!updated) return fail("That agent doesn't exist.", 404);
        publish({ kind: "roster" });
        return Response.json({ agent: updated });
      }
      case "forget": {
        updateAgent(id, (agent) => ({ ...agent, memory: agent.memory.filter((m) => m.id !== body.memoryId) }));
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "reset-agent": {
        await resetRuntime(id);
        clearChat(id);
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "delete-agent": {
        if (!getAgent(id)) return fail("That agent doesn't exist.", 404);
        await resetRuntime(id);
        agents.save(agents.all().filter((a) => a.id !== id));
        routines.save(routines.all().filter((r) => r.agentId !== id));
        groups.save(groups.all().map((g) => ({ ...g, members: g.members.filter((m) => m !== id) })));
        clearChat(id);
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "stop": {
        await stop(id);
        return Response.json({ ok: true });
      }
      case "create-group":
      case "update-group": {
        const members = (Array.isArray(body.members) ? body.members : []).map(String).filter((m) => getAgent(m));
        if (body.op === "create-group") {
          if (members.length < 2) return fail("Pick at least two agents.");
          const group = { id: newId("grp"), name: text(body.name, 60) || "Group", members: [...new Set(members)].slice(0, 6), createdAt: Date.now() };
          groups.save([...groups.all(), group]);
          publish({ kind: "roster" });
          return Response.json({ group });
        }
        const all = groups.all();
        const group = all.find((g) => g.id === id);
        if (!group) return fail("That group doesn't exist.", 404);
        if (text(body.name, 60)) group.name = text(body.name, 60);
        if (members.length >= 2) group.members = [...new Set(members)].slice(0, 6);
        groups.save(all);
        publish({ kind: "roster" });
        return Response.json({ group });
      }
      case "delete-group": {
        groups.save(groups.all().filter((g) => g.id !== id));
        clearChat(id);
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "save-skill": {
        const name = text(body.name, 60);
        const instructions = text(body.instructions, 20_000);
        const description = text(body.description, 200) || undefined;
        if (!name || !instructions) return fail("A skill needs a name and instructions.");
        const all = skills.all();
        const existing = all.find((s) => s.id === id) ?? all.find((s) => s.name.toLowerCase() === name.toLowerCase());
        if (existing) Object.assign(existing, { name, instructions, description, updatedAt: Date.now(), by: "You" });
        else all.push({ id: newId("skl"), name, description, instructions, updatedAt: Date.now(), by: "You", uses: 0 });
        skills.save(all);
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "delete-skill": {
        skills.save(skills.all().filter((s) => s.id !== id));
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "create-routine": {
        const agentId = text(body.agentId, 80);
        if (!getAgent(agentId)) return fail("That agent doesn't exist.", 404);
        const prompt = text(body.prompt, 8000);
        if (!prompt) return fail("Say what the routine should do.");
        const schedule = normalizeSchedule({ days: body.days, time: body.time, everyMinutes: body.everyMinutes });
        const routine = {
          id: newId("rtn"), agentId, name: text(body.name, 80) || prompt.slice(0, 40), prompt, schedule,
          enabled: true, createdAt: Date.now(), nextRun: nextRunAfter(schedule, Date.now()), runs: [],
        };
        routines.save([...routines.all(), routine]);
        publish({ kind: "roster" });
        return Response.json({ routine });
      }
      case "update-routine": {
        const all = routines.all();
        const routine = all.find((r) => r.id === id);
        if (!routine) return fail("That routine doesn't exist.", 404);
        if (typeof body.enabled === "boolean") routine.enabled = body.enabled;
        if (text(body.name, 80)) routine.name = text(body.name, 80);
        if (text(body.prompt, 8000)) routine.prompt = text(body.prompt, 8000);
        if (body.days !== undefined || body.time !== undefined || body.everyMinutes !== undefined) {
          routine.schedule = normalizeSchedule({ days: body.days, time: body.time, everyMinutes: body.everyMinutes });
        }
        routine.nextRun = nextRunAfter(routine.schedule, Date.now());
        routines.save(all);
        publish({ kind: "roster" });
        return Response.json({ routine });
      }
      case "delete-routine": {
        routines.save(routines.all().filter((r) => r.id !== id));
        publish({ kind: "roster" });
        return Response.json({ ok: true });
      }
      case "run-routine": {
        return runRoutine(id, true) ? Response.json({ ok: true }) : fail("That routine doesn't exist.", 404);
      }
      default:
        return fail("Unknown operation.");
    }
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error), 500);
  }
}
