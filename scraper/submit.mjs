import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Hand work in to Schoology for real.
 *
 * Slates used to mark things done locally and say so; nothing ever reached a
 * teacher. This drives Schoology's own dropbox in the authenticated browser
 * rather than reconstructing the POST by hand — the form carries per-session
 * CSRF tokens, and file uploads go through plupload, which fills a hidden field
 * asynchronously. Replaying that by hand would break the first time Schoology
 * changed a token name, and break silently, which is the worst way for a
 * submission to fail.
 *
 * Schoology's modal is two separate forms, one per tab, so a submission is
 * either a file upload or a typed response — not both. Typed text accompanying
 * files becomes the upload's comment, which is where Schoology puts it too.
 */
/*
 * Every selector below is scoped to its form on purpose.
 *
 * Schoology renders several Drupal forms on one assignment page and they reuse
 * element ids: the comment-reply form also contains `#edit-submit-1`, and the
 * post-comment form also contains `#edit-submit`. A bare id lookup returns
 * whichever comes first in the document — the comment button — so an unscoped
 * "submit" would post a comment and report the assignment as turned in.
 */
const FORM = {
  create: "#s-drop-item-submit-create-form",
  upload: "#s-drop-item-submit-upload-form",
};

const DROPBOX = {
  open: "a.dropbox-submit",
  createForm: FORM.create,
  createText: `${FORM.create} #edit-submission`,
  createSubmit: `${FORM.create} input[type=submit]#edit-submit-1`,
  createDraft: `${FORM.create} input[type=submit]#edit-draft`,
  uploadForm: FORM.upload,
  uploadComment: `${FORM.upload} #edit-drop-item-comment`,
  uploadFiles: `${FORM.upload} #edit-file-files`, // plupload writes file ids here
  uploadSubmit: `${FORM.upload} input[type=submit]#edit-submit`,
};

/**
 * Refuse to click anything that isn't the button we meant.
 *
 * The scoped selectors above should be enough, but a mis-click here posts a
 * comment or silently does nothing while Slates reports success — so the
 * button's own label is checked before it is pressed.
 */
async function clickButton(page, selector, expected) {
  const button = page.locator(selector).first();
  if ((await button.count()) === 0) {
    throw new Error(`Schoology's "${expected}" button wasn't where expected.`);
  }
  const label = await button.evaluate((el) => el.value || el.textContent || "");
  if (!new RegExp(expected, "i").test(label.trim())) {
    throw new Error(`Refusing to click "${label.trim()}" — expected "${expected}".`);
  }
  await button.evaluate((el) => el.click());
}

/** Write incoming base64 payloads to a temp dir Playwright can hand to Chrome. */
function stage(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "slates-upload-"));
  const paths = files.map((f) => {
    // Never let a supplied name escape the staging directory.
    const safe = path.basename(f.name || "upload").replace(/[/\\]/g, "_");
    const full = path.join(dir, safe);
    fs.writeFileSync(full, Buffer.from(f.data, "base64"));
    return full;
  });
  return { dir, paths };
}

async function openDropbox(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(1200);

  const opener = page.locator(DROPBOX.open).first();
  if ((await opener.count()) === 0) {
    throw new Error("This assignment has no submission box on Schoology.");
  }
  await opener.evaluate((el) => el.click());

  /*
   * The modal's forms are injected after the click, and only the active tab's
   * form has a box — the other one sits in the DOM at 0×0. Wait for them to
   * exist, not to be visible, or this hangs on whichever tab isn't showing.
   */
  await page.waitForSelector(`${DROPBOX.createForm}, ${DROPBOX.uploadForm}`, {
    state: "attached",
    timeout: 20_000,
  });
  await page.waitForSelector(".popups-box", { timeout: 10_000 }).catch(() => {});
  await page.waitForTimeout(800);
}

/**
 * Switch to a tab in the dropbox modal and prove its form is really showing.
 *
 * Filling a form that never came forward is the dangerous failure here: the
 * fields exist either way, so a missed tab click would quietly fill and submit
 * the wrong one. `form` must have a real box before anything is typed into it.
 */
async function openTab(page, label, form) {
  await page.evaluate((want) => {
    const hit = [...document.querySelectorAll("a, li, button")].find(
      (el) => (el.textContent || "").trim().toLowerCase() === want.toLowerCase()
    );
    hit?.click();
  }, label);

  await page
    .waitForFunction(
      (sel) => (document.querySelector(sel)?.getBoundingClientRect().height ?? 0) > 0,
      form,
      { timeout: 10_000 }
    )
    .catch(() => {
      throw new Error(`Schoology's "${label}" tab didn't open.`);
    });
  await page.waitForTimeout(400);
}

/**
 * Wait for the response field, then for TinyMCE to finish taking it over.
 *
 * The textarea is never visible on a normal assignment: Schoology swaps in a
 * TinyMCE iframe and leaves the original field behind `aria-hidden`. Waiting on
 * it to be *visible* — Playwright's default — therefore timed out every single
 * time, and every typed submission failed on a page that was working fine.
 *
 * Waiting for the editor itself is best effort. If TinyMCE never loads, the
 * textarea is still there and still submits.
 */
async function waitForEditor(page) {
  await page.waitForSelector(DROPBOX.createText, { state: "attached", timeout: 15_000 });
  await page
    .waitForFunction(
      () => {
        const tm = window.tinymce || window.tinyMCE;
        const editor = tm?.get?.("edit-submission");
        return !!editor?.initialized || !!document.querySelector("#edit-submission_ifr");
      },
      null,
      { timeout: 10_000 }
    )
    .catch(() => {});
}

/**
 * Put text into the submission editor.
 *
 * The visible field is a TinyMCE iframe, not the textarea — writing to the
 * textarea alone is discarded when TinyMCE syncs over it on submit. Drive the
 * editor and call save() so the textarea matches what the user sees.
 */
async function fillEditor(page, text) {
  const how = await page.evaluate(
    ({ sel, value }) => {
      const id = "edit-submission";
      const tm = window.tinymce || window.tinyMCE;
      const editor = tm?.get?.(id);
      const html = value
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, "<br>").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c])}</p>`)
        .join("");
      if (editor) {
        editor.setContent(html);
        editor.save(); // pushes the content back into the textarea
        return "tinymce";
      }
      const ta = document.querySelector(sel);
      if (ta) {
        ta.value = value;
        ta.dispatchEvent(new Event("input", { bubbles: true }));
        return "textarea";
      }
      return "none";
    },
    { sel: DROPBOX.createText, value: text }
  );
  if (how === "none") throw new Error("Couldn't find Schoology's response editor.");
  return how;
}

/** Did the page come back showing a submission? */
async function confirm(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  return page.evaluate(() => {
    const text = (document.body.innerText || "").replace(/\s+/g, " ");
    return {
      submitted:
        /submitted|submission received|re-?submit assignment|has been submitted/i.test(text) ||
        !!document.querySelector(".dropbox-resubmit, [class*='submission-item']"),
      error: (text.match(/[^.]*\b(error|failed|not accepted|too large)\b[^.]*/i) || [])[0] || "",
    };
  });
}

/**
 * Submit an assignment. `files` are `{ name, data }` with base64 `data`.
 * `draft: true` saves without handing in (typed responses only).
 *
 * `onStep({ step, label })` is called as each stage begins, so the portal can
 * show what is actually happening rather than a spinner over a black box. The
 * steps are emitted where the work starts, never optimistically.
 */
export async function submitAssignment(
  ctx,
  { url, text = "", files = [], draft = false },
  onStep = () => {}
) {
  if (!text.trim() && !files.length) throw new Error("Nothing to submit.");

  const page = await ctx.newPage();
  let staged = null;
  const step = (step, label) => {
    try {
      onStep({ step, label });
    } catch {
      /* a listener that throws must not take the submission down */
    }
  };

  try {
    step("open", "Opening Schoology's dropbox");
    await openDropbox(page, url);

    if (files.length) {
      await openTab(page, "Upload", DROPBOX.uploadForm);
      staged = stage(files);
      step("upload", files.length === 1 ? `Uploading ${files[0].name}` : `Uploading ${files.length} files`);

      const input = page.locator(`${DROPBOX.uploadForm} input[type=file]`).first();
      if ((await input.count()) === 0) throw new Error("Schoology's file picker didn't open.");
      await input.setInputFiles(staged.paths);

      /*
       * plupload uploads in the background and only then writes the file ids
       * into a hidden field. Submitting before that lands sends an empty
       * submission that looks successful.
       */
      await page
        .waitForFunction(
          (sel) => (document.querySelector(sel)?.value ?? "").length > 0,
          DROPBOX.uploadFiles,
          { timeout: 120_000 }
        )
        .catch(() => {
          throw new Error("The file didn't finish uploading to Schoology.");
        });

      if (text.trim()) {
        await page.fill(DROPBOX.uploadComment, text).catch(() => {});
      }
      step("send", "Handing it to Schoology");
      await clickButton(page, DROPBOX.uploadSubmit, "Submit");
    } else {
      await openTab(page, "Create", DROPBOX.createForm);
      step("editor", "Filling in your response");
      await waitForEditor(page);
      await fillEditor(page, text);
      step("send", draft ? "Saving the draft" : "Handing it to Schoology");
      await clickButton(
        page,
        draft ? DROPBOX.createDraft : DROPBOX.createSubmit,
        draft ? "Save Draft" : "Submit"
      );
    }

    step("verify", "Re-reading the assignment to confirm");
    const result = await confirm(page);
    return {
      ok: true,
      mode: files.length ? "upload" : draft ? "draft" : "create",
      verified: result.submitted,
      message: result.submitted
        ? "Schoology shows it as submitted."
        : result.error ||
          "Sent, but Schoology didn't confirm it — open the assignment to check.",
    };
  } finally {
    await page.close().catch(() => {});
    if (staged) fs.rmSync(staged.dir, { recursive: true, force: true });
  }
}
