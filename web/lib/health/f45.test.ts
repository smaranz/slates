import assert from "node:assert/strict";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The studio's schedule as F45's booking API sends it, trimmed to what the
// room reads. F45 itself is never called: the fetcher is swapped, and the
// studio page fetch fails, as it would offline.

process.env.HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-health-f45-"));
globalThis.fetch = (async () => {
  throw new Error("offline");
}) as typeof fetch;

const load = import("./f45");

const klass = (id: number, date: string, start: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  description: `<div>${name} is a session&mdash;with a twist. You&rsquo;ll love it.</div>`,
  datetime_start: `${date} ${start}:00`,
  datetime_end: `${date} ${start.slice(0, 2)}:45:00`,
  duration: 45,
  size: 27,
  booked: 5,
  status: "active",
  assistants: ["San Maung", ""],
  trainers_name: "Kelsey Sparr",
  workout_type: "Hybrid",
  ...extra,
});

const BODY = {
  success: true,
  data: {
    schedule: [
      {
        program: { name: "Triple Double", media_logo_small: "https://f45tv.s3.amazonaws.com/class-logos/TD.png" },
        workout_type: "Cardio",
        date_start: "2026-10-07",
        classes: [klass(3, "2026-10-07", "16:30", "HYROX Signature Skill 6", { description: "" }), klass(2, "2026-10-07", "06:00", "HYROX Signature Skill 6")],
      },
      {
        program: { name: "Abacus", media_logo_small: "https://f45tv.s3.amazonaws.com/class-logos/Abacus100.png" },
        workout_type: "Hybrid",
        date_start: "2026-10-05",
        classes: [klass(5, "2026-10-05", "07:00", "Abacus"), klass(4, "2026-10-05", "06:00", "Abacus", { status: "closed_for_booking" })],
      },
      { program: { name: "Lonestar", media_logo_small: "" }, workout_type: "Resistance", date_start: "2026-10-04", classes: [] },
    ],
  },
};

test("HTML descriptions come out as plain text", async () => {
  const { plainText } = await load;
  assert.equal(plainText("<div>Phoenix is a renewing full-body strength session&mdash;designed to help you rise.</div>"), "Phoenix is a renewing full-body strength session—designed to help you rise.");
  assert.equal(plainText("You&rsquo;ll &amp; we&#39;ll<br/>go"), "You’ll & we'll go");
});

test("a studio page's embedded record gives the studio id and timezone", async () => {
  const { parseStudioPage } = await load;
  const html = `<script>\n        const FE_API_KEY = 'x';\n        const STUDIO_DATA = {"id":1670,"code":"615e","name":"F45 Cupertino","timezone":"America\\/Los_Angeles","address":"19700 Vallco Pkwy, Cupertino, CA 95014, USA","studio_meta":{"a":"};"}};\n        const STUDIO_API_URL = 'https://studio.api.f45training.com';\n</script>`;
  assert.deepEqual(parseStudioPage(html, "cupertino"), {
    id: 1670,
    slug: "cupertino",
    name: "F45 Cupertino",
    address: "19700 Vallco Pkwy, Cupertino, CA 95014",
    timezone: "America/Los_Angeles",
    url: "https://f45training.com/studio/cupertino/",
  });
  assert.equal(parseStudioPage("<html></html>", "cupertino"), null);
});

test("the schedule reads as days in order, classes by time, the day's workout named", async () => {
  const { scheduleFrom } = await load;
  const days = scheduleFrom(BODY);
  assert.deepEqual(days.map((d) => d.date), ["2026-10-04", "2026-10-05", "2026-10-07"]);
  const abacus = days[1]!;
  assert.equal(abacus.workout, "Abacus");
  assert.equal(abacus.type, "Hybrid");
  assert.deepEqual(abacus.classes.map((c) => [c.start, c.status]), [["06:00", "closed_for_booking"], ["07:00", "active"]]);
  assert.deepEqual(abacus.classes[0]!.assistants, ["San Maung"]);
  assert.equal(abacus.description, "Abacus is a session—with a twist. You’ll love it.");
  // A studio can run HYROX skills in the slot; the day's workout is still Triple Double.
  assert.equal(days[2]!.workout, "Triple Double");
  assert.equal(days[2]!.classes[0]!.name, "HYROX Signature Skill 6");
  assert.equal(days[0]!.logo, null);
  assert.throws(() => scheduleFrom({ data: {} }), /can’t read/);
});

test("the studio's own day decides what today is", async () => {
  const { studioToday } = await load;
  assert.equal(studioToday("America/Los_Angeles", new Date("2026-10-05T03:00:00Z")), "2026-10-04");
  assert.equal(studioToday("America/Los_Angeles", new Date("2026-10-05T08:00:00Z")), "2026-10-05");
});

test("the schedule is asked for once, then served from memory, then from disk when F45 is down", async () => {
  const { f45Schedule, setScheduleFetch } = await load;
  const urls: string[] = [];
  setScheduleFetch(async (url) => {
    urls.push(url);
    return BODY;
  });
  const now = new Date("2026-10-04T18:00:00Z");
  const first = await f45Schedule("cupertino", now);
  assert.equal(first.studio.id, 1670);
  assert.equal(first.today, "2026-10-04");
  assert.match(urls[0]!, /from=2026-09-27&to=2026-10-11&studio_id=1670&service_category_code=training/);
  await f45Schedule("cupertino", new Date(now.getTime() + 60_000));
  assert.equal(urls.length, 1);

  setScheduleFetch(async () => {
    throw new Error("F45 answered 503.");
  });
  const later = await f45Schedule("cupertino", new Date(now.getTime() + 3600_000));
  assert.equal(later.stale, true);
  assert.equal(later.days.length, 3);
  setScheduleFetch(null);
});
