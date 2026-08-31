/**
 * Local sync service for the Slates portal.
 *
 * Binds to 127.0.0.1 only — this holds a logged-in Schoology session, so it
 * must never be reachable from the network.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { scrape, closeShared, getSharedContext } from "./scrape.mjs";
import { readConfig, HOME } from "./browser.mjs";
import * as attempt from "./attempt.mjs";
import { submitAssignment } from "./submit.mjs";

/**
 * Last good snapshot on disk, so restarting the service still answers
 * immediately instead of making the portal wait on a cold scrape.
 */
const CACHE_FILE = path.join(HOME, "snapshot.json");

function loadCache() {
  try {
    const c = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8"));
    return c?.payload?.snapshot?.assignments ? c : null;
  } catch {
    return null;
  }
}

function saveCache(entry) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(CACHE_FILE, JSON.stringify(entry));
  } catch {
    /* cache is an optimisation, not a requirement */
  }
}

const PORT = Number(process.env.SLATES_SCRAPER_PORT || 4000);

/** How often to re-scrape in the background so new assignments appear on their own. */
const POLL_MS = Number(process.env.SLATES_POLL_MS || 5 * 60_000);
const CACHE_MS = 60_000;

let inFlight = null;
let cache = loadCache(); // { at, payload } — survives a restart

/**
 * One scrape at a time — the browser is shared.
 *
 * `headless` is passed explicitly rather than left to a default: this browser
 * holds a live Schoology session and runs unattended for hours, so it must
 * never be able to pop a visible window. Only `npm run login` is headed, and
 * only because signing in needs a human.
 */
function runScrape() {
  inFlight = inFlight ?? scrape({ reuse: true, headless: true }).finally(() => (inFlight = null));
  return inFlight;
}

/**
 * Background refresh loop. Keeps the cache warm so the portal's poll returns
 * instantly, and means a newly posted assignment shows up without anyone
 * pressing Sync.
 */
async function refresh(reason) {
  // Never crawl during a live attempt. A background scrape drives the same
  // browser and visits the assessment's own page, which would disturb the
  // server-side submission lock Schoology holds open mid-attempt.
  if (attempt.isActive()) {
    console.log(`[${new Date().toLocaleTimeString()}] ${reason} skipped — attempt in progress`);
    return;
  }
  try {
    const payload = await runScrape();
    const prev = cache?.payload?.snapshot?.assignments?.length ?? null;
    cache = { at: Date.now(), payload };
    saveCache(cache); // survive a restart
    const now = payload.snapshot.assignments.length;
    const delta = prev === null || prev === now ? "" : `  (was ${prev})`;
    console.log(
      `[${new Date().toLocaleTimeString()}] ${reason}: ${now} items / ${payload.stats.courses} courses${delta}`
    );
  } catch (e) {
    console.error(`[${new Date().toLocaleTimeString()}] ${reason} failed: ${e.message}`);
  }
}

setInterval(() => void refresh("auto"), POLL_MS);
void refresh("startup");

function readBody(req, limit = 64_000) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      // Input events are tiny; uploads are not, so the cap is per-caller.
      if (data.length > limit) reject(new Error("Body too large"));
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(json),
    // Only the local portal may call this. The portal normally reaches the
    // scraper server-side via /api/scrape, so this is belt-and-braces.
    "access-control-allow-origin": "http://localhost:3000",
  });
  res.end(json);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");

  if (url.pathname === "/health") {
    const { domain, loggedInAt } = readConfig();
    return send(res, 200, { ok: true, domain: domain ?? null, loggedInAt: loggedInAt ?? null });
  }

  /* ---- real submission through Schoology's own dropbox ---- */

  if (url.pathname === "/submit") {
    if (req.method !== "POST") return send(res, 405, { error: "POST only" });

    /*
     * Handing something in drives a real browser through Schoology's modal, and
     * that takes long enough that a silent wait looks like a hang. With
     * `?stream=1` the stages are reported as they happen, so the portal shows
     * what is actually going on instead of guessing at a progress bar.
     */
    const streaming = url.searchParams.get("stream") === "1";
    let started = false;
    const emit = (payload) => {
      if (!streaming) return;
      if (!started) {
        started = true;
        res.writeHead(200, {
          "content-type": "text/event-stream",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "access-control-allow-origin": "http://localhost:3000",
        });
      }
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const body = JSON.parse(await readBody(req, 60 * 1024 * 1024));
      if (!/^https:\/\/[\w.-]+\.schoology\.com\//.test(body.url ?? "")) {
        return send(res, 400, { error: "Only Schoology URLs can be submitted to." });
      }
      const ctx = await getSharedContext(true);
      const result = await submitAssignment(ctx, body, (s) => emit({ type: "step", ...s }));
      // The board is stale the moment something is handed in.
      void refresh("after-submit");
      if (!streaming) return send(res, 200, result);
      emit({ type: "result", result });
      return res.end();
    } catch (e) {
      console.error("submit failed:", e.message);
      if (!streaming || !started) return send(res, 500, { error: e.message });
      // Headers are already out; the error has to travel in the stream.
      emit({ type: "error", error: e.message });
      return res.end();
    }
  }

  /* ---- live attempt: a real Schoology page streamed into the portal ---- */

  if (url.pathname === "/attempt/status") return send(res, 200, attempt.status());

  if (url.pathname === "/attempt/start") {
    const target = url.searchParams.get("url") ?? "";
    if (!/^https:\/\/[\w.-]+\.schoology\.com\//.test(target)) {
      return send(res, 400, { error: "Only Schoology URLs can be opened here." });
    }

    /*
     * Server-side integrity check, not just a hidden button. An assessment
     * their teacher gated behind Respondus LockDown Browser is proctored on
     * purpose; streaming it into a custom app would defeat exactly the control
     * it exists to enforce. The client is not trusted to enforce this.
     */
    const known = cache?.payload?.snapshot?.assignments?.find((a) => a.url === target);
    if (known?.assessment?.lockdown) {
      return send(res, 403, {
        error: "This assessment requires LockDown Browser and can't be opened inside Slates.",
      });
    }

    try {
      const ctx = await getSharedContext(true); // headless: the page is streamed, never shown
      return send(res, 200, await attempt.start(ctx, target));
    } catch (e) {
      return send(res, 500, { error: e.message });
    }
  }

  if (url.pathname === "/attempt/stop") {
    await attempt.stop();
    return send(res, 200, { ok: true });
  }

  if (url.pathname === "/attempt/input") {
    if (!attempt.isActive()) return send(res, 409, { error: "No attempt is running" });
    try {
      const body = await readBody(req);
      await attempt.input(JSON.parse(body));
      return send(res, 200, { ok: true });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (url.pathname === "/attempt/stream") {
    if (!attempt.isActive()) return send(res, 409, { error: "No attempt is running" });
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "access-control-allow-origin": "http://localhost:3000",
    });
    // Frames are base64 JPEG, one SSE message each.
    const unsubscribe = attempt.subscribe((frame) => res.write(`data: ${frame}\n\n`));
    req.on("close", () => {
      unsubscribe();
      res.end();
    });
    return;
  }

  if (url.pathname !== "/snapshot") return send(res, 404, { error: "Not found" });

  const fresh = url.searchParams.get("fresh") === "1";

  // Always answer from cache when we have one. A background refresh keeps it
  // current, so there is no reason to make the caller wait ~25s on a cold
  // scrape — previously anything older than CACHE_MS fell through and did.
  if (!fresh && cache) {
    const ageMs = Date.now() - cache.at;
    // Stale enough to be worth refreshing, but answer now and update behind.
    if (ageMs > CACHE_MS) void refresh("on-demand");
    return send(res, 200, { ...cache.payload, cached: true, ageMs });
  }

  try {
    const payload = await runScrape();
    cache = { at: Date.now(), payload };
    saveCache(cache);
    send(res, 200, payload);
  } catch (e) {
    console.error("scrape failed:", e.message);
    // Prefer stale data over nothing — a transient failure shouldn't blank
    // the board.
    if (cache) return send(res, 200, { ...cache.payload, cached: true, stale: true });
    send(res, 500, { error: e.message });
  }
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, async () => {
    console.log("\n  shutting down…");
    await attempt.stop();
    await closeShared();
    process.exit(0);
  });
}

server.listen(PORT, "127.0.0.1", () => {
  const { domain } = readConfig();
  console.log(`\n  Slates scraper listening on http://127.0.0.1:${PORT}`);
  console.log(`  Schoology domain: ${domain ?? "(not set — run: npm run login -- <district>.schoology.com)"}`);
  console.log(`  Endpoints: /health  /snapshot  /snapshot?fresh=1\n`);
});
