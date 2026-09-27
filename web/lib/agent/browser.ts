import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { BROWSER_DIR } from "./store";

/**
 * The agents' browser: one headless Chrome on the host with a persistent
 * profile, so sign-ins survive between tasks and are shared by every agent.
 *
 * Agents drive it through Playwright's MCP server connected over CDP; Slates
 * attaches to the same Chrome to show its screen and pass your clicks and
 * keys through when you take over (sign-ins, 2FA, CAPTCHAs).
 */

export const CDP_PORT = Number(process.env.SLATES_AGENT_CDP_PORT) || 7532;
const CDP = `http://127.0.0.1:${CDP_PORT}`;

function chromePath(): string | null {
  const win = process.platform === "win32";
  const candidates = win
    ? [
        path.join(process.env.ProgramFiles ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
        path.join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
      ]
    : process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) ?? null;
}

export async function browserRunning(): Promise<boolean> {
  try {
    return (await fetch(`${CDP}/json/version`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

let launching: Promise<void> | null = null;

export async function ensureBrowser(): Promise<void> {
  if (await browserRunning()) return;
  launching ??= (async () => {
    const exe = chromePath();
    if (!exe) throw new Error("Google Chrome isn't installed on the host, so agents can't use a browser.");
    fs.mkdirSync(BROWSER_DIR, { recursive: true });
    spawn(exe, [
      `--remote-debugging-port=${CDP_PORT}`,
      "--remote-debugging-address=127.0.0.1",
      `--user-data-dir=${BROWSER_DIR}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-blink-features=AutomationControlled",
      "--window-size=1280,800",
      "about:blank",
    ], { stdio: "ignore", windowsHide: true });
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      if (await browserRunning()) return;
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error("Chrome didn't start on the host.");
  })().finally(() => {
    launching = null;
  });
  return launching;
}

/** Playwright's MCP server, attached to the agents' Chrome. Null when it isn't installed. */
export function browserMcp(): { type: "stdio"; command: string; args: string[] } | null {
  const cli = path.join(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
  if (!fs.existsSync(cli)) return null;
  return { type: "stdio", command: process.execPath, args: [cli, "--cdp-endpoint", CDP] };
}

/* ---------- a small CDP client for the computer view ---------- */

interface Target {
  id: string;
  type: string;
  url: string;
  title: string;
  webSocketDebuggerUrl?: string;
}

class CdpPage {
  private next = 1;
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  private constructor(private socket: WebSocket, readonly targetId: string) {
    socket.addEventListener("message", (event) => {
      const data = JSON.parse(String(event.data)) as { id?: number; result?: unknown; error?: { message: string } };
      if (data.id === undefined) return;
      const waiting = this.pending.get(data.id);
      if (!waiting) return;
      this.pending.delete(data.id);
      if (data.error) waiting.reject(new Error(data.error.message));
      else waiting.resolve(data.result);
    });
    const fail = () => {
      for (const waiting of this.pending.values()) waiting.reject(new Error("The browser connection closed."));
      this.pending.clear();
    };
    socket.addEventListener("close", fail);
    socket.addEventListener("error", fail);
  }

  get open(): boolean {
    return this.socket.readyState === WebSocket.OPEN;
  }

  static connect(url: string, targetId: string): Promise<CdpPage> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(url);
      socket.addEventListener("open", () => resolve(new CdpPage(socket, targetId)), { once: true });
      socket.addEventListener("error", () => reject(new Error("Couldn't attach to the browser.")), { once: true });
    });
  }

  send<T = unknown>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out.`));
      }, 10_000);
    });
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      // Already closed.
    }
  }
}

const state = globalThis as typeof globalThis & { __slatesAgentPage?: CdpPage };

async function activePage(): Promise<{ page: CdpPage; target: Target }> {
  const targets = (await (await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(2000) })).json()) as Target[];
  let target = targets.find((entry) => entry.type === "page" && !entry.url.startsWith("devtools://"));
  if (!target) {
    target = (await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json()) as Target;
  }
  const current = state.__slatesAgentPage;
  if (current?.open && current.targetId === target.id) return { page: current, target };
  current?.close();
  if (!target.webSocketDebuggerUrl) throw new Error("That tab can't be attached to.");
  const page = await CdpPage.connect(target.webSocketDebuggerUrl, target.id);
  state.__slatesAgentPage = page;
  return { page, target };
}

export interface ComputerFrame {
  url: string;
  title: string;
  width: number;
  height: number;
  image: string;
}

export async function captureFrame(): Promise<ComputerFrame> {
  const { page, target } = await activePage();
  const metrics = await page.send<{ cssVisualViewport: { clientWidth: number; clientHeight: number } }>("Page.getLayoutMetrics");
  const shot = await page.send<{ data: string }>("Page.captureScreenshot", { format: "jpeg", quality: 60 });
  return {
    url: target.url,
    title: target.title,
    width: Math.round(metrics.cssVisualViewport.clientWidth),
    height: Math.round(metrics.cssVisualViewport.clientHeight),
    image: shot.data,
  };
}

export type ComputerInput =
  | { type: "click"; x: number; y: number }
  | { type: "scroll"; x: number; y: number; dy: number }
  | { type: "text"; text: string }
  | { type: "key"; key: string }
  | { type: "navigate"; url: string }
  | { type: "back" };

const KEYS: Record<string, { code: string; keyCode: number; text?: string }> = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Backspace: { code: "Backspace", keyCode: 8 },
  Tab: { code: "Tab", keyCode: 9 },
  Escape: { code: "Escape", keyCode: 27 },
  Delete: { code: "Delete", keyCode: 46 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
};

export async function sendInput(input: ComputerInput): Promise<void> {
  const { page } = await activePage();
  switch (input.type) {
    case "click":
      for (const type of ["mousePressed", "mouseReleased"]) {
        await page.send("Input.dispatchMouseEvent", { type, x: input.x, y: input.y, button: "left", clickCount: 1 });
      }
      return;
    case "scroll":
      await page.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: input.x, y: input.y, deltaX: 0, deltaY: input.dy });
      return;
    case "text":
      await page.send("Input.insertText", { text: input.text });
      return;
    case "key": {
      const key = KEYS[input.key];
      if (!key) return;
      const common = { key: input.key, code: key.code, windowsVirtualKeyCode: key.keyCode, nativeVirtualKeyCode: key.keyCode };
      await page.send("Input.dispatchKeyEvent", { type: key.text ? "keyDown" : "rawKeyDown", ...common, ...(key.text ? { text: key.text } : {}) });
      await page.send("Input.dispatchKeyEvent", { type: "keyUp", ...common });
      return;
    }
    case "navigate": {
      const url = /^[a-z]+:\/\//i.test(input.url) ? input.url : `https://${input.url}`;
      await page.send("Page.navigate", { url });
      return;
    }
    case "back":
      await page.send("Runtime.evaluate", { expression: "history.back()" });
  }
}
