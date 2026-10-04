import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * One turn on Devin, through `devin acp`: the Agent Client Protocol, JSON-RPC
 * over stdio. `devin -p` only prints the finished answer; ACP streams the
 * thinking, the prose and each tool call as they happen, the same as the
 * other backends.
 *
 * The session runs in Devin's "ask" mode (answers questions, changes no
 * code), and Slates advertises no file system or terminal to it, so any
 * permission Devin asks for is turned down: a tutor has no business editing
 * files or running commands on the PC.
 *
 * Devin keeps its own record of every turn in its session database, which is
 * where AI Usage reads Devin's tokens from, so nothing is noted here.
 */

export interface DevinImage {
  data: string;
  mimeType: string;
}

export interface DevinHandlers {
  text(v: string): void;
  reasoning(v: string): void;
  tool(name: string, input: unknown): void;
  toolDone(name: string, ok: boolean): void;
}

/** The CLI: `SLATES_DEVIN_BIN`, else where its installer puts it, else whatever PATH finds. */
export function devinBin(): string {
  const candidates = [
    process.env.SLATES_DEVIN_BIN,
    process.platform === "win32"
      ? path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), "AppData", "Local"), "devin", "cli", "bin", "devin.exe")
      : path.join(os.homedir(), ".local", "bin", "devin"),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) ?? "devin";
}

type Message = {
  id?: number | string;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: { message?: string };
};

type Block = { type?: string; text?: string };

export async function runDevin(options: {
  model: string;
  prompt: string;
  images?: DevinImage[];
  cwd: string;
  signal?: AbortSignal;
  on: DevinHandlers;
}): Promise<void> {
  const { model, prompt, images = [], cwd, signal, on } = options;
  fs.mkdirSync(cwd, { recursive: true });
  const child = spawn(devinBin(), ["acp", "--model", model], { cwd, stdio: ["pipe", "pipe", "pipe"], windowsHide: true });

  let stderr = "";
  child.stderr.on("data", (d: Buffer) => {
    stderr = (stderr + d.toString()).slice(-4000);
  });

  let nextId = 0;
  const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  const write = (msg: object) => {
    if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
  };
  const call = (method: string, params: object) =>
    new Promise<unknown>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      write({ id, method, params });
    });

  // Ends every call still waiting when the process goes away.
  const exited = new Promise<void>((resolve) => {
    const fail = (why: string) => {
      for (const { reject } of pending.values()) reject(new Error(why));
      pending.clear();
      resolve();
    };
    child.on("error", (e) =>
      fail((e as NodeJS.ErrnoException).code === "ENOENT" ? "Devin isn't installed on this computer." : e.message)
    );
    child.on("exit", (code) => fail(lastError(stderr) ?? `Devin stopped (exit ${code}).`));
  });

  const tools = new Map<string, string>();
  const onUpdate = (update: Record<string, unknown>) => {
    const content = update.content as Block | undefined;
    switch (update.sessionUpdate) {
      case "agent_message_chunk":
        if (content?.type === "text" && content.text) on.text(content.text);
        break;
      case "agent_thought_chunk":
        if (content?.type === "text" && content.text) on.reasoning(content.text);
        break;
      case "tool_call": {
        const name = String(update.title || update.kind || "tool");
        tools.set(String(update.toolCallId), name);
        on.tool(name, update.rawInput);
        break;
      }
      case "tool_call_update": {
        const name = tools.get(String(update.toolCallId));
        if (name && (update.status === "completed" || update.status === "failed")) {
          tools.delete(String(update.toolCallId));
          on.toolDone(name, update.status === "completed");
        }
        break;
      }
    }
  };

  // Requests from Devin to Slates: permissions are turned down, and nothing else is offered.
  const onRequest = (msg: Message) => {
    if (msg.method === "session/request_permission") {
      const choices = (msg.params?.options ?? []) as Array<{ optionId: string; kind?: string }>;
      const reject = choices.find((o) => o.kind === "reject_once") ?? choices.find((o) => o.kind?.startsWith("reject"));
      write({ id: msg.id, result: { outcome: reject ? { outcome: "selected", optionId: reject.optionId } : { outcome: "cancelled" } } });
    } else {
      write({ id: msg.id, error: { code: -32601, message: `${msg.method} isn't available here.` } });
    }
  };

  let buffer = "";
  child.stdout.on("data", (d: Buffer) => {
    buffer += d.toString();
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end).trim();
      buffer = buffer.slice(end + 1);
      if (!line) continue;
      let msg: Message;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      if (msg.method && msg.id != null) onRequest(msg);
      else if (msg.method === "session/update") onUpdate((msg.params?.update ?? {}) as Record<string, unknown>);
      else if (!msg.method && typeof msg.id === "number") {
        const waiting = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) waiting?.reject(new Error(msg.error.message ?? "Devin refused the request."));
        else waiting?.resolve(msg.result);
      }
    }
  });

  let sessionId = "";
  const stop = () => {
    if (sessionId) write({ method: "session/cancel", params: { sessionId } });
    setTimeout(() => child.kill(), 2000).unref();
  };
  signal?.addEventListener("abort", stop, { once: true });

  try {
    await call("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    });
    const session = (await call("session/new", { cwd, mcpServers: [] })) as { sessionId: string };
    sessionId = session.sessionId;
    await call("session/set_mode", { sessionId, modeId: "ask" }).catch(() => {});
    if (signal?.aborted) return;
    await call("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text: prompt }, ...images.map((image) => ({ type: "image", data: image.data, mimeType: image.mimeType }))],
    });
  } catch (e) {
    if (!signal?.aborted) throw e;
  } finally {
    signal?.removeEventListener("abort", stop);
    child.stdin.end();
    child.kill();
    await exited;
  }
}

/** The last error Devin logged, minus its timestamp and log level. */
function lastError(log: string): string | undefined {
  const line = log
    .split("\n")
    .reverse()
    .find((l) => /\b(ERROR|error:)/.test(l));
  return line?.replace(/^\S+Z\s+ERROR\s+/, "").trim().slice(0, 300) || undefined;
}
