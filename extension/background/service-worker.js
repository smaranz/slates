/**
 * Slates service worker — router between the portal and Schoology.
 *
 * It deliberately performs no fetches of its own. MV3 service-worker requests
 * are cross-origin, so Schoology's SameSite=Lax session cookie is dropped and
 * the server answers with the login page under a 200 status — a failure that
 * looks exactly like success. Every network call is delegated to the content
 * script running on the Schoology origin, where the session is sent normally.
 */

const SCHOOLOGY_MATCH = "https://*.schoology.com/*";
const CALL_TIMEOUT_MS = 120_000;

/** Must match BUILD in content/proxy.js — see withFreshProxy(). */
const BUILD = "2026-08-30.7";

// Stamp the running build into extension storage on every worker start. This
// makes "is the reloaded code actually running?" answerable by inspection
// instead of guesswork — the previous symptom was a stale worker silently
// serving old results.
chrome.storage.local
  .set({ slatesBuild: BUILD, bootedAt: new Date().toISOString() })
  .catch(() => {});

/* ---------------- domain ---------------- */

async function rememberDomain(url) {
  try {
    const host = new URL(url).host;
    if (host.endsWith(".schoology.com")) {
      await chrome.storage.local.set({ domain: host });
    }
  } catch {
    /* not a URL we care about */
  }
}

async function knownDomain() {
  const { domain } = await chrome.storage.local.get("domain");
  return domain ?? null;
}

/* ---------------- proxy tab ---------------- */

function waitForLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("TAB_TIMEOUT"));
    }, 30_000);

    function listener(id, info) {
      if (id === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Find an open Schoology tab to borrow, or open one in the background.
 * Reusing an existing tab keeps the user's place; the fallback only fires
 * when they have no Schoology tab open at all.
 */
async function getProxyTab() {
  const tabs = await chrome.tabs.query({ url: SCHOOLOGY_MATCH });
  if (tabs.length) {
    // Prefer a fully loaded tab; a still-loading one has no content script yet.
    const ready = tabs.find((t) => t.status === "complete") ?? tabs[0];
    await rememberDomain(ready.url);
    return ready.id;
  }

  const domain = await knownDomain();
  if (!domain) throw new Error("NO_DOMAIN");

  const tab = await chrome.tabs.create({
    url: `https://${domain}/home`,
    active: false,
  });
  await waitForLoad(tab.id);
  return tab.id;
}

/** Send an RPC to the content script and await its reply. */
function callProxy(tabId, method, params) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("PROXY_TIMEOUT")), CALL_TIMEOUT_MS);

    chrome.tabs.sendMessage(tabId, { __slates: 1, method, params }, (res) => {
      clearTimeout(timer);
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message ?? "NO_CONTENT_SCRIPT"));
        return;
      }
      if (!res) {
        reject(new Error("EMPTY_PROXY_RESPONSE"));
        return;
      }
      if (res.ok) resolve(res.data);
      else reject(Object.assign(new Error(res.error ?? "PROXY_ERROR"), { code: res.code }));
    });
  });
}

/* ---------------- time tracking ---------------- */

const ASSIGNMENT_URL = /\/(assignment|quiz|assessment)\/(?:view\/)?(\d+)/;

let active = null; // { id, since }

async function accrue() {
  if (!active) return;
  const elapsed = Date.now() - active.since;
  active.since = Date.now();
  if (elapsed <= 0) return;

  const { totals = {} } = await chrome.storage.local.get("totals");
  totals[active.id] = (totals[active.id] ?? 0) + elapsed;
  await chrome.storage.local.set({ totals });
}

async function setActive(id) {
  if (active?.id === id) return;
  await accrue();
  active = id ? { id, since: Date.now() } : null;
}

/** Derive the focused assignment from the active tab's URL. */
async function syncFromTab(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const match = tab.url?.match(ASSIGNMENT_URL);
    await setActive(match ? match[2] : null);
  } catch {
    await setActive(null);
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => void syncFromTab(tabId));

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.url) void rememberDomain(info.url);
  if (info.status === "complete" && tab.active) void syncFromTab(tabId);
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    await setActive(null); // browser lost focus — stop the clock
    return;
  }
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (tab) await syncFromTab(tab.id);
});

chrome.idle.setDetectionInterval(60);
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state === "active") {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab) await syncFromTab(tab.id);
  } else {
    await setActive(null); // idle or locked — don't count it
  }
});

// Flush periodically so a crash loses at most a minute.
chrome.alarms.create("flush", { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener((a) => {
  if (a.name === "flush") void accrue();
});

/* ---------------- RPC surface ---------------- */

const handlers = {
  async ping() {
    return {
      version: chrome.runtime.getManifest().version,
      build: BUILD,
      domain: await knownDomain(),
    };
  },

  async timeTotals() {
    await accrue();
    const { totals = {} } = await chrome.storage.local.get("totals");
    return totals;
  },

  async startTimer({ assignmentId }) {
    await setActive(assignmentId);
    return { startedAt: Date.now() };
  },

  async stopTimer({ assignmentId }) {
    await accrue();
    if (active?.id === assignmentId) active = null;
    const { totals = {} } = await chrome.storage.local.get("totals");
    return { elapsed: totals[assignmentId] ?? 0 };
  },

  async openWithOverlay({ url, id, kind }) {
    const tab = await chrome.tabs.create({ url, active: true });
    await waitForLoad(tab.id);
    // The overlay renders inside the real page — Schoology still owns the attempt.
    await callProxy(tab.id, "mountOverlay", { id, kind });
    await setActive(id);
    return { tabId: tab.id };
  },
};

/**
 * Run `fn(tabId)` against a tab showing /home.
 *
 * The To Do panel is populated client-side, so the content script has to read a
 * rendered home page — a fetch of /home returns empty `hidden` containers.
 * Reuses a home tab if one is already open; otherwise opens a background tab
 * and closes it afterwards, rather than navigating the user's tab away from
 * whatever they were doing.
 */
async function withHomeTab(fn) {
  const domain = await knownDomain();
  if (!domain) throw new Error("NO_DOMAIN");

  const isHome = (t) => {
    try {
      return /^\/(home)?$/.test(new URL(t.url).pathname) && t.status === "complete";
    } catch {
      return false;
    }
  };

  const open = (await chrome.tabs.query({ url: `https://${domain}/*` })).find(isHome);
  if (open) return fn(await withFreshProxy(open.id));

  const tab = await chrome.tabs.create({ url: `https://${domain}/home`, active: false });
  try {
    await waitForLoad(tab.id);
    return await fn(tab.id);
  } finally {
    chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Guarantee the tab is running THIS build of the content script.
 *
 * Reloading an extension leaves already-open tabs running the previously
 * injected content script — it keeps answering, just with old logic, so the
 * failure is silent and looks like a scraper bug. Probe for the build and
 * reload the tab when it's stale or missing.
 */
async function withFreshProxy(tabId) {
  let build = null;
  try {
    ({ build } = await callProxy(tabId, "probe", {}));
  } catch {
    build = null; // no content script at all (e.g. injected before install)
  }
  if (build === BUILD) return tabId;

  await chrome.tabs.reload(tabId);
  await waitForLoad(tabId);

  // Content scripts run at document_idle; give the injection a moment.
  for (let i = 0; i < 20; i++) {
    try {
      const p = await callProxy(tabId, "probe", {});
      if (p.build === BUILD) return tabId;
    } catch {
      /* not injected yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw Object.assign(new Error("Stale content script; reload the Schoology tab."), {
    code: "STALE_PROXY",
  });
}

/** Anything not handled here is forwarded to the Schoology-origin proxy. */
async function dispatch(method, params) {
  if (handlers[method]) return handlers[method](params ?? {});

  // sync needs a rendered home page; everything else works from any tab.
  if (method === "sync") {
    return withHomeTab((tabId) => callProxy(tabId, method, params ?? {}));
  }

  const tabId = await getProxyTab();
  return callProxy(tabId, method, params ?? {});
}

function onMessage(msg, _sender, sendResponse) {
  if (!msg || msg.__slates !== 1) return false;

  dispatch(msg.method, msg.params)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        code: err.code ?? err.message ?? "ERROR",
        error: friendly(err),
      })
    );

  return true; // async response
}

function friendly(err) {
  switch (err.code ?? err.message) {
    case "NO_DOMAIN":
      return "Open your Schoology site once so Slates learns your district's domain.";
    case "SESSION_EXPIRED":
      return "Your Schoology session expired. Open Schoology, sign in, and try again.";
    case "NO_CONTENT_SCRIPT":
    case "PROXY_TIMEOUT":
      return "Couldn't reach the Schoology tab. Reload it and try again.";
    case "STALE_PROXY":
      return "Your Schoology tab is running an old copy of Slates. Reload that tab, then re-sync.";
    case "WRONG_PAGE":
      return "Slates needs your Schoology home page open to read the To Do panel.";
    case "TAB_TIMEOUT":
      return "Schoology took too long to load.";
    default:
      return err.message ?? "Something went wrong.";
  }
}

// The portal is a normal web page, so it uses onMessageExternal.
chrome.runtime.onMessageExternal.addListener(onMessage);
chrome.runtime.onMessage.addListener(onMessage);
