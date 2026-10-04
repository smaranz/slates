import "server-only";

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { AGENT_HOME, BROWSER_DIR, getAgent } from "./store";

/**
 * The browsers agents drive: headless Chromes on the host with persistent
 * profiles, so sign-ins survive between tasks.
 *
 * Every agent has its own, with its own tabs and sign-ins, started the first
 * time it's needed. The tutor and Study builds share one more: the browser
 * every agent used to share, whose school Google sign-in the study gatherer
 * reads.
 *
 * Agents drive theirs through Playwright's MCP server connected over CDP;
 * Slates attaches to the same Chrome to show its screen and pass your clicks
 * and keys through when you take over (sign-ins, 2FA, CAPTCHAs).
 */

/** The shared browser's port, which lib/study/google.ts reads too. */
export const CDP_PORT = Number(process.env.SLATES_AGENT_CDP_PORT) || 7532;
const CDP = `http://127.0.0.1:${CDP_PORT}`;
/** One profile per agent, named by its id. */
const AGENT_BROWSERS = path.join(AGENT_HOME, "browsers");
/**
 * Agents made before they had browsers of their own drove the shared one, so
 * each starts its own with a copy of the shared sign-ins, once. Agents made
 * since start signed out.
 */
const OWN_BROWSERS_SINCE = Date.parse("2026-10-04T21:45:00Z");

const state = globalThis as typeof globalThis & {
  __slatesBrowserLaunches?: Map<string, Promise<string>>;
  __slatesAgentPages?: Map<string, CdpPage>;
};
/** On globalThis because Next bundles each route on its own, and two Chromes on one profile collide. */
const launches: Map<string, Promise<string>> = (state.__slatesBrowserLaunches ??= new Map());

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** `agentId` picks that agent's own browser; without one, the shared browser. */
function profileDir(agentId?: string): string {
  if (!agentId) return BROWSER_DIR;
  if (!/^agt_[a-z0-9]{6,40}$/.test(agentId)) throw new Error("That isn't an agent.");
  return path.join(AGENT_BROWSERS, agentId);
}

/** The browser's own DevTools address, if something on `endpoint` answers as one. */
async function devtoolsUrl(endpoint: string, timeout = 800): Promise<string | null> {
  try {
    const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(timeout) });
    return response.ok ? (((await response.json()) as { webSocketDebuggerUrl?: string }).webSocketDebuggerUrl ?? null) : null;
  } catch {
    return null;
  }
}

/** Where a browser answers over CDP, or null when it isn't running. */
async function endpointOf(agentId?: string): Promise<string | null> {
  if (!agentId) return (await devtoolsUrl(CDP)) ? CDP : null;
  // An agent's Chrome takes any free port, and writes it into its profile with the browser's own id.
  const file = path.join(profileDir(agentId), "DevToolsActivePort");
  let port = "";
  let id = "";
  try {
    [port = "", id = ""] = fs.readFileSync(file, "utf8").split(/\r?\n/);
  } catch {
    return null;
  }
  if (!/^\d{2,5}$/.test(port) || !id.startsWith("/devtools/browser/")) return null;
  const endpoint = `http://127.0.0.1:${port}`;
  // The file outlives its browser, and by then the port may be another agent's: only the same browser counts.
  return (await devtoolsUrl(endpoint))?.endsWith(id) ? endpoint : null;
}

export async function browserRunning(agentId?: string): Promise<boolean> {
  return (await endpointOf(agentId)) !== null;
}

/** A browser's CDP endpoint, starting the browser if it isn't running. */
export function ensureBrowser(agentId?: string): Promise<string> {
  const key = agentId ?? "";
  let launch = launches.get(key);
  if (!launch) {
    launch = (async () => (await endpointOf(agentId)) ?? (await start(agentId)))().finally(() => launches.delete(key));
    launches.set(key, launch);
  }
  return launch;
}

async function start(agentId?: string): Promise<string> {
  const exe = chromePath();
  if (!exe) throw new Error("Google Chrome isn't installed on the host, so agents can't use a browser.");
  const dir = profileDir(agentId);
  // Chrome writes Local State the first time it runs on a profile.
  const fresh = !fs.existsSync(path.join(dir, "Local State"));
  fs.mkdirSync(dir, { recursive: true });
  spawn(exe, [
    // One Chrome per agent, so an agent's takes whichever port is free.
    `--remote-debugging-port=${agentId ? 0 : CDP_PORT}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${dir}`,
    "--headless=new",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-blink-features=AutomationControlled",
    "--window-size=1280,800",
    "about:blank",
  ], { stdio: "ignore", windowsHide: true });
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const endpoint = await endpointOf(agentId);
    if (endpoint) {
      if (agentId && fresh) await inheritSignIns(agentId, endpoint);
      return endpoint;
    }
    await sleep(300);
  }
  throw new Error("Chrome didn't start on the host.");
}

interface BrowserServer {
  type: "stdio";
  command: string;
  args: string[];
}

/**
 * Playwright's MCP server, attached over CDP to the shared browser, or to the
 * one at `endpoint`. Null when it isn't installed. Screenshots and saved PDFs
 * go to `outputDir`, where an agent can send them on.
 */
export function browserMcp(outputDir?: string, endpoint = CDP): BrowserServer | null {
  const cli = path.join(process.cwd(), "node_modules", "@playwright", "mcp", "cli.js");
  if (!fs.existsSync(cli)) return null;
  if (outputDir) fs.mkdirSync(outputDir, { recursive: true });
  return { type: "stdio", command: process.execPath, args: [cli, "--cdp-endpoint", endpoint, "--caps", "pdf", ...(outputDir ? ["--output-dir", outputDir] : [])] };
}

/** Playwright's MCP server on an agent's own Chrome, started if need be. Null when there's no browser to offer. */
export async function agentBrowserMcp(agentId: string, outputDir: string): Promise<BrowserServer | null> {
  if (!browserMcp()) return null;
  try {
    return browserMcp(outputDir, await ensureBrowser(agentId));
  } catch {
    return null;
  }
}

/** Close a browser. It starts again the next time it's needed. */
export async function closeBrowser(agentId?: string): Promise<void> {
  const key = agentId ?? "";
  pages.get(key)?.close();
  pages.delete(key);
  const endpoint = await endpointOf(agentId);
  if (!endpoint) return;
  // Chrome hangs up rather than answering this.
  await withBrowser(endpoint, (cdp) => cdp.send("Browser.close")).catch(() => {});
  for (let tries = 0; tries < 50 && (await endpointOf(agentId)); tries += 1) await sleep(200);
}

/** An agent's browser and its profile, sign-ins and all, gone with the agent. */
export async function deleteBrowser(agentId: string): Promise<void> {
  await closeBrowser(agentId);
  // Chrome's helper processes can hold files for a moment after it stops answering.
  await fs.promises.rm(profileDir(agentId), { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
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
      const timer = setTimeout(() => {
        if (this.pending.delete(id)) reject(new Error(`${method} timed out.`));
      }, 10_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      this.socket.send(JSON.stringify({ id, method, params }));
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

/** A connection to the whole browser rather than one of its tabs, for as long as `work` runs. */
async function withBrowser<T>(endpoint: string, work: (cdp: CdpPage) => Promise<T>): Promise<T> {
  const url = await devtoolsUrl(endpoint, 3000);
  if (!url) throw new Error("The browser isn't running.");
  const cdp = await CdpPage.connect(url, "browser");
  try {
    return await work(cdp);
  } finally {
    cdp.close();
  }
}

/** A cookie as Storage.getCookies reports it. */
interface CdpCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  session: boolean;
  sameSite?: string;
  priority?: string;
  sourceScheme?: string;
  sourcePort?: number;
  partitionKey?: unknown;
  partitionKeyOpaque?: boolean;
}

/** The same cookie as Storage.setCookies takes it. */
function cookieParam(cookie: CdpCookie): Record<string, unknown> {
  const { name, value, domain, path: where, expires, httpOnly, secure, session, sameSite, priority, sourceScheme, sourcePort, partitionKey } = cookie;
  return {
    name, value, domain, path: where, httpOnly, secure,
    ...(session ? {} : { expires }),
    ...(sameSite ? { sameSite } : {}),
    ...(priority ? { priority } : {}),
    ...(sourceScheme ? { sourceScheme } : {}),
    ...(sourcePort !== undefined ? { sourcePort } : {}),
    ...(partitionKey ? { partitionKey } : {}),
  };
}

/** For an agent from before agents had browsers of their own: the shared browser's sign-ins, copied into its new one. */
async function inheritSignIns(agentId: string, endpoint: string): Promise<void> {
  const agent = getAgent(agentId);
  if (!agent || agent.createdAt >= OWN_BROWSERS_SINCE) return;
  try {
    const { cookies } = await withBrowser(await ensureBrowser(), (cdp) => cdp.send<{ cookies: CdpCookie[] }>("Storage.getCookies"));
    const params = cookies.filter((cookie) => !cookie.partitionKeyOpaque).map(cookieParam);
    await withBrowser(endpoint, async (cdp) => {
      try {
        await cdp.send("Storage.setCookies", { cookies: params });
      } catch {
        // A cookie this browser won't take costs that cookie, not the rest.
        for (const cookie of params) await cdp.send("Storage.setCookies", { cookies: [cookie] }).catch(() => {});
      }
    });
  } catch (error) {
    console.error(`[agent] couldn't copy the shared browser's sign-ins to ${agent.name}'s:`, error instanceof Error ? error.message : error);
  }
}

/** The tab each browser's Computer view is attached to. */
const pages: Map<string, CdpPage> = (state.__slatesAgentPages ??= new Map());

async function activePage(agentId?: string): Promise<{ page: CdpPage; target: Target }> {
  const endpoint = await endpointOf(agentId);
  if (!endpoint) throw new Error("The browser isn't running.");
  const targets = (await (await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2000) })).json()) as Target[];
  let target = targets.find((entry) => entry.type === "page" && !entry.url.startsWith("devtools://"));
  if (!target) {
    target = (await (await fetch(`${endpoint}/json/new?about:blank`, { method: "PUT" })).json()) as Target;
  }
  const key = agentId ?? "";
  const current = pages.get(key);
  if (current?.open && current.targetId === target.id) return { page: current, target };
  current?.close();
  if (!target.webSocketDebuggerUrl) throw new Error("That tab can't be attached to.");
  const page = await CdpPage.connect(target.webSocketDebuggerUrl, target.id);
  pages.set(key, page);
  return { page, target };
}

export interface ComputerFrame {
  url: string;
  title: string;
  width: number;
  height: number;
  image: string;
}

export async function captureFrame(agentId?: string): Promise<ComputerFrame> {
  const { page, target } = await activePage(agentId);
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

export async function sendInput(input: ComputerInput, agentId?: string): Promise<void> {
  const { page } = await activePage(agentId);
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
