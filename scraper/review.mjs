/**
 * Per-question results for an assessment already handed in.
 *
 * Schoology shows a finished attempt as one number in the gradebook, and the
 * breakdown behind it only inside the player. It is reachable, though: the
 * player's own review view is driven by `edit-submission`, which answers with
 * a score and a maximum for every question in the attempt.
 *
 * The questions can't be fetched the same way — Schoology delivers those
 * through Learnosity, whose config references them only by opaque id against a
 * signed session. They can be *read*, though: opening Schoology's own review
 * view lets Learnosity render the attempt into the page, and what it paints
 * there — the prompt, the choices, and which one was picked — can be lifted
 * straight out of the DOM.
 *
 * Two sources, then, for two different reasons: the marks come from the API
 * because that is exact and cheap, and the questions come from the rendered
 * review because that is the only place they exist.
 *
 * Read-only throughout: it opens the assessment's landing page (the same page
 * a normal sync already visits), then follows the "View" action on an attempt
 * that is already finished. Nothing here starts, resumes, or touches a live
 * attempt, and nothing clicks anything but that one link.
 */
import { extractDetail } from "./scrape.mjs";

/*
 * Learnosity's own class names, which is deliberately what the DOM reading
 * below matches on. Schoology's markup around them is compiled with hashed
 * names (`_2nSV0`, `_3eD4l`) that change with every deploy, while the `lrn_`
 * names are Learnosity's theming surface and stay put.
 *
 * The values are the question kinds as a student would name them, and the map
 * doubles as the filter: a widget whose kind isn't here still reports its
 * prompt and answer, just without a label for what sort of question it was.
 */
const KINDS = {
  lrn_mcq: "Multiple choice",
  lrn_shorttext: "Short answer",
  lrn_longtextV2: "Written",
  lrn_plaintext: "Written",
  lrn_clozetext: "Fill in the blank",
  lrn_clozedropdown: "Fill in the blank",
  lrn_association: "Matching",
  lrn_orderlist: "Ordering",
  lrn_imageclozeassociation: "Label the diagram",
  lrn_formulaV2: "Formula",
};

/**
 * The questions of one finished attempt, read from Schoology's own review view.
 *
 * Answers null rather than throwing when the view can't be reached — a teacher
 * who released marks but not answers, a player that never mounted — because
 * marks alone are still worth showing and the caller already holds those.
 */
async function readRenderedQuestions(page, assessUrl, viewIndex) {
  await page.goto(assessUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });

  const hasView = () =>
    [...document.querySelectorAll("a,button")].some((el) => (el.textContent || "").trim() === "View");
  try {
    // Waiting for the link rather than for a guessed number of seconds: the
    // table is rendered by a bundle that loads whenever it loads.
    await page.waitForFunction(hasView, { timeout: 20_000 });
  } catch {
    return null;
  }

  /*
   * The attempts table renders one "View" per reviewable attempt, oldest first,
   * matching the order the submissions arrive in. Matching the exact label
   * matters: the same page carries the button that opens a *new* attempt, and
   * that must never be the thing this clicks.
   */
  const opened = await page.evaluate((i) => {
    const views = [...document.querySelectorAll("a,button")].filter(
      (el) => (el.textContent || "").trim() === "View"
    );
    views[i]?.click();
    return Boolean(views[i]);
  }, viewIndex);
  if (!opened) return null;

  try {
    // Schoology renders the shell first and Learnosity mounts into it after.
    await page.waitForSelector(".lrn_widget", { timeout: 20_000 });
  } catch {
    return null;
  }
  /*
   * The widgets mount before Learnosity fills them in. Waiting for the answers
   * themselves would hang on a question that was legitimately left blank, so
   * this waits for the count of them to stop growing instead.
   */
  await page
    .waitForFunction(
      () => {
        const now = document.querySelectorAll(".lrn_widget").length;
        const settled = window.__slatesWidgets === now;
        window.__slatesWidgets = now;
        return settled;
      },
      { timeout: 10_000, polling: 400 }
    )
    .catch(() => {});

  return page.evaluate((kinds) => {
    /** Learnosity repeats every label for screen readers; keep that out. */
    const clean = (el) => {
      if (!el) return "";
      const copy = el.cloneNode(true);
      copy.querySelectorAll(".sr-only, .lrn-accessibility-arialive").forEach((n) => n.remove());
      return (copy.textContent || "").replace(/\s+/g, " ").trim();
    };

    return [...document.querySelectorAll(".lrn_widget")].map((w) => {
      const options = [...w.querySelectorAll(".lrn-mcq-option")].map((li) => ({
        label: clean(li.querySelector(".lrn_contentWrapper")) || clean(li),
        // The inputs are disabled in review but still carry what was submitted.
        chosen: Boolean(li.querySelector("input:checked")) || li.classList.contains("lrn_selected"),
      }));
      return {
        /*
         * Whatever the question actually asked. Often the real prompt; on a
         * quiz built as an answer sheet for a paper worksheet it is as short as
         * "Q1", because that is all the teacher typed in.
         */
        stem: clean(w.querySelector(".lrn_stimulus_content")),
        kind: kinds[[...w.classList].find((c) => c in kinds)] ?? "",
        options,
        /** Anything that wasn't a set of choices, as it was submitted. */
        written: options.length ? "" : clean(w.querySelector(".lrn_response")),
      };
    });
  }, KINDS);
}

/** Ask Schoology, from inside the authenticated page, how one attempt scored. */
async function readAttempt(page, submissionId) {
  const body = await page.evaluate(async (id) => {
    const res = await fetch(`/iapi2/common-assessments/edit-submission/${id}`, {
      credentials: "include",
      headers: { accept: "application/json" },
    });
    // A teacher who has hidden results, or a submission that isn't ours, answers
    // with Schoology's HTML error page rather than JSON.
    if (!res.ok) return { error: `Schoology answered ${res.status}` };
    try {
      return { data: await res.json() };
    } catch {
      return { error: "Schoology didn't return results for this attempt." };
    }
  }, submissionId);

  if (body.error) throw new Error(body.error);

  const data = body.data?.data ?? {};
  const responses = data.assessment?.component_responses ?? [];

  const questions = responses.map((r, i) => {
    const max = Number(r.max_score) || 0;
    const score = Number(r.score) || 0;
    return {
      n: i + 1,
      earned: score,
      possible: max,
      /*
       * Kept as a state rather than a boolean: "not correct" and "not marked
       * yet" look identical in the numbers, and a written answer a teacher
       * hasn't read is not a wrong answer.
       *
       * `subjective` is Schoology's flag for a question only a human can mark;
       * `is_invalidated` is a question the teacher threw out for everyone,
       * which counts for nobody and shouldn't read as a loss.
       */
      state: r.is_invalidated
        ? "dropped"
        : r.subjective && r.score === null
          ? "pending"
          : max > 0 && score >= max
            ? "correct"
            : score > 0
              ? "partial"
              : "missed",
      /** Marked by hand, so a zero here can simply mean "not read yet". */
      byHand: r.subjective === true,
    };
  });

  const live = questions.filter((q) => q.state !== "dropped");
  return {
    submissionId: String(submissionId),
    questions,
    earned: live.reduce((sum, q) => sum + q.earned, 0),
    possible: live.reduce((sum, q) => sum + q.possible, 0),
    // Schoology's own count, which includes anything it threw out.
    questionsTotal: Number(data.meta?.questions_total) || questions.length,
  };
}

/**
 * Everything Slates can show about an assessment's finished attempts.
 *
 * `url` is any Schoology link to the item — a gradebook row's `/assignment/<id>`
 * redirects to the player's own page, so both shapes land in the same place.
 * Items that aren't online assessments at all (a paper quiz scored by hand, a
 * file dropbox) carry no player config, and are reported as such rather than as
 * a failure.
 */
export async function readReview(ctx, url) {
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    // The player's config is written by the same late-rendering bundle the
    // regular detail scrape waits on.
    await page.waitForTimeout(1200);

    const detail = await page.evaluate(extractDetail);
    const info = detail?.assessment;
    if (!info) {
      return { online: false, title: detail?.title ?? "", attempts: [] };
    }

    /*
     * Where the attempts table lives. A gradebook link redirects to it, so this
     * is read back off the page rather than reusing the url that was asked for.
     */
    const assessUrl = page.url();

    const attempts = [];
    for (const a of info.attempts ?? []) {
      // An attempt still in progress has nothing to review, and asking about it
      // would mean touching a live submission.
      if (!a.completed) {
        attempts.push({ ...a, questions: [], error: "Still in progress." });
        continue;
      }
      if (!a.reviewable) {
        attempts.push({ ...a, questions: [], error: "Your teacher hasn't released the results." });
        continue;
      }
      try {
        attempts.push({ ...a, ...(await readAttempt(page, a.submissionId)) });
      } catch (e) {
        attempts.push({ ...a, questions: [], error: e.message });
      }
    }

    /*
     * Then the questions, in a second pass, because reading them navigates away
     * from the attempts table that the marks were fetched against.
     *
     * The "View" links are counted the same way Schoology renders them — one
     * per attempt that came back with marks, in order — so the click lands on
     * the row being described rather than on whichever row happens to be first.
     */
    let viewIndex = 0;
    for (const a of attempts) {
      if (!a.questions?.length) continue;
      const at = viewIndex++;
      try {
        const rendered = await readRenderedQuestions(page, assessUrl, at);
        if (!rendered) continue;
        // Position is the only join between the two sources, and it holds
        // because both come from the same ordered list of components.
        a.questions = a.questions.map((q, i) => ({ ...q, ...(rendered[i] ?? {}) }));
      } catch (e) {
        // Marks without questions is a worse answer, not a failed one.
        console.error("review render failed:", e.message);
      }
    }

    return {
      online: true,
      title: detail.title ?? "",
      /** Schoology's gradebook total, for the attempt scores to sit against. */
      pointsPossible: detail.points ?? null,
      timeLimitMin: info.timeLimitMin ?? null,
      attempts,
    };
  } finally {
    await page.close().catch(() => {});
  }
}
