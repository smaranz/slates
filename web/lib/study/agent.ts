import "server-only";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Agent, JsonlLocalAgentStore, type SDKCustomTool, type SDKCustomToolResult, type SDKJsonValue } from "@cursor/sdk";

import { noteUsage } from "@/lib/ai-usage/note";
import { browserMcp, ensureBrowser } from "@/lib/agent/browser";
import { listModels } from "@/lib/agent/engine";
import { buildTools } from "@/lib/agent/tools";
import { DEFAULT_MODEL } from "@/lib/agent/types";
import { listMaterials, readSchoologyFile } from "./gather";
import type { StoredMaterial } from "./store";
import type { BuildRequest, StudyActivity, StudySource } from "./types";
import { finishSet, GROUNDING, SET_WRITING, SetSchema, type WrittenSet } from "./write";

/**
 * The study agent: a study set written by an agent with everything the Agent
 * app's teammates have — the host's shell and files, web search, the shared
 * Chrome (whose sign-ins persist, and which you can watch or take over in
 * Agent → Computer), the Slates board — plus tools for reading the class's
 * Schoology Materials through Slates' own signed-in session.
 *
 * It starts from what `gather` already found, goes after what that couldn't
 * read (Google Docs and Slides, outside links, other folders), and hands the
 * finished set to `save_study_set`, which checks it the same way the plain
 * writer's output is checked.
 */

const PREFERRED = ["claude-opus-5-5", "claude-opus-5", "gpt-5.6-sol", DEFAULT_MODEL];
/** A build that researches for longer than this is stopped; whatever it saved stands. */
const LIMIT_MS = 15 * 60_000;
const HOME = path.join(os.homedir(), ".slates", "study");
const store = new JsonlLocalAgentStore(path.join(HOME, "runtime"));

export interface AgentBuild {
  request: BuildRequest;
  sources: StudySource[];
  material: StoredMaterial[];
  onActivity: (entry: StudyActivity) => void;
  onSource: (source: StudySource, text: string) => void;
  onSave: (set: WrittenSet) => Promise<void>;
}

type Args = Record<string, SDKJsonValue>;
const str = (value: SDKJsonValue | undefined): string => (typeof value === "string" ? value : value == null ? "" : String(value));

function tool(description: string, properties: Record<string, SDKJsonValue>, required: string[], execute: (args: Args) => Promise<SDKCustomToolResult> | SDKCustomToolResult): SDKCustomTool {
  return {
    description,
    inputSchema: { type: "object", properties, required },
    execute: async (args) => {
      try {
        return await execute(args);
      } catch (error) {
        return { content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true };
      }
    },
  };
}

export async function studyWithAgent(build: AgentBuild): Promise<{ model: string; saved: boolean }> {
  const { request } = build;
  const domain = request.domain && /^[\w.-]+\.schoology\.com$/.test(request.domain) ? request.domain : "";
  const absolute = (url: string | null) => (url && url.startsWith("/") && domain ? `https://${domain}${url}` : url);
  const sources = [...build.sources];
  let saved = false;

  const register = (entry: Omit<StudySource, "n">, text: string): StudySource => {
    const same = sources.find((source) => source.url && (source.url === entry.url || absolute(source.url) === entry.url));
    if (same?.read) return same;
    // A link the class posted that the agent has now read keeps its number and the teacher's title.
    const source = same
      ? { ...same, read: true, chars: entry.chars, note: undefined }
      : { ...entry, n: sources.length + 1 };
    if (same) sources[sources.indexOf(same)] = source;
    else sources.push(source);
    build.onSource(source, text);
    return source;
  };

  const models = await listModels();
  const model = PREFERRED.find((id) => models.some((entry) => entry.id === id)) ?? DEFAULT_MODEL;

  let browser = browserMcp();
  if (browser) {
    try {
      await ensureBrowser();
    } catch {
      browser = null;
    }
  }

  const slates = buildTools({
    agentId: "study",
    chatId: "study",
    post: () => {},
    handoff: () => "Handoffs aren't available while building a study set.",
  });

  const tools: Record<string, SDKCustomTool> = {
    slates_board: slates.slates_board!,
    list_skills: slates.list_skills!,
    get_skill: slates.get_skill!,
    schoology_materials: tool(
      "List one level of this class's Schoology Materials (folders, documents, links, pages) through Slates' signed-in session. Omit folderId for the top level.",
      { folderId: { type: "string", description: "A folder id from an earlier listing." } },
      [],
      async (args) => {
        const items = await listMaterials(request.course.id, str(args.folderId) || null);
        if (!items.length) return "This folder is empty.";
        return items
          .map((item) => item.kind === "folder" ? `- [folder ${item.folderId}] ${item.title}` : `- [${item.kind}] ${item.title} — ${absolute(item.url)}`)
          .join("\n");
      },
    ),
    schoology_read: tool(
      "Read the text of a Schoology file (a Materials document or an attachment: PDF, Word, PowerPoint, text) through Slates' signed-in session. It becomes a numbered source you can cite.",
      {
        url: { type: "string", description: "The Schoology link, e.g. /course/123/materials/gp/456 or /attachment/…" },
        title: { type: "string", description: "What the file is called." },
      },
      ["url", "title"],
      async (args) => {
        const url = str(args.url).replace(/^https?:\/\/[^/]+/i, "");
        const text = await readSchoologyFile(url);
        const source = register({ title: str(args.title) || "Schoology file", kind: "material", where: "Materials, found by the study agent", url, chars: text.length, read: true }, text);
        return `[${source.n}] ${source.title}\n\n${text}`;
      },
    ),
    add_source: tool(
      "Register an outside page you read (in the browser or with web search) so you can cite it as [n]. Only for pages you actually used.",
      {
        title: { type: "string" },
        url: { type: "string" },
        notes: { type: "string", description: "What you took from it, in your own words (up to about 3,000 characters). Used later for more practice." },
      },
      ["title", "url", "notes"],
      async (args) => {
        const url = str(args.url);
        if (!/^https?:\/\//i.test(url)) throw new Error("url must be a full http(s) link.");
        // Cited pages have to exist. A sign-in wall still answers; a made-up link doesn't.
        const status = await fetch(url, { redirect: "follow", signal: AbortSignal.timeout(10_000), headers: { "user-agent": "Mozilla/5.0 (Slates study agent)" } })
          .then((response) => response.status, () => 0);
        if (status === 0 || status === 404 || status === 410) {
          throw new Error(`${url} couldn't be reached (${status || "no answer"}). Only cite pages you actually opened.`);
        }
        const notes = str(args.notes).slice(0, 4_000);
        const source = register({ title: str(args.title) || new URL(url).hostname, kind: "web", where: new URL(url).hostname.replace(/^www\./, ""), url, chars: notes.length, read: true }, notes);
        return `Cite it as [${source.n}].`;
      },
    ),
    save_study_set: tool(
      "Save the finished study set. It is checked; if something is wrong you get the problems back, so fix them and call it again. Call it once the set is complete.",
      {
        overview: { type: "string" },
        guide: { type: "string", description: "Markdown study guide citing [n]." },
        cards: { type: "array", items: { type: "object" } },
        questions: { type: "array", items: { type: "object" } },
      },
      ["overview", "guide", "cards", "questions"],
      async (args) => {
        const parsed = SetSchema.safeParse(args);
        if (!parsed.success) {
          return { content: [{ type: "text", text: `Not saved. Fix these and call save_study_set again:\n${parsed.error.issues.slice(0, 10).map((issue) => `- ${issue.path.join(".") || "set"}: ${issue.message}`).join("\n")}` }], isError: true };
        }
        await build.onSave(finishSet(parsed.data, new Set(sources.filter((source) => source.read).map((source) => source.n))));
        saved = true;
        return "Saved. End your turn with one sentence on what you used.";
      },
    ),
  };

  const cwd = path.join(HOME, "work", request.target.id);
  fs.mkdirSync(cwd, { recursive: true });
  const sdk = await Agent.create({
    model: { id: model },
    local: { cwd, store, customTools: tools },
    ...(browser ? { mcpServers: { browser } } : {}),
  });

  try {
    const run = await sdk.send({ text: brief(build, sources, absolute, !!browser) }, {
      mode: "agent",
      onDelta: ({ update }) => {
        const u = update as { type: string; toolCall?: { type?: string; args?: Record<string, unknown> } };
        if (u.type !== "tool-call-started") return;
        build.onActivity({ at: Date.now(), ...describe(u.toolCall) });
      },
    });
    const timer = setTimeout(() => void run.cancel().catch(() => {}), LIMIT_MS);
    const result = await run.wait().finally(() => clearTimeout(timer));
    try {
      const usage = await sdk.getUsage();
      noteUsage({
        agent: "study", model, backend: "cursor", covered: true,
        inputTokens: usage.usage.inputTokens, outputTokens: usage.usage.outputTokens,
        reasoningTokens: usage.usage.reasoningTokens ?? 0, cacheReadTokens: usage.usage.cacheReadTokens,
      });
    } catch {
      noteUsage({ agent: "study", model, backend: "cursor", inputTokens: 0, outputTokens: 0, covered: true });
    }
    if (result.status === "error" && !saved) throw new Error((result as { error?: { message?: string } }).error?.message ?? "The study agent's run failed.");
    return { model, saved };
  } finally {
    sdk.close();
    await Agent.delete(sdk.agentId, { cwd, store }).catch(() => {});
  }
}

function brief(build: AgentBuild, sources: StudySource[], absolute: (url: string | null) => string | null, browser: boolean): string {
  const { target, course } = build.request;
  const text = new Map(build.material.map((entry) => [entry.n, entry.text]));
  const read = sources.filter((source) => source.read);
  const unread = sources.filter((source) => !source.read);
  return [
    `You are the study agent in Slates. Build a study set for a high-school student's upcoming ${target.testKind}: "${target.title}" in ${course.name}${target.due ? ` (${target.due})` : ""}.`,
    "",
    "WHAT YOU HAVE",
    "- The student's always-on computer: shell, files (your working folder is private to this build) and web search.",
    browser
      ? "- A real Chrome browser (browser_* tools) shared with the student's other agents; its sign-ins persist. If a page wants a password, 2FA or a CAPTCHA, skip it — the student isn't watching this run — and say which source needed a sign-in in your final sentence."
      : "- No browser this time (Chrome isn't available on the host); use web search and the Schoology tools.",
    "- schoology_materials and schoology_read: this class's Schoology Materials and files, through Slates' own signed-in Schoology session (no browser sign-in needed).",
    "- slates_board: the student's classes, grades and assignments. list_skills / get_skill: the student's saved instructions; check for one about study guides.",
    "- add_source to cite outside pages, and save_study_set to hand in the finished set.",
    "",
    "WHAT SLATES ALREADY FOUND IN SCHOOLOGY",
    read.length
      ? `SOURCES:\n${read.map((source) => `[${source.n}] ${source.title} — ${source.where}${source.url ? ` — ${absolute(source.url)}` : ""}\n${text.get(source.n) ?? ""}`).join("\n\n")}`
      : "Nothing readable was posted for this test.",
    unread.length
      ? `\nFOUND BUT NOT READ (open the ones that could matter):\n${unread.map((source) => `[${source.n}] ${source.title} — ${source.where}${source.url ? ` — ${absolute(source.url)}` : ""}${source.note ? ` (${source.note})` : ""}`).join("\n")}`
      : "",
    "",
    "YOUR JOB",
    "1. Read the sources and work out what the test covers.",
    "2. Get what's missing. Open the unread links in the browser (Google Docs, Slides, videos, Quizlet sets). If the unit looks incomplete, look through the class's Materials with schoology_materials and read what's relevant with schoology_read. Use the web only where the class material is thin, prefer reputable sources (textbooks, universities, Khan Academy, OpenStax), and add_source every outside page you use. Spend at most about ten minutes gathering.",
    "3. Write the set from all of it and call save_study_set. If it reports problems, fix them and call it again.",
    "",
    GROUNDING,
    "",
    SET_WRITING,
    "",
    "Never submit, post or send anything anywhere, never message anyone, and never type a password.",
  ].filter((line) => line !== "").join("\n");
}

function describe(toolCall: { type?: string; args?: Record<string, unknown> } | undefined): Omit<StudyActivity, "at"> {
  const args = (toolCall?.args ?? {}) as Record<string, unknown>;
  if (toolCall?.type === "mcp") {
    const name = String(args.toolName ?? "");
    const inner = (args.args ?? {}) as Record<string, unknown>;
    if (name === "browser_navigate") return { label: "Opened a page", detail: String(inner.url ?? "") };
    if (name.startsWith("browser_")) return { label: `Browser: ${name.slice(8).replace(/_/g, " ")}` };
    if (name === "schoology_materials") return { label: "Looked through the class’s Materials" };
    if (name === "schoology_read") return { label: "Read a Schoology file", detail: String(inner.title ?? "") };
    if (name === "add_source") return { label: "Used a source", detail: String(inner.title ?? "") };
    if (name === "save_study_set") return { label: "Saved the study set" };
    if (name === "slates_board") return { label: "Read your board" };
    if (name === "get_skill" || name === "list_skills") return { label: "Checked your saved skills" };
    return { label: name.replace(/[_-]+/g, " ") };
  }
  const type = String(toolCall?.type ?? "");
  if (/web.?search/i.test(type)) return { label: "Searched the web", detail: String(args.query ?? args.searchTerm ?? "") };
  if (/web.?fetch/i.test(type)) return { label: "Read a web page", detail: String(args.url ?? "") };
  if (type === "shell") return { label: "Ran a command", detail: String(args.command ?? "").slice(0, 160) };
  if (["grep", "glob", "ls", "semSearch"].includes(type)) return { label: "Searched its notes" };
  if (type === "read") return { label: "Read a file" };
  if (type === "edit" || type === "write") return { label: "Wrote notes" };
  if (type === "task") return { label: "Worked on a sub-task" };
  return { label: type.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase() || "Worked" };
}
