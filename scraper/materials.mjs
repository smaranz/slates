/**
 * A course's Materials, the way Schoology actually files them.
 *
 * The board and the grades screen both flatten a class into a list of things
 * that are due. That is not what a class is: it's folders, units, weeks,
 * lecture PDFs, links and pages, most of which are never "due" at all. This
 * reads that tree so Slates can show the same shelf the teacher built.
 *
 * Rows are `<tr class="dr type-assignment">` in a table — folders carry
 * `material-row-folder` instead of a `type-` class. The visible row text
 * begins with a screen-reader label ("Assignment.", "Adobe PDF") which is
 * stripped here rather than shown to anyone.
 */

/*
 * No leading \b: Schoology runs the size straight onto the filename
 * ("...more.pdf2 MB"), and a word boundary can't fall between "f" and "2",
 * so the size went unmatched and ended up in the description instead.
 */
const SIZE = /\d+(?:\.\d+)?\s?(?:B|KB|MB|GB)\b/i;
/*
 * The accessibility labels Schoology stacks in front of every row's text.
 *
 * Kind labels always end in a full stop, and the period is required here on
 * purpose: without it, "Page 15: # 1 - 8" — a real description — had its
 * first word eaten. File-type labels carry no period, so they're their own
 * pattern.
 */
const KIND_LABEL =
  /^\s*(?:(?:Expand|Collapse) folder|Folder|Assignment|Common Assessment|Assessment|Page|Link|Document|Discussion|Test\/Quiz)\s*\.\s*/i;
const FILE_LABEL = /^\s*(?:Adobe PDF|Microsoft (?:Word|PowerPoint|Excel)|Image|Video|Audio|File)\s+/i;
/*
 * "Due Monday, August 24" is a deadline; "due to RALLY" is a sentence. The
 * lookahead is what keeps a page titled "No Tutorial ... due to RALLY" from
 * being read as work with a due date.
 */
const DUE = /\bDue\s+(?!to\b)[A-Z0-9][^·]*/;

/** Runs in page context: one level of the materials tree. */
function extractMaterials() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();

  return [...document.querySelectorAll("tr.dr")]
    .map((row) => {
      const link = row.querySelector("a[href]");
      if (!link) return null;

      const cls = (row.className || "").toString();
      const kind = cls.includes("material-row-folder")
        ? "folder"
        : (cls.match(/type-([a-z-]+)/) || [])[1] || "other";

      /*
       * The anchor carries three things at once: the display title, a
       * screen-reader label naming the kind ("Assignment."), and — on files —
       * a tooltip holding the underlying filename. Reading it whole produced
       * titles like "W1B1_ConstantVel_BuggyLabW1B1_ConstantVel.pdf", so the
       * extras come out first and the filename is kept separately.
       */
      const clone = link.cloneNode(true);
      clone.querySelectorAll(".visually-hidden, .infotip-content").forEach((el) => el.remove());
      const title = clean(clone.textContent);
      const filename = link.querySelector(".infotip[aria-label]")?.getAttribute("aria-label") || "";

      const rowText = clean(row.innerText);
      return {
        // Schoology calls a shared quiz a "common-assessment"; to a student
        // it is the same thing as any other assessment.
        kind: kind === "common-assessment" ? "assessment" : kind,
        title: title || clean(link.textContent),
        filename,
        href: link.getAttribute("href") || "",
        rowText,
      };
    })
    .filter((item) => item && item.href && item.title);
}

/** Where a folder sits, so the UI can offer a way back up. */
function extractTrail() {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const up = document.querySelector('a[href*="/materials"] .icon-up, a.up-link');
  return {
    // Schoology renders a plain "Up" link inside a folder.
    up:
      [...document.querySelectorAll("a[href]")]
        .filter((a) => clean(a.textContent) === "Up")
        .map((a) => a.getAttribute("href"))[0] || null,
    hasUp: Boolean(up),
  };
}

/**
 * One level of a course's materials.
 *
 * `folderId` omitted reads the course root. Every href is returned exactly as
 * Schoology gave it, so the caller never has to reconstruct a URL — and the
 * portal can hand any of them straight back for the next level.
 */
export async function readMaterials(ctx, { domain, courseId, folderId = null }) {
  if (!/^[\w.-]+\.schoology\.com$/.test(domain ?? "")) throw new Error("No Schoology domain configured.");
  if (!/^\d+$/.test(String(courseId ?? ""))) throw new Error("That isn't a course id.");
  if (folderId != null && !/^\d+$/.test(String(folderId))) throw new Error("That isn't a folder id.");

  const url = folderId
    ? `https://${domain}/course/${courseId}/materials?f=${folderId}`
    : `https://${domain}/course/${courseId}/materials`;

  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    // The table is server-rendered, but the page still settles briefly.
    await page.waitForSelector("tr.dr", { timeout: 8_000 }).catch(() => {});

    const [rows, trail] = await Promise.all([
      page.evaluate(extractMaterials),
      page.evaluate(extractTrail),
    ]);

    const items = rows.map((row) => {
      const size = (row.rowText.match(SIZE) || [])[0] || "";
      const due = (row.rowText.match(DUE) || [])[0] || "";
      /*
       * Whatever's left of the row once the title and meta are out of the way
       * — usually the teacher's one-line description.
       *
       * Schoology opens each row with screen-reader labels ("Expand folder.
       * Folder.", "Assignment.", "Adobe PDF"), and they stack, so one pass
       * left rows reading "Expand folder. Folder." as their description.
       * Stripped repeatedly until the real text starts.
       */
      let note = row.rowText.replace(row.title, " ").replace(size, " ").replace(due, " ");
      for (let i = 0; i < 4; i++) {
        if (KIND_LABEL.test(note)) note = note.replace(KIND_LABEL, "");
        else if (FILE_LABEL.test(note)) note = note.replace(FILE_LABEL, "");
        else break;
      }
      note = note.replace(/\s+/g, " ").trim();

      return {
        kind: row.kind,
        title: row.title,
        filename: row.filename,
        url: row.href,
        /** Set only for folders — what to ask for to go one level deeper. */
        folderId: (row.href.match(/[?&]f=(\d+)/) || [])[1] ?? null,
        size,
        due,
        note: note.length > 160 ? `${note.slice(0, 159)}…` : note,
      };
    });

    return { items, up: trail.up };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Turn a document page into the file behind it.
 *
 * A Schoology document (`/course/<c>/materials/gp/<id>`) is a wrapper around
 * an attachment; the real bytes live at `/attachment/<id>/source/<hash>.<ext>`.
 * Slates needs that path to show a PDF inline instead of bouncing the student
 * out to a browser tab.
 */
export async function resolveDocument(ctx, { domain, path }) {
  if (!/^\/course\/\d+\/materials\/gp\/\d+$/.test(path ?? "")) {
    throw new Error("That isn't a Schoology document.");
  }

  const page = await ctx.newPage();
  try {
    await page.goto(`https://${domain}${path}`, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(1200);

    const found = await page.evaluate(() => {
      const source = [...document.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href") || "")
        .find((h) => /\/attachment\/\d+\/source\//.test(h));
      const viewer = document.querySelector('iframe[src*="/docviewer"]')?.getAttribute("src") || null;
      return { source: source || null, viewer };
    });

    if (!found.source) throw new Error("Schoology didn't expose a file for this item.");
    const name = decodeURIComponent(found.source.split("/").pop() || "file");
    return { file: found.source, viewer: found.viewer, name, ext: (name.split(".").pop() || "").toLowerCase() };
  } finally {
    await page.close().catch(() => {});
  }
}

/** Content types worth rendering in the app rather than handing to a browser. */
const INLINE = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain; charset=utf-8",
};

export function inlineTypeFor(ext) {
  return INLINE[(ext || "").toLowerCase()] ?? null;
}

/**
 * Fetch an attachment's bytes using the signed-in session.
 *
 * Goes through the browser context's own request client, so it carries the
 * same cookies as the pages we scrape — the portal has no Schoology session of
 * its own and could not fetch this itself.
 */
export async function fetchAttachment(ctx, { domain, path }) {
  if (!/^\/attachment\/\d+\/(source|docviewer)\b/.test(path ?? "")) {
    throw new Error("Only Schoology attachments can be fetched.");
  }
  const res = await ctx.request.get(`https://${domain}${path}`, { timeout: 60_000, maxRedirects: 5 });
  if (!res.ok()) throw new Error(`Schoology returned ${res.status()} for that file.`);
  return {
    body: await res.body(),
    contentType: res.headers()["content-type"] ?? "application/octet-stream",
  };
}
