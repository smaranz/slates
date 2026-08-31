/**
 * Slates authenticated proxy.
 *
 * Runs as a content script on *.schoology.com. Everything here is same-origin,
 * so the session cookie rides along automatically. This is the ONLY place in
 * the extension that talks to Schoology — see background/service-worker.js for
 * why the service worker must not.
 *
 * Selectors: parsing keys off URL shape (/assignment/123) rather than CSS
 * classes wherever possible, because Schoology reskins its markup between
 * versions and districts but the URL structure is stable. Where a real class
 * name is unavoidable, there's a `dumpPage` RPC to capture live HTML for tuning.
 */

(() => {
  const ORIGIN = location.origin;

  /**
   * Bump on every change to this file. Reloading an extension does NOT
   * re-inject content scripts into already-open tabs, so a stale copy keeps
   * serving old results with no error. The service worker compares this
   * against its own BUILD and reloads the tab when they diverge.
   */
  const BUILD = "2026-08-30.7";

  /* ---------------- fetch ---------------- */

  /**
   * An expired session doesn't 401 — Schoology 302s to the login form, which
   * `redirect: "follow"` turns into a 200 full of login HTML. Sniff for the
   * login form instead of trusting the status code.
   */
  function looksLikeLogin(html) {
    return (
      /name=["']s_user_login_form["']/.test(html) ||
      /id=["']edit-mail["']/.test(html) ||
      /<form[^>]+action=["'][^"']*\/login/.test(html)
    );
  }

  async function sget(path, init = {}) {
    const res = await fetch(new URL(path, ORIGIN), {
      credentials: "include",
      headers: { "x-requested-with": "XMLHttpRequest", ...(init.headers ?? {}) },
      ...init,
    });
    const text = await res.text();
    if (looksLikeLogin(text)) throw err("SESSION_EXPIRED", "Session expired.");
    return { res, text };
  }

  function err(code, message) {
    return Object.assign(new Error(message), { code });
  }

  function parse(html) {
    return new DOMParser().parseFromString(html, "text/html");
  }

  function abs(href) {
    try {
      return new URL(href, ORIGIN).href;
    } catch {
      return href;
    }
  }

  /* ---------------- classification ---------------- */

  const ITEM_RE = /\/(assignment|quiz|assessment|discussion|page)\/(?:view\/)?(\d+)/;

  function classify(href) {
    const m = href?.match(ITEM_RE);
    if (!m) return null;
    const kind = m[1] === "quiz" ? "assessment" : m[1];
    return { kind, id: m[2] };
  }

  /**
   * Quizzes and assessments run a server-side timer and attempt state; Drive
   * assignments hand off through an OAuth flow. Neither can be replayed as a
   * plain form POST, so they're marked for the overlay path instead.
   */
  function submitModeFor(kind, text) {
    if (kind !== "assignment") return "overlay";
    if (/google drive|onedrive|drive assignment/i.test(text ?? "")) return "overlay";
    return "native";
  }

  function dueOffset(text, now = new Date()) {
    if (!text) return null;
    const overdue = text.match(/(\d+)\s+days?\s+overdue/i);
    if (overdue) return -Number(overdue[1]);

    const value = text
      .replace(/^\s*this was due on\s*/i, "")
      .replace(/^\s*due\s*/i, "")
      .trim();
    if (/^(?:earlier\s+)?today\b/i.test(value)) return 0;
    if (/^tomorrow\b/i.test(value)) return 1;
    if (/^yesterday\b/i.test(value)) return -1;

    const weekday = value.match(
      /^(next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:sday)?|wed(?:nesday)?|thu(?:rsday)?|fri(?:day)?|sat(?:urday)?)(?:\s+at\b.*)?$/i
    );
    if (weekday) {
      const names = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
      const target = names.findIndex((name) => weekday[2].toLowerCase().startsWith(name));
      const upcoming = (target - now.getDay() + 7) % 7;
      return weekday[1] ? upcoming + 7 : upcoming;
    }

    const cleaned = value
      .replace(/^(sun|mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?)(day)?,?\s*/i, "")
      .replace(/\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*$/i, "")
      .trim();
    const years = /\b\d{4}\b/.test(cleaned)
      ? [cleaned]
      : [cleaned, `${cleaned} ${now.getFullYear()}`, `${cleaned} ${now.getFullYear() + 1}`];

    for (const candidate of years) {
      const ms = Date.parse(candidate);
      if (Number.isNaN(ms)) continue;
      const due = new Date(ms);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(due.getFullYear(), due.getMonth(), due.getDate());
      const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
      if (days >= -30 && days <= 365) return days;
    }
    return null;
  }

  /* ---------------- scraping ---------------- */

  const DUE_TEXT_RE =
    /(?:This was due on|Due)\s+(?:[A-Za-z]+,?\s+)?[A-Za-z]+\s+\d{1,2}(?:,?\s+\d{4})?(?:\s+at\s+\d{1,2}(?::\d{2})?\s*[ap]m)?|(?:This was due on|Due)\s+(?:today|tomorrow|yesterday|earlier today|next\s+[A-Za-z]+|[A-Za-z]+)(?:\s+at\s+\d{1,2}(?::\d{2})?\s*[ap]m)?|\d+\s+days?\s+overdue/i;

  function itemContainer(anchor) {
    let fallback = anchor.closest("li, tr, [role=row], .upcoming-item, .material-row");
    let node = anchor.parentElement;
    for (let depth = 0; depth < 7 && node; depth++, node = node.parentElement) {
      const text = node.textContent.replace(/\s+/g, " ").trim();
      const links = node.querySelectorAll(
        'a[href*="/assignment/"], a[href*="/quiz/"], a[href*="/assessment/"], a[href*="/discussion/"]'
      ).length;
      if ((DUE_TEXT_RE.test(text) || node.querySelector("time, [class*=due]")) && links <= 2) {
        return node;
      }
      if (!fallback && /^(LI|TR)$/.test(node.tagName)) fallback = node;
    }
    return fallback ?? anchor.parentElement;
  }

  function dueText(container) {
    if (!container) return "";
    const candidates = [];
    const semantic = [
      ...container.querySelectorAll("time, .due-date, .upcoming-time, [class*=due-date]"),
    ];

    for (const element of semantic) {
      const own = (element.getAttribute("datetime") || element.textContent)
        .replace(/\s+/g, " ")
        .trim();
      if (own) candidates.push(own);

      const parent = element.parentElement?.textContent.replace(/\s+/g, " ").trim();
      if (parent && parent !== own) candidates.push(parent);

      const next = element.nextElementSibling?.textContent.replace(/\s+/g, " ").trim();
      if (next) candidates.push(`${own} ${next}`.trim());
    }

    const leaves = [...container.querySelectorAll("*")]
      .filter((element) => !element.querySelector("*"))
      .map((element) => element.textContent.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    for (let index = 0; index < leaves.length; index++) {
      candidates.push(leaves[index]);
      if (/^(?:due|this was due on)$/i.test(leaves[index]) && leaves[index + 1]) {
        candidates.push(`${leaves[index]} ${leaves[index + 1]}`);
      }
    }

    const blob = container.textContent.replace(/\s+/g, " ").trim();
    const matched = blob.match(DUE_TEXT_RE)?.[0]?.trim();
    if (matched) candidates.push(matched);

    // A bare "Due" label is not a date. Only return text that the same parser
    // used for bucketing can prove resolves to an actual day.
    return candidates.find((candidate) => dueOffset(candidate) !== null) ?? "";
  }

  async function getCourses() {
    const { text } = await sget("/courses");
    const doc = parse(text);
    const out = new Map();

    for (const a of doc.querySelectorAll('a[href*="/course/"]')) {
      const m = a.getAttribute("href")?.match(/\/course\/(\d+)/);
      const name = a.textContent.trim();
      if (!m || !name || out.has(m[1])) continue;
      out.set(m[1], { id: m[1], name, url: abs(a.getAttribute("href")) });
    }
    return [...out.values()];
  }

  async function getMaterials(sectionId) {
    const { text } = await sget(`/course/${sectionId}/materials`);
    const doc = parse(text);
    const seen = new Map();

    for (const a of doc.querySelectorAll("a[href]")) {
      const href = a.getAttribute("href");
      const hit = classify(href);
      if (!hit || seen.has(hit.id)) continue;
      if (hit.kind === "page") continue;

      const title = a.textContent.trim();
      if (!title) continue;

      // Scope metadata to this item's row; a generic parent div can contain
      // several siblings and was previously copying one due date onto all of them.
      const row = itemContainer(a);
      const rowText = row?.textContent.replace(/\s+/g, " ").trim() ?? "";
      const due = dueText(row);

      seen.set(hit.id, {
        id: hit.id,
        courseId: sectionId,
        kind: hit.kind,
        submit: submitModeFor(hit.kind, rowText),
        title,
        due,
        url: abs(href),
      });
    }
    return [...seen.values()];
  }

  /**
   * The home page's "To Do / Upcoming" panel is the highest-signal source on
   * Schoology: title, full due date, and course name for every open item, in
   * one request. Per-course materials pages list everything ever posted with
   * far weaker due-date markup, so this drives the board and materials only
   * fills gaps.
   *
   * Parsed structurally — walk up from each item link to the nearest ancestor
   * whose text contains "Due", then pull the pieces out of that blob — because
   * the panel's class names differ across Schoology skins.
   */
  /**
   * Wait for an AJAX-populated list to fill in. Schoology's To Do panel ships
   * as empty `hidden` containers in the HTML and is filled client-side, so a
   * plain fetch of /home returns a shell with zero items — this reads the LIVE
   * document instead, which is why the proxy runs as a content script.
   */
  function waitForList(selector, ms = 12000) {
    return new Promise((resolve) => {
      const hit = () => {
        const el = document.querySelector(selector);
        return el &&
          el.querySelector(
            'a[href*="/assignment/"], a[href*="/quiz/"], a[href*="/assessment/"], a[href*="/discussion/"]'
          )
          ? el
          : null;
      };
      const found = hit();
      if (found) return resolve(found);

      const obs = new MutationObserver(() => {
        const el = hit();
        if (el) {
          obs.disconnect();
          clearTimeout(timer);
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });

      const timer = setTimeout(() => {
        obs.disconnect();
        resolve(document.querySelector(selector)); // may be empty — caller copes
      }, ms);
    });
  }

  /* Selectors confirmed against a real fuhsd.schoology.com home page. */
  const TODO = {
    upcoming:
      "#todo .upcoming-submissions .upcoming-list, #todo .upcoming-submissions, #upcoming-submissions, [data-testid*=upcoming]",
    overdue:
      "#todo .overdue-submissions-list, #todo .overdue-submissions, #overdue-submissions, [data-testid*=overdue]",
    completed:
      ".recently-completed-wrapper .recently-completed-list, .recently-completed-list, [data-testid*=completed]",
  };

  async function getUpcoming() {
    // Only meaningful on the home page, where the widget lives.
    if (!/^\/(home)?$/.test(location.pathname)) {
      throw err("WRONG_PAGE", "Proxy tab is not on /home.");
    }

    const [upcomingRoot, overdueRoot, completedRoot] = await Promise.all([
      waitForList(TODO.upcoming),
      waitForList(TODO.overdue, 4000),
      waitForList(TODO.completed, 4000),
    ]);

    const out = new Map();
    // Schoology's own i18n strings, from the page bundle:
    //   "Due %{date} at %{time}" · "Due Today" · "Due Tomorrow"
    //   "This was due on %{date} at %{time}" · "%{count} days overdue"
    function harvest(root, completed, skipRoot, requireDue = false) {
      if (!root) return;

      for (const a of root.querySelectorAll("a[href]")) {
        // When Upcoming isn't found we scan the whole body, which contains the
        // Completed section too — skip it explicitly rather than relying on
        // scan order.
        if (skipRoot?.contains(a)) continue;

        // An upcoming entry always wins over a completed one with the same id.
        const hit = classify(a.getAttribute("href"));
        if (!hit || hit.kind === "page") continue;
        if (out.has(hit.id) && !out.get(hit.id).completed) continue;

        const title = a.textContent.replace(/\s+/g, " ").trim();
        if (!title) continue;

        // Climb until we find the row that carries the due date. Matches
        // "overdue" too — an overdue row never says the bare word "due".
        const container = itemContainer(a);
        if (!container) continue;

        const blob = container.textContent.replace(/\s+/g, " ").trim();
        const rowCompleted =
          completed ||
          !!container.closest("[class*=completed], [id*=completed], [data-testid*=completed]") ||
          /\b(submitted|turned in|completed)\b/i.test(blob);

        // Schoology puts the due date and course label in their own elements.
        // Read those directly — slicing the flattened blob with a regex cuts
        // through timestamps ("8:30 am" leaves a stray "30 am" on the front of
        // the course name), because the pieces have no reliable delimiter.
        const cells = [...container.querySelectorAll("*")]
          .filter((e) => !e.querySelector("*")) // leaf nodes only
          .map((e) => e.textContent.replace(/\s+/g, " ").trim())
          .filter(Boolean);

        const due = dueText(container);
        if (requireDue && !due) continue;

        const courseLink = container.querySelector('a[href*="/course/"]');
        const courseName =
          courseLink?.textContent.replace(/\s+/g, " ").trim() ??
          [...cells]
            .reverse()
            .find(
              (t) =>
                t !== title &&
                t !== due &&
                !DUE_TEXT_RE.test(t) &&
                t.length < 160 &&
                (/\s[-–—]\s*\d{2,}/.test(t) || /\b(period|class|course)\b/i.test(t))
            ) ??
          "";

        out.set(hit.id, {
          id: hit.id,
          kind: hit.kind,
          submit: submitModeFor(hit.kind, blob),
          title,
          due: due.trim(),
          courseName,
          completed: rowCompleted,
          url: abs(a.getAttribute("href")),
        });
      }
    }

    // Completed first, so a still-open duplicate overwrites it. The three
    // lists are separate containers, so no skip region is needed.
    harvest(completedRoot, true);
    harvest(overdueRoot, false);
    harvest(upcomingRoot, false);

    // District skins sometimes replace every known list class. Fall back to
    // the rendered To Do region and require an actual due string so unrelated
    // assignment links elsewhere on /home cannot pollute the board.
    if (![...out.values()].some((item) => !item.completed)) {
      const todoRoot =
        document.querySelector("#todo, [data-testid*=todo], [id*=todo], [class*=todo]") ??
        document.body;
      harvest(todoRoot, false, completedRoot, true);
    }

    return [...out.values()];
  }

  /** Match "AP Physics 1 - 3750" against "AP Physics 1 - 3750: AgarwalA p5 T1". */
  function matchCourse(courses, name) {
    if (!name) return null;
    const norm = (s) =>
      s
        .toLowerCase()
        .replace(/[:–—].*$/, "")
        .replace(/\s+/g, " ")
        .trim();
    const target = norm(name);
    return (
      courses.find((c) => norm(c.name) === target) ??
      courses.find((c) => norm(c.name).startsWith(target)) ??
      courses.find((c) => target.startsWith(norm(c.name))) ??
      null
    );
  }

  function submissionFacts(doc) {
    const revisions = new Set();
    for (const link of doc.querySelectorAll("a[href]")) {
      const match = link
        .getAttribute("href")
        ?.match(/(?:revision[_/-]?|\/submissions?\/(?:view\/)?)(\d+)/i);
      if (match) revisions.add(match[1]);
    }

    const statusText = [
      ...doc.querySelectorAll(
        ".submission-status, .submitted-date, .submission-details, .s-assignment-submission, [class*=submission-status], [data-testid*=submission]"
      ),
    ]
      .map((element) => element.textContent.replace(/\s+/g, " ").trim())
      .join(" ");
    const stamps = [
      ...doc.querySelectorAll(".submitted-date, .submission-status time, [class*=submitted] time"),
    ]
      .map((element) => element.getAttribute("datetime") || element.textContent.trim())
      .filter(Boolean);
    const actionText = [
      ...doc.querySelectorAll(
        'a[href*="/submit"], a[href*="/attempt"], button, input[type=submit]'
      ),
    ]
      .map((element) => element.textContent || element.getAttribute("value") || "")
      .join(" ");
    const completed =
      revisions.size > 0 ||
      /\b(submitted|turned in|completed|graded)\b/i.test(statusText);
    const open =
      !completed &&
      (/\b(not submitted|not turned in|submit assignment|start attempt|take quiz|begin|reply)\b/i.test(
        `${statusText} ${actionText}`
      ) ||
        !!doc.querySelector(
          'form#s-submission-form, form[enctype*="multipart"], a[href*="/assignment/"][href*="/submit"]'
        ));

    return {
      count: revisions.size,
      revisions: [...revisions],
      stamps,
      completed,
      completion: completed ? "completed" : open ? "open" : "unknown",
      submittedAt: stamps.at(-1) ?? null,
    };
  }

  function descriptionFrom(doc) {
    const element =
      doc.querySelector(
        ".s-assignment-description, .assignment-description, [data-testid*=description], .description .content"
      ) ?? doc.querySelector("article .content, main .content");
    return element?.textContent.replace(/\s+/g, " ").trim().slice(0, 4_000) ?? "";
  }

  async function inspectSubmitForm(href) {
    const url = new URL(href, ORIGIN);
    const { text } = await sget(`${url.pathname}${url.search}`);
    const doc = parse(text);
    const form =
      doc.querySelector('form[enctype*="multipart"]') ??
      doc.querySelector("form#s-submission-form") ??
      [...doc.querySelectorAll("form")].find((candidate) =>
        candidate.querySelector("input[type=file], textarea")
      );
    if (!form) return null;

    const submissionTypes = [];
    if (form.querySelector("textarea")) submissionTypes.push("text");
    if (form.querySelector("input[type=file]")) submissionTypes.push("file");
    return submissionTypes.length ? submissionTypes : null;
  }

  async function getItemDetails(item) {
    const url = new URL(item.url, ORIGIN);
    const { text } = await sget(`${url.pathname}${url.search}`);
    const doc = parse(text);
    const facts = submissionFacts(doc);
    const pageText = doc.body?.textContent.replace(/\s+/g, " ").trim() ?? "";
    const pageDue = dueText(doc.body);

    let submit = "overlay";
    let submissionTypes = [];
    if (item.kind === "assignment" && !facts.completed) {
      const submitLink = [
        ...doc.querySelectorAll('a[href*="/submit"]'),
      ].find((link) => link.getAttribute("href")?.includes(`/assignment/${item.id}`));
      if (submitLink && !/google drive|onedrive|external tool|launch app/i.test(pageText)) {
        try {
          const verified = await inspectSubmitForm(submitLink.getAttribute("href"));
          if (verified) {
            submit = "native";
            submissionTypes = verified;
          }
        } catch (error) {
          if (error.code === "SESSION_EXPIRED") throw error;
          // If the real form cannot be verified, use Schoology's own screen.
        }
      }
    }

    return {
      brief: descriptionFrom(doc),
      due: item.due || pageDue,
      completed: facts.completed,
      completion: facts.completion,
      submittedAt: facts.submittedAt,
      submit,
      submissionTypes,
    };
  }

  async function mapLimit(items, limit, fn) {
    const results = new Array(items.length);
    let next = 0;
    async function worker() {
      while (next < items.length) {
        const index = next++;
        results[index] = await fn(items[index], index);
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(limit, items.length) }, () => worker())
    );
    return results;
  }

  async function getGrades(sectionId) {
    const { text } = await sget(`/course/${sectionId}/student_grades`);
    const doc = parse(text);
    const categories = [];

    for (const row of doc.querySelectorAll("tr")) {
      const cells = [...row.querySelectorAll("td, th")].map((c) =>
        c.textContent.replace(/\s+/g, " ").trim()
      );
      if (cells.length < 2) continue;

      const weight = cells.join(" ").match(/(\d+(?:\.\d+)?)\s*%/)?.[1];
      const points = cells.join(" ").match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
      if (!weight && !points) continue;

      categories.push({
        cat: cells[0] || "Category",
        weight: weight ? parseFloat(weight) : 0,
        earned: points ? parseFloat(points[1]) : 0,
        possible: points ? parseFloat(points[2]) : 0,
        items: [],
      });
    }
    return categories;
  }

  async function sync() {
    const courses = await getCourses();
    const gradebook = {};
    const byId = new Map();
    const stats = {
      courses: courses.length,
      upcoming: 0,
      completed: 0,
      materials: 0,
      unmatched: 0,
    };

    // 1. Upcoming panel first — it carries real due dates, so it wins on conflict.
    const upcoming = await getUpcoming();
    stats.upcoming = upcoming.filter((i) => !i.completed).length;
    stats.completed = upcoming.filter((i) => i.completed).length;

    for (const item of upcoming) {
      let course = matchCourse(courses, item.courseName);

      // Never drop a real assignment just because its course label didn't
      // match the course list — synthesize a course so it still shows up.
      if (!course && item.courseName) {
        course = { id: `x-${item.courseName}`, name: item.courseName, url: "#" };
        courses.push(course);
        stats.unmatched++;
      }
      if (!course) {
        course = courses.find((candidate) => candidate.id === "x-unknown");
        if (!course) {
          course = { id: "x-unknown", name: "Schoology", url: "#" };
          courses.push(course);
        }
        stats.unmatched++;
      }

      byId.set(item.id, {
        id: item.id,
        courseId: course.id,
        kind: item.kind,
        submit: item.completed ? "overlay" : item.submit,
        title: item.title,
        due: item.due,
        completed: item.completed,
        url: item.url,
      });
    }

    // 2. Materials are a safety net for current/future dated work only.
    // Schoology materials pages contain years of history and no reliable
    // completion flag, so blindly merging them was the main stale-work bug.
    for (const c of courses) {
      if (String(c.id).startsWith("x-")) continue; // synthetic, has no materials page
      try {
        for (const m of await getMaterials(c.id)) {
          if (byId.has(m.id)) continue;
          const offset = dueOffset(m.due);
          if (offset === null || offset < 0 || offset > 60) continue;
          stats.materials++;
          byId.set(m.id, { ...m, source: "materials" });
        }
      } catch (e) {
        if (e.code === "SESSION_EXPIRED") throw e;
      }
      try {
        gradebook[c.id] = await getGrades(c.id);
      } catch (e) {
        if (e.code === "SESSION_EXPIRED") throw e;
        gradebook[c.id] = [];
      }
    }

    // 3. Read each open assignment's own page. This supplies the real
    // description for AI estimates, verifies completed/submitted state, and
    // only enables an in-portal submit UI when the genuine form was inspected.
    const openItems = [...byId.values()].filter((item) => !item.completed);
    await mapLimit(openItems, 4, async (item) => {
      try {
        const details = await getItemDetails(item);
        if (item.source === "materials" && details.completion !== "open") {
          byId.delete(item.id);
          return;
        }
        byId.set(item.id, { ...item, ...details });
      } catch (e) {
        if (e.code === "SESSION_EXPIRED") throw e;
        if (item.source === "materials") {
          byId.delete(item.id);
          return;
        }
        byId.set(item.id, { ...item, submit: "overlay", submissionTypes: [] });
      }
    });

    return {
      domain: location.host,
      courses,
      assignments: [...byId.values()],
      gradebook,
      history: {},
      messages: [],
      stats,
      syncedAt: Date.now(),
    };
  }

  /* ---------------- submission ---------------- */

  /** Rebuild a File from the portal's base64 payload. */
  function decodeFile({ name, type, data }) {
    const bin = atob(data);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new File([bytes], name, { type: type || "application/octet-stream" });
  }

  /**
   * Read the current submission state so a submit can be verified against it.
   * Revision links are the most reliable marker across skins.
   */
  async function submissionState(assignmentId) {
    const { text } = await sget(`/assignment/${assignmentId}`);
    const doc = parse(text);
    return submissionFacts(doc);
  }

  /**
   * Fetch the genuine submission form, clone every hidden field (Drupal CSRF
   * tokens included, by copying rather than naming them), attach the payload,
   * and POST to the form's own action. Then verify.
   */
  async function submit({ assignmentId, text: body, files, draft }) {
    const before = await submissionState(assignmentId);

    const { text: formHtml } = await sget(`/assignment/${assignmentId}/submit`);
    const doc = parse(formHtml);

    const form =
      doc.querySelector('form[enctype*="multipart"]') ??
      doc.querySelector("form#s-submission-form") ??
      [...doc.querySelectorAll("form")].find((f) => f.querySelector("input[type=file], textarea")) ??
      null;

    if (!form) {
      throw err(
        "NO_FORM",
        "No submission form on this assignment — it may be closed, or Drive-linked."
      );
    }

    const fd = new FormData();
    // Copy hidden inputs verbatim so this keeps working when Schoology renames
    // or adds a token field.
    for (const el of form.querySelectorAll("input[type=hidden]")) {
      if (el.name) fd.append(el.name, el.value);
    }
    for (const el of form.querySelectorAll("input[type=submit]")) {
      if (el.name) fd.append(el.name, el.value);
    }

    const textArea = form.querySelector("textarea");
    if (textArea?.name && typeof body === "string") fd.set(textArea.name, body);

    const fileInput = form.querySelector("input[type=file]");
    if (fileInput?.name && files?.length) {
      // Files arrive base64-encoded — extension messaging can't carry File
      // objects, so the portal encodes and we rebuild them here.
      for (const f of files) fd.append(fileInput.name, decodeFile(f), f.name);
    }

    if (draft) fd.append("draft", "1");

    const action = new URL(form.getAttribute("action") || location.pathname, ORIGIN);
    const res = await fetch(action, {
      method: "POST",
      body: fd,
      credentials: "include",
      headers: { referer: `${ORIGIN}/assignment/${assignmentId}/submit` },
    });

    const responseText = await res.text();
    if (looksLikeLogin(responseText)) throw err("SESSION_EXPIRED", "Session expired mid-submit.");

    // A 200 here proves nothing: Drupal re-renders the form with inline
    // validation errors under a 200. Confirm a new revision actually exists.
    const after = await submissionState(assignmentId);
    if (after.count <= before.count) {
      const inlineError = parse(responseText)
        .querySelector(".messages.error, .error, [role=alert]")
        ?.textContent.replace(/\s+/g, " ")
        .trim();
      throw err(
        "NOT_VERIFIED",
        inlineError
          ? `Schoology rejected the submission: ${inlineError}`
          : "Submission could not be verified — no new revision appeared."
      );
    }

    return {
      revision: after.count,
      submittedAt: new Date().toLocaleString([], {
        hour: "numeric",
        minute: "2-digit",
        month: "short",
        day: "numeric",
      }),
    };
  }

  async function comment({ assignmentId, text: body }) {
    const { text: html } = await sget(`/assignment/${assignmentId}`);
    const doc = parse(html);
    const form = [...doc.querySelectorAll("form")].find((f) =>
      /comment/i.test(f.getAttribute("action") ?? f.id ?? "")
    );
    if (!form) throw err("NO_COMMENT_FORM", "Comments aren't open on this assignment.");

    const fd = new FormData();
    for (const el of form.querySelectorAll("input[type=hidden]")) {
      if (el.name) fd.append(el.name, el.value);
    }
    const ta = form.querySelector("textarea");
    if (ta?.name) fd.set(ta.name, body);

    await fetch(new URL(form.getAttribute("action") || location.pathname, ORIGIN), {
      method: "POST",
      body: fd,
      credentials: "include",
    });

    return { time: new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) };
  }

  /* ---------------- overlay ---------------- */

  /**
   * Slates chrome rendered ON the real assessment page. The attempt, timer, and
   * submit button underneath are Schoology's — this only adds a tracker strip,
   * so nothing can desync and cost an attempt.
   */
  function mountOverlay({ id, kind }) {
    if (document.getElementById("slates-overlay")) return { mounted: true };

    const bar = document.createElement("div");
    bar.id = "slates-overlay";
    bar.setAttribute("role", "status");
    Object.assign(bar.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "2147483647",
      display: "flex",
      alignItems: "center",
      gap: "10px",
      padding: "10px 14px",
      borderRadius: "9999px",
      border: "1px solid rgba(255,255,255,0.08)",
      background: "oklch(0.301 0 0)",
      color: "oklch(0.907 0 0)",
      font: '13px ui-rounded, "SF Pro Rounded", system-ui, sans-serif',
      boxShadow: "0 8px 28px rgba(0,0,0,0.35)",
    });

    const dot = document.createElement("span");
    Object.assign(dot.style, {
      width: "8px",
      height: "8px",
      borderRadius: "9999px",
      background: "oklch(0.72 0.14 250)",
    });

    const label = document.createElement("span");
    label.textContent = kind === "drive" ? "Slates · tracking doc" : "Slates · tracking attempt";

    const clock = document.createElement("span");
    clock.style.fontVariantNumeric = "tabular-nums";
    clock.style.opacity = "0.75";
    clock.textContent = "0:00";

    bar.append(dot, label, clock);
    document.body.appendChild(bar);

    const started = Date.now();
    setInterval(() => {
      const s = Math.floor((Date.now() - started) / 1000);
      clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    }, 1000);

    return { mounted: true, id };
  }

  /* ---------------- rpc ---------------- */

  const methods = {
    /** Cheap liveness + version probe used to detect a stale injection. */
    probe: async () => ({ build: BUILD, path: location.pathname }),
    sync,
    submit,
    comment,
    mountOverlay,
    unsubmit: async ({ assignmentId }) => {
      // Schoology has no generic unsubmit; surface that rather than pretending.
      throw err(
        "NO_UNSUBMIT",
        `Schoology doesn't support unsubmitting here — open /assignment/${assignmentId} to delete the revision.`
      );
    },
    /** Escape hatch: capture live HTML so selectors can be tuned to a district. */
    dumpPage: async ({ path }) => {
      const { text } = await sget(path);
      return { path, length: text.length, html: text.slice(0, 200_000) };
    },
  };

  // Outside an extension (test harness), expose the methods instead of
  // registering a listener. Content scripts run in an isolated world, so this
  // is not reachable from the page even when it does run in the extension.
  if (typeof chrome === "undefined" || !chrome.runtime?.onMessage) {
    globalThis.__slatesProxy = methods;
    return;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.__slates !== 1) return false;

    const fn = methods[msg.method];
    if (!fn) {
      sendResponse({ ok: false, code: "UNKNOWN_METHOD", error: `No method ${msg.method}` });
      return false;
    }

    Promise.resolve(fn(msg.params ?? {}))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((e) =>
        sendResponse({ ok: false, code: e.code ?? "ERROR", error: e.message ?? String(e) })
      );

    return true; // async
  });
})();
