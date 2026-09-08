import os from "node:os";
import path from "node:path";

import { configureCursorSdk, JsonlLocalAgentStore } from "@cursor/sdk";

/**
 * The packaged desktop app runs on Electron's bundled Node (20.x), which has
 * no `node:sqlite` — the SDK's default local-agent store needs it and throws
 * without one configured. A JSONL-backed store needs nothing but the
 * filesystem, so it works under any runtime this app ships on; `~/.slates` is
 * the same persistent-state folder Slates already uses.
 *
 * This has to run once, before any `Agent.create`/`Agent.resume` call, so it
 * lives as a module-level side effect here rather than at each call site —
 * Node only evaluates a module once per process, so importing this from both
 * routes that use the Cursor SDK configures it exactly once.
 */
configureCursorSdk({
  local: { store: new JsonlLocalAgentStore(path.join(os.homedir(), ".slates", "cursor-agent-store")) },
});

export { Agent } from "@cursor/sdk";
