/**
 * Reply to a Schoology message thread for real.
 *
 * Same reasoning as submit.mjs: the reply is typed into Schoology's own form
 * in the authenticated browser rather than reconstructed as a POST. The form
 * carries per-session CSRF tokens, and a hand-rolled request would break the
 * first time a token name changed — silently, after the student thought their
 * teacher had been answered.
 *
 * Unlike the assignment dropbox, the reply box is a plain textarea with no
 * editor attached, so this stays short.
 */

/*
 * Scoped to the form, like the dropbox selectors, and for the same reason:
 * a Schoology page renders several Drupal forms that reuse element ids, and
 * `#edit-submit` unscoped is a coin flip between "Send" and whatever other
 * form got rendered first.
 */
const FORM = "form#privatemsg-new";
const REPLY = {
  form: FORM,
  body: `${FORM} textarea#edit-body`,
  send: `${FORM} input[type=submit]#edit-submit`,
};

/** Compose is the same Drupal form with a recipient picker in front of it. */
const COMPOSE = {
  form: FORM,
  recipient: `${FORM} #edit-recipient`,
  subject: `${FORM} input[name=subject]`,
  body: `${FORM} textarea#edit-body`,
  send: `${FORM} input[type=submit][name=op]`,
  /** The widget writes one of these per person picked. Nothing else does. */
  ids: `${FORM} input[name="ids[]"]`,
  suggestions: ".ac_results li",
};

/** Collapse whitespace so a comparison isn't defeated by re-wrapping. */
const norm = (s) => (s || "").replace(/\s+/g, " ").trim();

/**
 * Who you can message, straight from Schoology's own directory.
 *
 * Uses the context's cookies rather than a page, so typing a name doesn't
 * cost a page load per keystroke. Schoology answers `[{n,u,s,p}]` — name,
 * user id, school, photo — and an empty body when nothing matches.
 */
export async function searchRecipients(ctx, { domain, query }) {
  const q = (query ?? "").trim();
  if (!/^[\w.-]+\.schoology\.com$/.test(domain ?? "")) throw new Error("No Schoology domain configured.");
  if (q.length < 2) return [];

  const res = await ctx.request.get(
    `https://${domain}/messages/ajax/userlist?jq=${encodeURIComponent(q)}&limit=20`,
    { timeout: 20_000 }
  );
  if (!res.ok()) throw new Error(`Schoology's directory returned ${res.status()}.`);

  const text = (await res.text()).trim();
  if (!text) return [];
  let rows;
  try {
    rows = JSON.parse(text);
  } catch {
    // An HTML body here means the session lapsed and we were handed a login page.
    throw new Error("Schoology didn't return a user list — try re-syncing.");
  }
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r?.u && r?.n)
    .map((r) => ({ uid: String(r.u), name: String(r.n), school: String(r.s ?? ""), photo: String(r.p ?? "") }));
}

/**
 * Pick one person in Schoology's own recipient widget.
 *
 * The widget is what turns a name into the `ids[]` the form actually posts, so
 * it is driven rather than bypassed: injecting an id by hand would send to
 * whoever that number belongs to with nothing checking it was the person named
 * on screen. Suggestions are matched on name *and* school — the exact strings
 * the directory returned — so two teachers with one surname can't be confused.
 */
async function pickRecipient(page, person) {
  const field = page.locator(COMPOSE.recipient).first();
  const wanted = norm(`${person.name}${person.school}`);

  /*
   * What to type to make Schoology offer this person.
   *
   * Not simply their name: the directory matches on name parts, so a display
   * name like "Mr. Paris" finds nobody while "Paris" finds them immediately.
   * Each candidate is tried until the suggestion list actually contains the
   * person we're after — which is checked by full name *and* school, so a
   * loose search term can never resolve to the wrong person.
   */
  const words = person.name.split(/\s+/).filter((w) => w.replace(/\W/g, "").length > 1);
  const candidates = [...new Set([words[words.length - 1], person.name, words[0]].filter(Boolean))];

  let clicked = false;
  for (const query of candidates) {
    await field.click();
    await field.fill("");
    await field.type(query, { delay: 40 });
    await page.waitForSelector(COMPOSE.suggestions, { timeout: 8_000 }).catch(() => {});

    clicked = await page.evaluate(
      ({ selector, wanted }) => {
        const norm = (s) => (s || "").replace(/\s+/g, " ").trim();
        const item = [...document.querySelectorAll(selector)].find((li) => norm(li.textContent) === wanted);
        if (!item) return false;
        // jQuery's autocomplete commits on mouse events, not a bare click().
        for (const type of ["mouseover", "mousedown", "mouseup", "click"]) {
          item.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        }
        return true;
      },
      { selector: COMPOSE.suggestions, wanted }
    );
    if (clicked) break;
  }
  if (!clicked) throw new Error(`Schoology didn't offer ${person.name} as a recipient.`);

  // The widget is asynchronous; the id it writes is the only proof it took.
  await page
    .waitForFunction(
      ({ selector, uid }) => [...document.querySelectorAll(selector)].some((i) => i.value === uid),
      { selector: COMPOSE.ids, uid: person.uid },
      { timeout: 10_000 }
    )
    .catch(() => {
      throw new Error(`Schoology didn't accept ${person.name} as a recipient.`);
    });
}

/**
 * Start a new conversation.
 *
 * `recipients` are `{ uid, name, school }` exactly as `searchRecipients`
 * returned them — Slates never invents a user id, it only passes back one
 * Schoology gave it.
 */
export async function composeMessage(
  ctx,
  { domain, recipients = [], subject, body },
  onStep = () => {}
) {
  const text = (body ?? "").trim();
  const title = (subject ?? "").trim();
  if (!recipients.length) throw new Error("Pick someone to send this to.");
  if (!title) throw new Error("Add a subject.");
  if (!text) throw new Error("Nothing to send.");
  if (!/^[\w.-]+\.schoology\.com$/.test(domain ?? "")) throw new Error("No Schoology domain configured.");
  if (!recipients.every((r) => /^\d+$/.test(String(r?.uid ?? "")) && r?.name)) {
    throw new Error("That recipient didn't come from Schoology's directory.");
  }

  const page = await ctx.newPage();
  const step = (id, label) => {
    try {
      onStep({ step: id, label });
    } catch {
      /* a listener that throws must not take the message down */
    }
  };

  try {
    step("open", "Opening a new message");
    await page.goto(`https://${domain}/messages/new`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    await page.waitForSelector(COMPOSE.recipient, { timeout: 20_000 }).catch(() => {
      throw new Error("Schoology's new-message form didn't open.");
    });

    for (const person of recipients) {
      step("recipient", `Addressing it to ${person.name}`);
      await pickRecipient(page, person);
    }

    step("write", "Filling in your message");
    await page.fill(COMPOSE.subject, title);
    await page.fill(COMPOSE.body, text);

    /*
     * Last check before it leaves: the form must be addressed to exactly the
     * people asked for. A stray id here means a message to a stranger, which
     * is not something a retry can take back.
     */
    const staged = await page.$$eval(COMPOSE.ids, (nodes) => nodes.map((n) => n.value).filter(Boolean));
    const wanted = recipients.map((r) => String(r.uid)).sort();
    if (staged.slice().sort().join(",") !== wanted.join(",")) {
      throw new Error(
        `Refusing to send: Schoology has this addressed to ${staged.length || "no one"}, not the ${wanted.length} picked.`
      );
    }

    step("send", "Sending it to Schoology");
    const button = page.locator(COMPOSE.send).first();
    const label = await button.evaluate((el) => el.value || el.textContent || "");
    if (!/send/i.test(label.trim())) {
      throw new Error(`Refusing to click "${label.trim()}" — expected "Send".`);
    }
    await button.click();

    step("verify", "Checking Schoology took it");
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    /*
     * A successful send leaves the compose form for the inbox. Still sitting on
     * /messages/new means Schoology rejected something and re-rendered with an
     * error, which is worth reading back rather than reporting as sent.
     */
    const landed = !/\/messages\/new/.test(page.url());
    const complaint = await page
      .evaluate(() => {
        const el = document.querySelector(".messages.error, .error, .messages--error");
        return el ? (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) : "";
      })
      .catch(() => "");

    return {
      ok: true,
      verified: landed && !complaint,
      to: recipients.map((r) => r.name),
      message:
        landed && !complaint
          ? `Sent to ${recipients.map((r) => r.name).join(", ")}.`
          : complaint || "Schoology stayed on the compose form — the message may not have gone.",
    };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * Refuse to click anything that isn't the button we meant — a mis-click here
 * either does nothing while Slates claims the reply was sent, or posts
 * somewhere the student never looked.
 */
async function clickSend(page) {
  const button = page.locator(REPLY.send).first();
  if ((await button.count()) === 0) {
    throw new Error("Schoology's Send button wasn't where expected.");
  }
  const label = await button.evaluate((el) => el.value || el.textContent || "");
  if (!/send/i.test(label.trim())) {
    throw new Error(`Refusing to click "${label.trim()}" — expected "Send".`);
  }
  await button.click();
}

/** Every post in the thread, oldest first, as plain text. */
function readThread() {
  return [...document.querySelectorAll(".s_message_box .message-body")].map((box) => {
    const clone = box.cloneNode(true);
    clone.querySelector(".name")?.remove();
    clone.querySelector(".s-message-attachments-container")?.remove();
    return (clone.innerText || clone.textContent || "").trim();
  });
}

/**
 * Post a reply to one thread.
 *
 * `onStep({ step, label })` fires as each stage begins, so the portal can show
 * what is actually happening — same contract as submitAssignment.
 */
export async function replyToThread(ctx, { domain, threadId, body }, onStep = () => {}) {
  const text = (body ?? "").trim();
  if (!text) throw new Error("Nothing to send.");
  if (!/^\d+$/.test(String(threadId ?? ""))) throw new Error("That isn't a message thread id.");
  if (!/^[\w.-]+\.schoology\.com$/.test(domain ?? "")) throw new Error("No Schoology domain configured.");

  const page = await ctx.newPage();
  const step = (id, label) => {
    try {
      onStep({ step: id, label });
    } catch {
      /* a listener that throws must not take the reply down */
    }
  };

  try {
    step("open", "Opening the conversation");
    await page.goto(`https://${domain}/messages/view/${threadId}`, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });

    const box = page.locator(REPLY.body).first();
    await box.waitFor({ state: "visible", timeout: 20_000 }).catch(() => {
      throw new Error("Schoology didn't show a reply box for this conversation.");
    });

    // How many posts were here before, so the new one can be told apart from a
    // thread that merely still contains the text we typed.
    const before = (await page.evaluate(readThread)).length;

    step("write", "Writing your reply");
    await box.fill(text);

    step("send", "Sending it to Schoology");
    await clickSend(page);

    step("verify", "Re-reading the conversation to confirm");
    // Schoology reloads the thread with the reply appended.
    await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
    await page
      .waitForFunction(
        (count) => document.querySelectorAll(".s_message_box .message-body").length > count,
        before,
        { timeout: 20_000 }
      )
      .catch(() => {});

    const posts = await page.evaluate(readThread);
    const landed = posts.length > before && norm(posts[posts.length - 1]).includes(norm(text));

    return {
      ok: true,
      verified: landed,
      posts: posts.length,
      message: landed
        ? "Schoology shows your reply in the conversation."
        : "Sent, but Schoology didn't show it back — open the conversation to check.",
    };
  } finally {
    await page.close().catch(() => {});
  }
}
