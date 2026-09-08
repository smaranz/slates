import type { ClaudeCodeSettings } from "ai-sdk-provider-claude-code";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Agent Skills, and what the tutor is allowed to do with them.
 *
 * Only one of the tutor's four backends can genuinely run a skill: the
 * `claude-code` one, which drives a local Claude Code session that already
 * understands `SKILL.md`, its scripts, and its assets. The API backends
 * (OpenAI, OpenRouter) and the Cursor CLI have no such concept, so for them a
 * skill can only ever be text folded into the prompt — the same guidance, no
 * file at the end of it.
 *
 * Both paths live here so the difference is stated once, in one place, rather
 * than implied by two prompts drifting apart.
 */

/** Where the app's own skills live: the repo's `.claude/skills`. */
export const PROJECT_ROOT = path.resolve(process.cwd(), "..");

/**
 * The tutor's own working directory.
 *
 * A session's sandbox implicitly allows writes to its working directory —
 * `allowWrite` adds to that rather than replacing it. With the repo as cwd, a
 * probe asked for a file in the source tree and got one. So the tutor is given
 * a workspace of its own instead, and the repo is somewhere it merely reads
 * from.
 */
export const WORKSPACE = path.join(os.homedir(), ".slates", "tutor-workspace");

/**
 * Everything a skill writes lands here.
 *
 * Deliberately outside the repo and outside anything Slates reads back as
 * configuration: a tutor that can write files is a tutor a student can talk
 * into writing the wrong file, and the only reliable answer is that there is
 * nowhere else it can write. Enforced by the OS sandbox below, not by asking.
 */
export const OUTPUT_DIR = path.join(WORKSPACE, "output");

/**
 * Build the workspace: an output folder, and the app's skills linked in where
 * a session running here will discover them.
 *
 * Linked rather than copied so the repo stays the single source of truth —
 * editing a skill takes effect without a sync step.
 */
export function ensureWorkspace(): string {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const linkDir = path.join(WORKSPACE, ".claude");
  const link = path.join(linkDir, "skills");
  const source = path.join(PROJECT_ROOT, ".claude", "skills");
  fs.mkdirSync(linkDir, { recursive: true });
  try {
    if (fs.realpathSync(link) !== fs.realpathSync(source)) {
      fs.rmSync(link, { recursive: true, force: true });
    }
  } catch {
    // Nothing there, or a dangling link — either way, (re)create it below.
    fs.rmSync(link, { recursive: true, force: true });
  }
  if (!fs.existsSync(link) && fs.existsSync(source)) {
    fs.symlinkSync(source, link, "dir");
  }
  return OUTPUT_DIR;
}

/** Skill folder names available to this install, project and personal both. */
export function installedSkills(): string[] {
  const dirs = [
    path.join(PROJECT_ROOT, ".claude", "skills"),
    path.join(os.homedir(), ".claude", "skills"),
  ];
  const names = new Set<string>();
  for (const dir of dirs) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      /*
       * `existsSync` on the SKILL.md rather than `entry.isDirectory()`: a
       * Dirent reports a symlink as a link, not a directory, and skills are
       * very often symlinked in from a checkout elsewhere — on this machine
       * 22 of 35 were, and every one of them was being missed.
       */
      if (fs.existsSync(path.join(dir, entry.name, "SKILL.md"))) names.add(entry.name);
    }
  }
  return [...names].sort();
}

/**
 * Provider options that turn skills on for a Claude Code session.
 *
 * `cwd` is the repo rather than the output directory on purpose: project
 * skills are discovered relative to it, and pointing it at the output folder
 * would hide `.claude/skills` entirely. The repo stays safe anyway, because
 * the sandbox makes the output directory the only writable path on the disk.
 */
/** Is `target` inside `root`? Resolved first, so `..` can't walk out. */
function isInside(root: string, target: string): boolean {
  const resolved = path.resolve(target);
  return resolved === root || resolved.startsWith(root + path.sep);
}

/** Tools that take a path and can therefore change something on disk. */
const WRITE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

/**
 * Provider settings that turn skills on, and the boundary that makes doing so
 * safe.
 *
 * The boundary is `canUseTool` — a callback consulted before every tool call —
 * and not the SDK's `sandbox` option, which was tried first and does not hold:
 * with `sandbox.enabled` and a `filesystem.allowWrite` naming only the
 * workspace, a probe asked for a file in the repo and got one, and
 * `failIfUnavailable` never fired. Permission *rules* fail the same way in the
 * other direction — every grant that let the workspace be written also let the
 * repo be written. Only this callback denied one while allowing the other, so
 * this is what the guarantee rests on.
 *
 * Note there is no `allowedTools` here. A bare entry in that list auto-approves
 * its tool *before* the callback is consulted, which silently disables the
 * boundary — the SDK warns about exactly this.
 */
export function claudeSkillOptions(): ClaudeCodeSettings {
  ensureWorkspace();

  return {
    cwd: WORKSPACE,
    // Personal skills too, which is how an install that has Anthropic's own
    // document skills gets real file output without Slates shipping them.
    settingSources: ["user", "project"] as const,
    skills: "all" as const,
    canUseTool: async (tool, input) => {
      /*
       * Bash is refused outright. A shell command can write anywhere no
       * matter what its arguments look like, so there is no honest way to
       * scope it with a pattern — and an unscoped shell is exactly what a
       * chat box in a student app must not have. Skills that are instructions
       * work fully; skills that shell out to their own scripts do not.
       */
      if (tool === "Bash" || tool === "BashOutput" || tool === "KillShell") {
        return { behavior: "deny", message: "The tutor can't run shell commands." };
      }

      if (WRITE_TOOLS.has(tool)) {
        const target = input.file_path ?? input.path ?? input.notebook_path;
        if (typeof target !== "string" || !isInside(WORKSPACE, target)) {
          return {
            behavior: "deny",
            message: `Files can only be written inside ${WORKSPACE}.`,
          };
        }
      }

      return { behavior: "allow", updatedInput: input };
    },
  };
}

/**
 * What the tutor is told about skills when it *can* run them.
 *
 * The output directory is named explicitly because the session's working
 * directory is the repo — a skill told to "save it here" would try to write
 * into the source tree and be refused by the sandbox.
 */
export function skillInstructionsForClaude(): string {
  const skills = installedSkills();
  if (!skills.length) return "";

  return [
    "You have Agent Skills available and may use them when one genuinely fits.",
    `Installed: ${skills.join(", ")}.`,
    "",
    `Write every file you produce into ${OUTPUT_DIR} — that is the only`,
    "writable path you have, and anything you try to save elsewhere is",
    "refused. Use a short, descriptive filename the student would recognise",
    '("photosynthesis-study-guide.docx", not "output.docx").',
    "",
    "You cannot run shell commands, so a skill that works by executing its own",
    "scripts will not run. Skills that are instructions you follow do work. If",
    "a skill needs a script, say plainly that you can't run it rather than",
    "pretending the file exists.",
    "",
    "Anything you write as a document can also be downloaded as a Word file",
    "without a skill, so don't reach for one just to produce a study guide.",
    "Use a skill when it does something you otherwise couldn't. Never make a",
    "file the student didn't ask for.",
    "",
    "After a skill writes a file, say in one line what you made and what it's",
    "for. The student sees it appear under your message; don't paste its",
    "contents back into the chat as well.",
  ].join("\n");
}

/**
 * What the tutor is told when it can't run skills.
 *
 * Not "you cannot make files" — every backend can, because a document the
 * tutor writes is converted to .docx server-side (see lib/tutor-export.ts).
 * What this backend lacks is *skills*, which is a different and much smaller
 * limitation than it used to be.
 */
export function skillInstructionsForTextOnlyBackend(): string {
  return [
    "You can't run Agent Skills on this model, but you can still produce real",
    "files: anything you write as a document can be downloaded as a Word file,",
    "so write it as a document and say it's ready to download.",
    "",
    "What you can't do here is anything that needs a script — generating a",
    "spreadsheet from data, building a slide deck, rendering a poster. Say so",
    "plainly rather than describing a file that won't exist.",
  ].join("\n");
}
