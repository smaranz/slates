import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// Every agent's own browser, against real headless Chromes in a throwaway
// home, so it's skipped where Chrome isn't installed.

const home = fs.mkdtempSync(path.join(os.tmpdir(), "slates-browsers-"));
const real = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };
process.env.HOME = home;
process.env.USERPROFILE = home;
// The shared browser on a port of the test's own, clear of a Slates running here.
process.env.SLATES_AGENT_CDP_PORT = "7593";

const OLD = { id: "agt_old0000000001", name: "Researcher", createdAt: 1 };
const NEW = { id: "agt_new0000000001", name: "Planner", createdAt: Date.now() };
const THIRD = { id: "agt_third00000001", name: "Writer", createdAt: Date.now() };

const ready = Promise.all([import("./browser"), import("./store")]).then(async ([browser, store]) => {
  // Slates' paths are fixed once loaded. Chrome keeps the real home: on a Mac its cookies wait on the keychain there.
  Object.assign(process.env, real);
  store.agents.save([OLD, NEW, THIRD].map((agent) => ({ ...agent, job: "", rules: "", model: "", hue: 0, voiceReplies: false, memory: [] })));
  try {
    return { ...browser, shared: await browser.ensureBrowser() };
  } catch (error) {
    if (error instanceof Error && /isn't installed/.test(error.message)) return null;
    throw error;
  }
});

test.after(async () => {
  const browser = await ready.catch(() => null);
  if (browser) await Promise.all([undefined, OLD.id, NEW.id, THIRD.id].map((id) => browser.closeBrowser(id)));
  fs.rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

/** One command to a whole browser. */
async function cdp<T>(endpoint: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  const { webSocketDebuggerUrl } = (await (await fetch(`${endpoint}/json/version`)).json()) as { webSocketDebuggerUrl: string };
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.onopen = resolve;
    socket.onerror = reject;
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} got no answer`)), 10_000);
      socket.onmessage = (event) => {
        const data = JSON.parse(String(event.data)) as { id?: number; result?: T; error?: { message: string } };
        if (data.id !== 1) return;
        clearTimeout(timer);
        if (data.error) reject(new Error(data.error.message));
        else resolve(data.result as T);
      };
      socket.send(JSON.stringify({ id: 1, method, params }));
    });
  } finally {
    socket.close();
  }
}

const cookies = async (endpoint: string) =>
  (await cdp<{ cookies: { name: string }[] }>(endpoint, "Storage.getCookies")).cookies.map((cookie) => cookie.name).sort();

/** A sign-in, as far as a browser can tell: one cookie that lasts and one for the session. */
const signIn = (endpoint: string, site: string) =>
  cdp(endpoint, "Storage.setCookies", {
    cookies: [
      { name: `${site}-kept`, value: "1", domain: `${site}.example`, path: "/", secure: true, expires: Math.floor(Date.now() / 1000) + 3600 },
      { name: `${site}-session`, value: "1", domain: `${site}.example`, path: "/", secure: true, httpOnly: true },
    ],
  });

test("each agent gets a Chrome of its own, apart from the shared one and from each other", async (t) => {
  const browser = await ready;
  if (!browser) return t.skip("Chrome isn't installed here.");
  await signIn(browser.shared, "school");

  const researcher = await browser.ensureBrowser(OLD.id);
  const planner = await browser.ensureBrowser(NEW.id);
  assert.equal(new Set([browser.shared, researcher, planner]).size, 3);
  assert.equal(await browser.ensureBrowser(OLD.id), researcher, "a running browser is reused, not started again");
  for (const agent of [OLD, NEW]) assert.ok(fs.existsSync(path.join(home, ".slates", "agent", "browsers", agent.id, "Local State")));

  // Researcher is from before agents had their own, so it started with the shared sign-ins; Planner starts signed out.
  assert.deepEqual(await cookies(researcher), ["school-kept", "school-session"]);
  assert.deepEqual(await cookies(planner), []);

  await signIn(planner, "quizlet");
  assert.deepEqual(await cookies(planner), ["quizlet-kept", "quizlet-session"]);
  assert.deepEqual(await cookies(researcher), ["school-kept", "school-session"]);
  assert.deepEqual(await cookies(browser.shared), ["school-kept", "school-session"]);
});

test("the Computer view watches and drives the browser it's asked for", async (t) => {
  const browser = await ready;
  if (!browser) return t.skip("Chrome isn't installed here.");
  const server = http.createServer((request, response) => {
    response.setHeader("content-type", "text/html");
    response.end(`<title>${decodeURIComponent(request.url!.slice(1))}</title>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as { port: number };

  await browser.sendInput({ type: "navigate", url: `http://127.0.0.1:${port}/Planner%20page` }, NEW.id);
  const deadline = Date.now() + 10_000;
  let frame = await browser.captureFrame(NEW.id);
  while (frame.title !== "Planner page" && Date.now() < deadline) frame = await browser.captureFrame(NEW.id);
  assert.equal(frame.title, "Planner page");
  assert.ok(frame.image.length > 100);
  assert.notEqual((await browser.captureFrame(OLD.id)).title, "Planner page");
  assert.notEqual((await browser.captureFrame()).title, "Planner page");
});

test("everyone asking for a browser at once gets the same one", async (t) => {
  const browser = await ready;
  if (!browser) return t.skip("Chrome isn't installed here.");
  const endpoints = await Promise.all([browser.ensureBrowser(THIRD.id), browser.ensureBrowser(THIRD.id), browser.ensureBrowser(THIRD.id)]);
  assert.equal(new Set(endpoints).size, 1);
  assert.equal(await browser.browserRunning(THIRD.id), true);
});

test("a DevToolsActivePort left behind doesn't pass for the agent's browser", async (t) => {
  const browser = await ready;
  if (!browser) return t.skip("Chrome isn't installed here.");
  const dir = path.join(home, ".slates", "agent", "browsers", "agt_gone000000001");
  fs.mkdirSync(dir, { recursive: true });
  // The shared browser's port answers, but as another browser.
  fs.writeFileSync(path.join(dir, "DevToolsActivePort"), `${process.env.SLATES_AGENT_CDP_PORT}\n/devtools/browser/00000000-0000-0000-0000-000000000000`);
  assert.equal(await browser.browserRunning("agt_gone000000001"), false);
  await assert.rejects(browser.browserRunning("../../somewhere"), /isn't an agent/);
});

test("deleting an agent's browser closes it and removes its profile", async (t) => {
  const browser = await ready;
  if (!browser) return t.skip("Chrome isn't installed here.");
  const researcher = await browser.ensureBrowser(OLD.id);
  await browser.deleteBrowser(OLD.id);
  assert.equal(await browser.browserRunning(OLD.id), false);
  assert.equal(fs.existsSync(path.join(home, ".slates", "agent", "browsers", OLD.id)), false);
  await assert.rejects(fetch(`${researcher}/json/version`, { signal: AbortSignal.timeout(1000) }));
  assert.equal(await browser.browserRunning(NEW.id), true, "the other agents' browsers keep running");
});
