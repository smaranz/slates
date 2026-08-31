import { launch, readConfig, isLoggedIn, openHome } from "./browser.mjs";

/**
 * Scrape Schoology from a real, rendered page.
 *
 * The To Do panel and course dashboard are populated client-side — fetching the
 * HTML returns empty `hidden` containers — so everything here reads the live
 * DOM after the page's own JavaScript has run.
 */

/*
 * Confirmed against the live rendered DOM. Note the overdue list is ALSO a
 * `.upcoming-list`, nested under `.overdue-submissions` — there is no
 * `.overdue-submissions-list` element despite the wrapper being named that way.
 */
const TODO = {
  upcoming: "#todo .upcoming-submissions .upcoming-list",
  overdue: "#todo .overdue-submissions .upcoming-list",
  completed: ".recently-completed-wrapper .recently-completed-list",
};

/** Runs in page context: pull rows out of one To Do list. */
function extractList({ sel, completed }) {
  const root = document.querySelector(sel);
  if (!root) return [];

  const ITEM = /\/(assignment|quiz|assessment|discussion|event|page)\/(?:view\/)?(\d+)/;
  const COURSE = /^[A-Za-z][A-Za-z0-9 .,&'/+-]*\s-\s\d{3,6}$/;
  const out = [];
  const seen = new Set();

  for (const a of root.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") || "";
    const hit = href.match(ITEM);
    if (!hit || hit[1] === "page") continue;
    if (seen.has(hit[2])) continue;

    const title = (a.textContent || "").replace(/\s+/g, " ").trim();
    if (!title) continue;
    seen.add(hit[2]);

    // The row that carries the date; "overdue" never contains the bare "due".
    let row = a.parentElement;
    for (let i = 0; i < 6 && row; i++, row = row.parentElement) {
      if (/\b(?:over)?due\b/i.test(row.textContent || "")) break;
    }
    row = row || a.closest("li,div") || a.parentElement;

    const cells = [...row.querySelectorAll("*")]
      .filter((e) => !e.querySelector("*"))
      .map((e) => (e.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);

    const due =
      cells.find((t) =>
        /^(?:due\b|this was due|\d+\s+days?\s+overdue|1\s+day\s+overdue|due\s+(?:today|tomorrow))/i.test(t)
      ) || "";

    // Rows carry the clean label ("Spanish 3 - 4330") and often an extended one
    // ("Spanish 3 - 4330 : AbarcaN p1 T1"). The extended form is what lets us
    // match the /courses list, which only exposes the teacher fragment.
    const courseName = [...cells].reverse().find((t) => COURSE.test(t)) || "";
    const courseFull =
      [...cells].reverse().find((t) => /\s-\s\d{3,6}\s*:/.test(t)) || courseName;

    out.push({
      id: hit[2],
      kind: hit[1] === "quiz" ? "assessment" : hit[1] === "event" ? "assignment" : hit[1],
      title,
      due,
      courseName,
      courseFull,
      completed,
      url: new URL(href, location.origin).href,
      rowText: (row.textContent || "").replace(/\s+/g, " ").trim().slice(0, 240),
    });
  }
  return out;
}

/**
 * "Recently Completed" ships collapsed and unloaded — the container holds a
 * single "Click here to load the Recently Completed items" button and no rows.
 *
 * Reading it without expanding always returned zero, so nothing was ever seen
 * as completed. Finished work didn't move to Turned in; it just dropped off the
 * To Do panel and vanished from the board entirely.
 */
async function expandCompleted(page) {
  const button = page.locator(".recently-completed-wrapper button.refresh-button").first();
  if ((await button.count()) === 0) {
    console.error("  completed: no expand button found");
    return;
  }

  // The button stays in the DOM while collapsed, so click through the element
  // itself rather than a visibility-gated Playwright click.
  try {
    await button.evaluate((el) => el.click());
  } catch (e) {
    console.error(`  completed: click failed: ${e.message}`);
    return;
  }

  /*
   * Wait for actual rows, not for children.
   *
   * The collapsed container is not empty — it already holds the "click here to
   * load" prompt as its one child. A `children.length > 0` check therefore
   * passed instantly, extraction ran against the placeholder, and every scrape
   * reported nothing completed. The rows land about three seconds later.
   */
  try {
    await page.waitForFunction(
      (sel) => {
        const list = document.querySelector(sel);
        if (!list) return false;
        if (list.querySelector("a[href]")) return true;
        // Nothing completed at all: the prompt goes away and no rows replace it.
        return !document.querySelector(".recently-completed-wrapper button.refresh-button");
      },
      TODO.completed,
      { timeout: 15_000 }
    );
  } catch {
    console.error("  completed: no rows appeared after expanding");
  }
}

async function readTodo(page) {
  // The lists arrive by AJAX after load; wait for the first one to fill.
  await page
    .waitForFunction(
      (s) => {
        const el = document.querySelector(s);
        return !!el && el.children.length > 0;
      },
      TODO.upcoming,
      { timeout: 20_000 }
    )
    .catch(() => {}); // an empty To Do panel is a valid state

  await expandCompleted(page);

  // page.evaluate takes a single argument — passing extras silently drops them.
  // Errors are logged rather than swallowed; a silent catch here previously hid
  // a broken extraction and looked like "Schoology has no assignments".
  const run = (sel, completed) =>
    page.evaluate(extractList, { sel, completed }).catch((e) => {
      console.error(`  extract failed for ${sel}: ${e.message}`);
      return [];
    });

  const [upcoming, overdue, completed] = await Promise.all([
    run(TODO.upcoming, false),
    run(TODO.overdue, false),
    run(TODO.completed, true),
  ]);

  // Completed first so a still-open duplicate wins.
  const byId = new Map();
  for (const item of [...completed, ...overdue, ...upcoming]) byId.set(item.id, item);
  return [...byId.values()];
}

async function readCourses(page, domain) {
  await page.goto(`https://${domain}/courses`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500); // dashboard cards render client-side

  return page.evaluate(() => {
    const out = new Map();
    for (const a of document.querySelectorAll('a[href*="/course/"]')) {
      const m = (a.getAttribute("href") || "").match(/\/course\/(\d+)/);
      if (!m) continue;
      const name = (a.textContent || "").replace(/\s+/g, " ").trim();
      // Prefer the longest label seen for an id — nested links often hold only
      // the teacher/section fragment ("AgarwalA p5 T1").
      const prev = out.get(m[1]);
      if (name && (!prev || name.length > prev.name.length)) {
        out.set(m[1], { id: m[1], name, url: new URL(a.getAttribute("href"), location.origin).href });
      }
    }
    return [...out.values()];
  });
}

/**
 * Runs in page context on /grades/grades.
 *
 * The report is a set of `.gradebook-course` blocks, each holding a four-tier
 * table: course row → grading-period row → category row → item row, linked by
 * `data-id` / `data-parent-id`. Two things about it are easy to get wrong:
 *
 *  - There is not a single `/course/` link on the page. The course id lives in
 *    `id="s-js-gradebook-course-<id>"`. Keying off links found nothing at all,
 *    which is why grades were empty.
 *  - Rows below the top tier are collapsed, so `innerText` omits them. Read
 *    `textContent`, which ignores visibility.
 */
function extractGrades() {
  // Row labels embed screen-reader-only words ("Course", "Category", "Due")
  // that would otherwise end up in the visible name.
  const label = (el) => {
    if (!el) return "";
    const c = el.cloneNode(true);
    for (const h of c.querySelectorAll(".visually-hidden")) h.remove();
    return (c.textContent || "").replace(/\s+/g, " ").trim();
  };

  // `.rounded-grade` shows "96.89%" but carries full precision in @title.
  const num = (el) => {
    if (!el) return null;
    const raw = el.getAttribute("title") ?? el.textContent ?? "";
    const m = raw.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  };

  /*
   * A letter grade with no percentage beside it. Schoology renders three
   * different shapes in a grade column and only one of them has a number:
   *   points + letter   <span class=awarded-grade>A<span class=numeric-grade-value>10
   *   points only       <span class=awarded-grade><span class=rounded-grade>3
   *   letter only       <span class=awarded-grade>A+
   * The last kind is a real grade — a whole course can be marked in letters
   * alone — so dropping it left classes looking ungraded when they weren't.
   */
  const letterOf = (el) => {
    if (!el) return "";
    const alpha = el.querySelector(".alpha-grade");
    if (alpha) return label(alpha);
    const c = el.cloneNode(true);
    for (const junk of c.querySelectorAll(
      ".numeric-grade-value, .rounded-grade, .max-grade, .grade-wrapper, .visually-hidden"
    )) {
      junk.remove();
    }
    const t = (c.textContent || "").replace(/\s+/g, " ").trim();
    return /^[A-F][+-]?$/.test(t) ? t : "";
  };

  const gradebook = {};
  const courseGrades = {};
  const courses = [];

  for (const block of document.querySelectorAll(".gradebook-course")) {
    const id = (block.id || "").replace(/^s-js-gradebook-course-/, "");
    if (!id) continue;

    const name = label(block.querySelector(".gradebook-course-title"));
    courses.push({ id, name });

    const rows = [...block.querySelectorAll("tr.report-row")];
    const childrenOf = (parent, cls) =>
      rows.filter((r) => r.dataset.parentId === parent && r.classList.contains(cls));

    const courseRow = rows.find((r) => r.classList.contains("course-row"));
    const awarded = courseRow?.querySelector(".awarded-grade");
    const pct = num(courseRow?.querySelector(".rounded-grade"));
    const letter = letterOf(awarded);
    // A letter with no percentage still counts as graded.
    if (pct !== null || letter) courseGrades[id] = { pct, letter };

    // A course carries one row per grading period, plus a `data-id="0"` bucket
    // for work outside any period. Take the first period that actually has
    // categories so a closed/empty term doesn't blank the course.
    let cats = [];
    for (const period of childrenOf(id, "period-row")) {
      const found = [];

      for (const catRow of childrenOf(period.dataset.id, "category-row")) {
        const items = [];
        let earned = 0;
        let possible = 0;

        for (const itemRow of childrenOf(catRow.dataset.id, "item-row")) {
          // The score sits under `.numeric-grade-value` when a letter is shown
          // alongside it, and directly under `.awarded-grade` when it isn't.
          // Matching only the first shape read whole graded courses as empty.
          const got = num(itemRow.querySelector(".awarded-grade .rounded-grade"));
          const max = num(itemRow.querySelector(".max-grade"));
          const link = itemRow.querySelector("a[href]");
          // Ungraded work still shows in the report; it must not drag the
          // category average down, so only scored items count toward the total.
          if (got !== null && max !== null) {
            earned += got;
            possible += max;
          }
          const itemLetter = letterOf(itemRow.querySelector(".awarded-grade"));
          items.push({
            id: (itemRow.dataset.id || "").replace(/^I-/, ""),
            name: label(link) || label(itemRow.querySelector(".title")),
            score: got !== null ? `${got}/${max ?? "—"}` : itemLetter || "—",
            earned: got,
            possible: max,
            letter: itemLetter,
            date: label(itemRow.querySelector(".due-date")),
            url: link ? new URL(link.getAttribute("href"), location.origin).href : "",
          });
        }

        const title = label(catRow.querySelector(".title"));
        if (!title) continue;

        found.push({
          cat: title,
          weight: num(catRow.querySelector(".percentage-contrib")) ?? 0,
          // Points and percentage are kept apart on purpose. A category can be
          // graded without any item showing points, and an ungraded category
          // has no percentage at all — collapsing the two made "nothing scored
          // yet" render as a zero.
          pct: num(catRow.querySelector(".rounded-grade")),
          letter: letterOf(catRow.querySelector(".awarded-grade")),
          earned,
          possible,
          items,
        });
      }

      if (found.length) {
        cats = found;
        break;
      }
    }

    if (cats.length) gradebook[id] = cats;
  }

  return { gradebook, courseGrades, courses };
}

/** Full gradebook — course percentages, weighted categories, and every item. */
async function readGrades(page, domain) {
  await page.goto(`https://${domain}/grades/grades`, { waitUntil: "domcontentloaded" });
  // The report is built client-side; wait for the rows rather than a fixed delay.
  await page
    .waitForFunction(() => document.querySelectorAll("tr.report-row.course-row").length > 0, null, {
      timeout: 20_000,
    })
    .catch(() => {});

  return page.evaluate(extractGrades);
}

/**
 * The /courses page exposes only a fragment ("AbarcaN p1 T1"), while a To Do row
 * carries the readable label and often the extended form that contains that
 * fragment. Match on the extended form so items land under the right course.
 */
/**
 * Runs in page context on a single assignment page.
 *
 * The To Do panel only knows title/date/course — every detail view looked
 * identical without this. Here we find out what the item actually *is*: a
 * timed attempt, a file dropbox, a text entry, points, and instructions.
 */
function extractDetail() {
  /*
   * Schoology's assessment player is configured by a JSON object embedded in a
   * script tag, and it is authoritative: the time limit, attempt counts, open
   * window, and LockDown Browser requirement all live there. Reading it beats
   * scraping the rendered page, which shows none of those things until you have
   * already started an attempt.
   */
  const readInitialization = () => {
    for (const script of document.querySelectorAll("script")) {
      const src = script.textContent || "";
      const key = '"initialization":';
      const at = src.indexOf(key);
      if (at < 0) continue;

      const start = src.indexOf("{", at + key.length);
      if (start < 0) continue;

      // Brace-match while respecting string literals, since `instructions` can
      // contain braces and escaped quotes.
      let depth = 0;
      let inStr = false;
      let esc = false;
      for (let i = start; i < src.length; i++) {
        const ch = src[i];
        if (esc) {
          esc = false;
          continue;
        }
        if (ch === "\\") {
          if (inStr) esc = true;
          continue;
        }
        if (ch === '"') {
          inStr = !inStr;
          continue;
        }
        if (inStr) continue;
        if (ch === "{") depth++;
        else if (ch === "}" && --depth === 0) {
          try {
            return { init: JSON.parse(src.slice(start, i + 1)), src };
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  };

  const found = readInitialization();
  if (found) {
    const { init, src } = found;
    const after = src.slice(src.indexOf('"initialization":'));
    const flag = (name) => new RegExp(`"${name}"\\s*:\\s*(true|false)`).exec(after)?.[1] === "true";
    const scenario = /"launchScenario"\s*:\s*"([^"]+)"/.exec(after)?.[1] ?? "";

    // minutesMax is 0 for an untimed assessment, not "missing".
    const limit = Number(init.minutesMax) || 0;
    const used = Number(init.numAttemptsTaken) || 0;
    const allowed = Number(init.numAttemptsAllowed) || 0;

    return {
      title: init.title ?? "",
      brief: init.instructions ?? "",
      category: "",
      openUntil: "",
      points: init.gradebookPointsTotal ?? null,
      earned: init.score ?? null,
      attemptsUsed: used,
      // 0 means unlimited in Schoology's config.
      attemptsAllowed: allowed || null,
      submissionTypes: ["attempt"],
      submit: "overlay",
      kind: "assessment",
      // /assignment/<id> redirects here; this is the URL that opens the player.
      playerUrl: location.href,
      assessment: {
        timeLimitMin: limit || null,
        questionPoints: init.pointsTotal ?? null,
        opensAt: Number(init.availableFrom) || null,
        closesAt: Number(init.availableTo) || null,
        // `availability` 2 is open; 0 is closed to submissions.
        open: Number(init.availability) === 2 && init.studentViewable !== false,
        lockdown: init.lockDownBrowser?.isRequired === true,
        passwordRequired: flag("hasPasswordEnabled"),
        overdue: flag("assessmentIsOverdue"),
        attemptsLeft: allowed ? Math.max(0, allowed - used) : null,
        scenario,
        // Schoology runs the real clock server-side; Slates can only mirror it.
        resumable: /RESUME/i.test(scenario),
      },
    };
  }

  const text = (document.body.innerText || "").replace(/\s+/g, " ").trim();
  const pick = (sel) => {
    const el = document.querySelector(sel);
    return el ? (el.textContent || "").replace(/\s+/g, " ").trim() : "";
  };

  const hasStartAttempt = [...document.querySelectorAll("a,button,input")].some((el) =>
    /start attempt|resume attempt|begin/i.test(el.textContent || el.value || "")
  );
  const fileInputs = document.querySelectorAll('input[type="file"]').length;

  /*
   * Every Schoology assignment page carries a `comment` textarea and a `reply`
   * textarea for the discussion thread at the bottom — whether or not anything
   * can be handed in. Counting those as submission fields made paper and
   * in-class work look like it accepted a written response, so Slates rendered
   * a response box that submitted nowhere.
   *
   * The real signal is the dropbox: a "Submit Assignment" control. Work with no
   * dropbox, no file input and no attempt has nothing to hand in at all.
   */
  const submissionFields = [...document.querySelectorAll("textarea")].filter(
    (t) => !/^(comment|reply)$/.test(t.name)
  ).length;
  const hasDropbox =
    !!document.querySelector(".dropbox-submit") ||
    [...document.querySelectorAll("a,button,input")].some((el) =>
      /submit assignment|resubmit assignment/i.test(el.textContent || el.value || "")
    );
  const isDrive = /google drive|one ?drive|drive assignment/i.test(text);

  /*
   * The grade, which Schoology writes as one of:
   *   "Grade: N/A"      not scored yet
   *   "Grade: 5/5"      points
   *   "Grade: A 10/10"  points with a letter in front
   *   "Grade: A"        letter only
   *
   * The "Grade" anchor is mandatory, and the ratio has to follow it directly.
   * Matching a bare `number/number` anywhere on the page read the first date or
   * title that looked like one — an assignment called "HW 8/28" came back
   * scored 8 out of 28, and that fabricated grade flowed into the item's point
   * value too. A page with no grade line now reports no grade, which is the
   * truth; the gradebook is the authoritative source for scores anyway.
   */
  const clause =
    text.match(
      /\bgrade\b\s*:?\s*(N\/A|[A-F][+-]?(?:\s+[\d.]+\s*\/\s*[\d.]+)?|[\d.]+\s*\/\s*[\d.]+|[–—-]\s*\/\s*[\d.]+)/i
    )?.[1] ?? "";
  const scored = clause.match(/([\d.]+)\s*\/\s*([\d.]+)/);
  // "–/10" is ungraded but still says what the assignment is worth.
  const outOf = clause.match(/\/\s*([\d.]+)/);
  const earned = scored ? parseFloat(scored[1]) : null;
  const possible = outOf ? parseFloat(outOf[1]) : null;

  const attempts = text.match(/made\s+(\d+)\s+of\s+(\d+)\s+attempts?/i);
  const openUntil = text.match(/Open until ([A-Za-z0-9,: ]+?(?:am|pm))/i)?.[1] ?? "";
  const category = text.match(/Category:\s*([A-Za-z0-9 &'-]+?)(?:Period:|Grading|$)/i)?.[1]?.trim() ?? "";

  // Instructions live in the body area; fall back to nothing rather than
  // scooping up page chrome.
  let brief = "";
  for (const sel of [
    ".assignment-description",
    ".info-body",
    ".s-page-content .body",
    "[class*='item-body']",
    "[class*='description']",
  ]) {
    const t = pick(sel);
    if (t && t.length > brief.length) brief = t;
  }
  if (brief.length > 1200) brief = brief.slice(0, 1200) + "…";

  const submissionTypes = [];
  if (hasStartAttempt) submissionTypes.push("attempt");
  if (fileInputs) submissionTypes.push("file");
  // A dropbox opens a modal with both an Upload tab and a Create tab, so it
  // accepts either. If a teacher has restricted one, the submission itself
  // reports that — better than hiding a control that might work.
  if (hasDropbox || submissionFields) submissionTypes.push("text");
  if (hasDropbox && !fileInputs) submissionTypes.push("file");
  if (isDrive) submissionTypes.push("drive");

  // Nothing to hand in: no dropbox, no upload, no attempt, no linked doc.
  const nothingToSubmit = !submissionTypes.length;

  return {
    title: pick("h1"),
    brief,
    category,
    openUntil,
    points: possible,
    earned,
    attemptsUsed: attempts ? Number(attempts[1]) : null,
    attemptsAllowed: attempts ? Number(attempts[2]) : null,
    submissionTypes,
    // Anything needing Schoology's own flow opens there instead of pretending
    // Slates can submit it. "none" means there is nothing to submit anywhere —
    // paper, in-class, or a reminder — so the only thing left is to tick it off.
    submit: nothingToSubmit ? "none" : hasStartAttempt || isDrive ? "overlay" : "native",
    kind: hasStartAttempt ? "assessment" : "assignment",
  };
}

/** Visit each item's own page to fill in what the To Do panel can't tell us. */
async function readDetails(page, items, domain) {
  const out = new Map();

  for (const item of items) {
    const url = item.url?.startsWith("http") ? item.url : `https://${domain}${item.url}`;
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await page.waitForTimeout(1200); // grade/attempt widgets render late
      out.set(item.id, await page.evaluate(extractDetail));
    } catch (e) {
      console.error(`  detail failed for ${item.id}: ${e.message}`);
    }
  }
  return out;
}

/**
 * Runs in page context on /messages (or /messages?page=N).
 *
 * Unlike the To Do panel, the inbox is a plain server-rendered Drupal
 * `privatemsg` table — every row is already in the initial HTML, no AJAX wait
 * needed. The `subject` attribute on the cell carries the untruncated subject;
 * the anchor text and `.privatemsg-list-body` preview are both cut short by
 * Schoology itself.
 */
function extractMessages() {
  const rows = [...document.querySelectorAll("table.privatemsg-list tbody tr")];
  return rows
    .map((row) => {
      const link = row.querySelector("a.subject-link");
      const id = (link?.getAttribute("href") || "").match(/(\d+)\s*$/)?.[1] || "";
      const subjectCell = row.querySelector("td.privatemsg-list-subject");
      const subject = subjectCell?.getAttribute("subject") || (link?.textContent || "").trim();
      const body = (row.querySelector(".privatemsg-list-body")?.textContent || "")
        .replace(/\s+/g, " ")
        .trim();
      const from = (row.querySelector(".names-date a")?.textContent || "").trim();
      const time = (row.querySelector(".names-date .small.gray")?.textContent || "").trim();
      return { id, from, courseId: "", subject, body, time, unread: row.classList.contains("privatemsg-unread") };
    })
    .filter((m) => m.id);
}

/** Highest `?page=` the pager links to, or 0 when the inbox fits on one page. */
function lastMessagePage() {
  const href = document.querySelector(".pager-last a")?.getAttribute("href") || "";
  return Number(href.match(/page=(\d+)/)?.[1] || 0);
}

/**
 * Every inbox thread, newest first, across all pages.
 *
 * Capped at 12 pages (300 messages at 25/page) so a years-deep inbox can't
 * turn a routine sync into dozens of sequential page loads.
 */
async function readMessages(page, domain) {
  await page.goto(`https://${domain}/messages`, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const all = await page.evaluate(extractMessages);
  const maxPage = Math.min(await page.evaluate(lastMessagePage).catch(() => 0), 11);

  for (let p = 1; p <= maxPage; p++) {
    await page.goto(`https://${domain}/messages?page=${p}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    all.push(...(await page.evaluate(extractMessages)));
  }

  return all;
}

const norm = (s) => (s || "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * A To Do row names its course the readable way ("Spanish 3 - 4330"), which is
 * exactly the part of the grades report title that precedes the colon. Matching
 * on that beats the old approach of hunting for the /courses teacher fragment,
 * which missed often enough to invent duplicate courses.
 */
function matchCourse(courses, item) {
  const name = norm(item.courseName);
  const full = norm(item.courseFull);
  if (!name && !full) return null;

  return (
    courses.find((c) => name.length > 3 && norm(c.name) === name) ||
    courses.find((c) => name.length > 3 && norm(c.name).startsWith(name)) ||
    // Extended label ("Spanish 3 - 4330 : AbarcaN p1 T1") contains the section.
    courses.find((c) => c.period.length > 3 && full.includes(norm(c.period))) ||
    null
  );
}

/**
 * Keep one browser alive across scrapes.
 *
 * Automatic sync polls regularly, and relaunching Chrome each time costs
 * seconds and re-runs the SSO hop. Holding the context open makes a repeat
 * scrape cheap. `reuse: false` (the default for one-off CLI runs) still gets a
 * clean throwaway browser.
 */
let shared = null;

async function getContext(headless) {
  if (shared && !shared.ctx.browser()?.isConnected?.()) shared = null;
  if (shared?.headless === headless) return shared.ctx;
  if (shared) await shared.ctx.close().catch(() => {});
  const ctx = await launch({ headless });
  shared = { ctx, headless };
  return ctx;
}

/** The live browser context, for callers that need their own page in it. */
export async function getSharedContext(headless = true) {
  return getContext(headless);
}

export async function closeShared() {
  if (!shared) return;
  await shared.ctx.close().catch(() => {});
  shared = null;
}

export async function scrape({ headless = true, reuse = false } = {}) {
  const { domain } = readConfig();
  if (!domain) throw new Error("Not set up yet — run: npm run login -- <district>.schoology.com");

  const ctx = reuse ? await getContext(headless) : await launch({ headless });
  try {
    const page = await openHome(ctx, domain);
    if (!(await isLoggedIn(page))) {
      throw new Error("Signed out of Schoology — run: npm run login");
    }

    const todo = await readTodo(page);
    const enrolled = await readCourses(page, domain);
    const grades = await readGrades(page, domain).catch((e) => {
      console.error(`  grades failed: ${e.message}`);
      return { gradebook: {}, courseGrades: {}, courses: [] };
    });
    const { gradebook, courseGrades } = grades;
    const messages = await readMessages(page, domain).catch((e) => {
      console.error(`  messages failed: ${e.message}`);
      return [];
    });

    /*
     * The grades report is the better course list: it names every course in
     * full ("AP Physics 1 - 3750: AgarwalA p5 T1") and exposes the id, whereas
     * /courses only ever yields the teacher fragment ("AgarwalA p5 T1"). Use it
     * for identity, and borrow the real course URL from /courses.
     */
    const courses = grades.courses.map((c) => {
      const [head, tail = ""] = c.name.split(/\s*:\s*/);
      const period = tail.trim();
      const link =
        enrolled.find((e) => e.id === c.id) ||
        (period.length > 3 ? enrolled.find((e) => norm(e.name) === norm(period)) : null);
      return { id: c.id, name: head.trim() || c.name, period, url: link?.url ?? "#" };
    });

    // A course with no gradebook entry at all still belongs on the board.
    for (const e of enrolled) {
      if (!courses.some((c) => c.id === e.id || norm(c.period) === norm(e.name))) {
        courses.push({ id: e.id, name: e.name, period: "", url: e.url });
      }
    }

    const stats = {
      todo: todo.length,
      courses: courses.length,
      graded: Object.keys(courseGrades).length,
      messages: messages.length,
      unmatched: 0,
    };
    const assignments = [];

    for (const item of todo) {
      let course = matchCourse(courses, item);
      if (!course && item.courseName) {
        // Keep the assignment rather than dropping it over a label mismatch.
        course = { id: `x-${item.courseName}`, name: item.courseName, period: "", url: "#" };
        courses.push(course);
        stats.unmatched++;
      }
      if (!course) continue;

      assignments.push({
        id: item.id,
        courseId: course.id,
        kind: item.kind,
        submit: item.kind === "assessment" ? "overlay" : "native",
        title: item.title,
        due: item.due,
        completed: item.completed,
        url: item.url,
      });
    }

    // Fill in per-assignment detail — instructions, points, attempts, and how
    // the thing is actually submitted. Without this every detail view is
    // identical, because the To Do panel only carries title/date/course.
    /*
     * Only open pages for work that's still outstanding. Detail scraping is a
     * page visit each, and expanding Recently Completed roughly triples the
     * item count — but a finished assignment needs none of it. Its score comes
     * from the gradebook, and how to submit it no longer matters.
     */
    const details = await readDetails(page, assignments.filter((a) => !a.completed), domain);
    stats.detailed = details.size;

    for (const a of assignments) {
      const d = details.get(a.id);
      if (!d) continue;

      a.brief = d.brief || "";
      a.kind = d.kind ?? a.kind;
      a.submit = d.submit ?? a.submit;
      a.submissionTypes = d.submissionTypes;
      a.category = d.category || "";
      if (d.points != null) a.points = d.points;
      if (d.attemptsUsed != null) a.attemptsUsed = d.attemptsUsed;
      if (d.attemptsAllowed != null) a.attemptsAllowed = d.attemptsAllowed;

      if (d.assessment) {
        a.assessment = d.assessment;
        a.timeLimitMin = d.assessment.timeLimitMin;
        a.resumable = d.assessment.resumable;
        // The assessment player lives on the course URL the item redirected to,
        // not the /assignment/<id> link the To Do panel hands out.
        if (d.playerUrl) a.url = d.playerUrl;
      }
      if (d.earned != null && d.points != null) {
        a.grade = { earned: d.earned, possible: d.points, feedback: "" };
      }
      // "Open until …" is the actionable deadline when the row had no date.
      if (!a.due && d.openUntil) a.due = `Due ${d.openUntil}`;
    }

    /*
     * The gradebook lists every scored item by assignment id, and it is the
     * authoritative score — an assignment page shows a grade only once the
     * teacher has released it to that view.
     */
    const scored = new Map();
    for (const cats of Object.values(gradebook)) {
      for (const cat of cats) {
        for (const it of cat.items) {
          if (it.earned !== null && it.possible !== null) scored.set(it.id, { ...it, cat: cat.cat });
        }
      }
    }
    stats.scored = scored.size;

    for (const a of assignments) {
      const hit = scored.get(a.id);
      if (!hit) continue;
      a.grade = { earned: hit.earned, possible: hit.possible, feedback: "" };
      a.points = hit.possible;
      if (!a.category) a.category = hit.cat;
    }

    return {
      snapshot: {
        domain,
        courses,
        assignments,
        gradebook,
        // Schoology's own weighted percentage, which beats recomputing one from
        // categories whose weights don't always sum to 100.
        courseGrades,
        history: {},
        messages,
        syncedAt: Date.now(),
      },
      stats,
      sample: todo.slice(0, 3).map((t) => t.rowText),
    };
  } finally {
    if (!reuse) await ctx.close();
  }
}
