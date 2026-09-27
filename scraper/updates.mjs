import fs from "node:fs";
import path from "node:path";

import { HOME } from "./browser.mjs";

/**
 * Posts from the Updates feed of every class and group.
 *
 * Teachers use Updates for the announcements that change a week — a test
 * cancelled, a quiz moved to Tuesday, a form due Friday — and none of it is on
 * the To Do list or in the inbox. Schoology's home feed already gathers every
 * realm's posts, and its "more" pager answers with JSON wrapping the next
 * slice of the same markup, so this reads it through the browser's session
 * without navigating anywhere.
 */

/** Pages are small (three or four posts), so ten reach back months. */
const MAX_PAGES = 10;
/** Older than this is last year's news; Schoology keeps it forever. */
const MAX_AGE_MS = 150 * 86_400_000;

/**
 * Long posts arrive cut off behind a "Show More" link that answers with the
 * full text. Kept by post id and fetched again only when the preview changes,
 * which is what an edited post looks like from here.
 */
const BODY_CACHE_FILE = path.join(HOME, "update-bodies.json");

function loadBodies() {
  try {
    return JSON.parse(fs.readFileSync(BODY_CACHE_FILE, "utf8"));
  } catch {
    return {};
  }
}

function saveBodies(cache) {
  try {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(BODY_CACHE_FILE, JSON.stringify(cache));
  } catch {
    /* cache is an optimisation, not a requirement */
  }
}

/**
 * Runs in page context: the posts in one slice of feed markup, and/or full
 * bodies from "Show More", all through one cleaner.
 *
 * Same rules as an assignment's write-up (see `extractDetail`): structure is
 * kept, Schoology's inline styling is not, and anything outside the list is
 * unwrapped rather than deleted. Links open in a new window and skip
 * Schoology's /link redirect, which needs its session to follow. Images are
 * dropped: they're served behind that same session and would draw broken.
 */
function readMarkup({ feed, bodies, origin }) {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const KEEP = new Set([
    "P", "BR", "DIV", "SPAN", "STRONG", "B", "EM", "I", "U", "S", "SUP", "SUB",
    "UL", "OL", "LI", "A", "HR", "BLOCKQUOTE", "PRE", "CODE", "H1", "H2", "H3", "H4", "H5", "H6",
  ]);
  const DROP = "script,style,iframe,object,embed,link,meta,noscript,form,input,button,select,textarea,img,svg";

  const unwrapLink = (href) => {
    try {
      const url = new URL(href, origin);
      if (url.origin === origin && url.pathname === "/link") return url.searchParams.get("path") || url.href;
      return url.href;
    } catch {
      return "";
    }
  };

  const cleanHtml = (root) => {
    if (!root) return "";
    const node = root.cloneNode(true);
    node.querySelectorAll(DROP).forEach((el) => el.remove());
    for (const el of [...node.querySelectorAll("*")]) {
      if (!KEEP.has(el.tagName)) {
        el.replaceWith(...el.childNodes);
        continue;
      }
      const href = el.tagName === "A" ? el.getAttribute("href") || "" : "";
      const style = el.getAttribute("style") || "";
      const bold = /font-weight\s*:\s*(?:bold(?:er)?|[6-9]00)/i.test(style);
      const italic = /font-style\s*:\s*italic/i.test(style);
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      if (bold || italic) {
        const outer = document.createElement(bold ? "strong" : "em");
        outer.append(...el.childNodes);
        if (bold && italic) {
          const inner = document.createElement("em");
          inner.append(...outer.childNodes);
          outer.append(inner);
        }
        el.append(outer);
      }
      if (el.tagName === "A") {
        const target = /^(https?:|mailto:|\/)/i.test(href) ? unwrapLink(href) : "";
        if (/^(https?:|mailto:)/i.test(target)) {
          el.setAttribute("href", target);
          el.setAttribute("target", "_blank");
          el.setAttribute("rel", "noopener noreferrer");
        } else el.replaceWith(...el.childNodes);
      }
    }
    return node.innerHTML.replace(/\s+/g, " ").trim();
  };

  const htmlToText = (html) => {
    const box = document.createElement("textarea");
    box.innerHTML = html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|h[1-6]|blockquote|pre)>/gi, "\n")
      .replace(/<[^>]*>/g, "");
    return box.value
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  };

  const describe = (root) => {
    const html = cleanHtml(root);
    return { html: html.length > 40_000 ? "" : html, text: htmlToText(html) };
  };

  /** Files and links posted with it; the first anchor of a file row is the file, the second its viewer. */
  const attachmentsOf = (li) => {
    const out = [];
    for (const row of li.querySelectorAll(".edge-main .attachments-file, .edge-main .attachments-link")) {
      const link = [...row.querySelectorAll("a[href]")].find((a) => !/\/attachment\/\d+\/docviewer/i.test(a.getAttribute("href") || ""));
      const href = link?.getAttribute("href") || "";
      if (!href || out.some((x) => x.url === href)) continue;
      const copy = link.cloneNode(true);
      copy.querySelectorAll(".infotip-content, .visually-hidden").forEach((el) => el.remove());
      const title = clean(link.getAttribute("title") || copy.textContent);
      if (!title) continue;
      out.push({
        kind: /\/attachment\/\d+\/source\//i.test(href) ? "file" : /^\/link\?/.test(href) || /^https?:/i.test(href) ? "link" : "page",
        title,
        url: href,
        target: /^\/link\?/.test(href) ? unwrapLink(href) : "",
        filename: link.querySelector(".infotip[aria-label]")?.getAttribute("aria-label") || "",
        size: clean(row.querySelector(".attachments-file-size")?.textContent),
      });
    }
    return out;
  };

  const items = [];
  let more = false;
  if (feed) {
    const root = document.createElement("div");
    root.innerHTML = feed;
    more = !!root.querySelector(".s-edge-feed-more-link a");

    for (const li of root.querySelectorAll("li[id^='edge-assoc-']")) {
      const inner = li.querySelector(".update-sentence-inner");
      if (!inner) continue;
      const counter = li.querySelector("[id^='comments-post-']")?.id || "";
      const showMore = li.querySelector("a.show-more-link")?.getAttribute("href") || "";
      const id =
        counter.match(/^comments-post-(\d+)/)?.[1] ||
        showMore.match(/\/update_post\/(\d+)/)?.[1] ||
        li.innerHTML.match(/immersive-reader-nid-(\d+)/)?.[1] ||
        li.id.replace("edge-assoc-", "");

      const authorLink = inner.querySelector(".long-username a") || li.querySelector(".profile-picture a");
      const realmLink = [...inner.querySelectorAll("a[href]")].find((a) =>
        /^\/(course|group|school)\/\d+/.test(a.getAttribute("href") || "")
      );
      const [, realmKind = "", realmId = ""] = (realmLink?.getAttribute("href") || "").match(/^\/(course|group|school)\/(\d+)/) || [];

      const body = inner.querySelector(".update-body");
      body?.querySelectorAll(".show-more-link").forEach((el) => el.remove());

      items.push({
        id,
        at: Number(li.getAttribute("timestamp")) * 1000 || 0,
        kind: /poll/i.test(li.firstElementChild?.className || "") ? "poll" : "post",
        author: clean(authorLink?.textContent) || authorLink?.getAttribute("title") || "",
        realmKind,
        realmId,
        realm: clean(realmLink?.textContent),
        realmUrl: realmKind ? `${origin}/${realmKind}/${realmId}/updates` : "",
        ...describe(body),
        // Dropped from the markup above, so the app can say there's more to see in Schoology.
        media: body ? body.querySelectorAll("img, iframe, video").length : 0,
        attachments: attachmentsOf(li),
        comments: Number(counter.match(/-num-(\d+)$/)?.[1] || 0),
        more: showMore,
      });
    }
  }

  const full = {};
  for (const [id, html] of Object.entries(bodies || {})) {
    const root = document.createElement("div");
    root.innerHTML = html;
    full[id] = describe(root);
  }

  return { items, more, bodies: full };
}

/*
 * Schoology answers 429 to a burst of requests, so they're spaced out, and a
 * sync where the newest page holds nothing new reuses the last read: new posts
 * land on top, and one request says whether there are any. Everything is read
 * again hourly anyway, for comment counts and edits further down.
 */
const PAUSE_MS = 400;
const FULL_READ_MS = 60 * 60_000;
const pause = () => new Promise((resolve) => setTimeout(resolve, PAUSE_MS));

/** The last read: posts keep `more` until their full text is in. `at` is 0 when it was cut short. */
let last = null;

async function feedPage(page, origin, p) {
  const res = await page.request.get(`${origin}/home/feed?page=${p}`, { timeout: 20_000 });
  if (!res.ok()) throw new Error(`the feed answered ${res.status()}`);
  const json = await res.json().catch(() => null);
  return typeof json?.output === "string" ? page.evaluate(readMarkup, { feed: json.output, origin }) : null;
}

async function readFeed(page, origin, top) {
  const cutoff = Date.now() - MAX_AGE_MS;
  const posts = [];
  let slice = top;
  let complete = true;
  for (let p = 1; slice; p++) {
    for (const post of slice.items) if (!posts.some((x) => x.id === post.id)) posts.push(post);
    const oldest = slice.items[slice.items.length - 1];
    if (!slice.more || !oldest || oldest.at < cutoff || p >= MAX_PAGES) break;
    await pause();
    slice = await feedPage(page, origin, p).catch((e) => {
      console.error(`  updates page ${p}: ${e.message}`);
      complete = false;
      return null;
    });
  }
  return { posts: posts.filter((post) => post.at >= cutoff), complete };
}

/** Full text for posts cut off behind "Show More": from the cache, else fetched until Schoology pushes back. */
async function fillBodies(page, origin, posts) {
  const cache = loadBodies();
  const fetched = {};
  let refused = false;

  for (const post of posts) {
    if (!post.more) continue;
    const hit = cache[post.id];
    if (hit && hit.preview === post.text) {
      Object.assign(post, { html: hit.html, text: hit.text, more: "" });
      continue;
    }
    if (refused) continue;
    await pause();
    const res = await page.request.get(new URL(post.more, origin).href, { timeout: 15_000 }).catch(() => null);
    const json = res?.ok() ? await res.json().catch(() => null) : null;
    if (typeof json?.update === "string") fetched[post.id] = { raw: json.update, preview: post.text };
    else refused = true;
  }

  let changed = false;
  if (Object.keys(fetched).length) {
    const raw = Object.fromEntries(Object.entries(fetched).map(([id, f]) => [id, f.raw]));
    const { bodies } = await page.evaluate(readMarkup, { bodies: raw, origin });
    for (const [id, body] of Object.entries(bodies)) {
      cache[id] = { preview: fetched[id].preview, ...body };
      const post = posts.find((x) => x.id === id);
      if (post) Object.assign(post, body, { more: "" });
      changed = true;
    }
  }
  for (const id of Object.keys(cache)) {
    if (posts.some((post) => post.id === id)) continue;
    delete cache[id];
    changed = true;
  }
  if (changed) saveBodies(cache);
}

const shown = (posts) => posts.map(({ more: _more, ...post }) => post);

/** Every post from the last few months, newest first. A failed read keeps the last good one. */
export async function readUpdates(page, domain) {
  const origin = `https://${domain}`;
  try {
    const top = await feedPage(page, origin, 0);
    const unchanged =
      last?.at && top && Date.now() - last.at < FULL_READ_MS && top.items.every((post) => last.posts.some((x) => x.id === post.id));

    let posts;
    let at = last?.at ?? 0;
    if (unchanged) {
      posts = last.posts.map((post) => ({ ...post, comments: top.items.find((x) => x.id === post.id)?.comments ?? post.comments }));
    } else {
      const read = top ? await readFeed(page, origin, top) : { posts: [], complete: true };
      posts = read.posts;
      at = read.complete ? Date.now() : 0;
    }

    await fillBodies(page, origin, posts);
    last = { posts, at };
    return shown(posts);
  } catch (e) {
    if (!last) throw e;
    console.error(`  updates: ${e.message}; keeping the last read`);
    return shown(last.posts);
  }
}
