import assert from "node:assert/strict";
import test from "node:test";

import type { Update } from "./types";
import { byDay, dayLabel, sourceKey, sourcesOf, unseenCount } from "./updates";

const now = new Date(2026, 8, 27, 10, 0, 0, 0);

function post(id: string, at: Date, courseId = "", realm = "CHS Hub: Gr10"): Update {
  return {
    id,
    courseId,
    realm,
    realmUrl: "",
    author: "Mrs. Jackson",
    at: at.getTime(),
    kind: "post",
    text: "",
    html: "",
    media: 0,
    attachments: [],
    comments: 0,
  };
}

test("days read the way a feed does", () => {
  assert.equal(dayLabel(new Date(2026, 8, 27, 8).getTime(), now), "Today");
  assert.equal(dayLabel(new Date(2026, 8, 26, 23, 59).getTime(), now), "Yesterday");
  assert.equal(dayLabel(new Date(2026, 8, 24, 16).getTime(), now), new Date(2026, 8, 24).toLocaleDateString(undefined, { weekday: "long" }));
  assert.equal(dayLabel(new Date(2026, 8, 13).getTime(), now), new Date(2026, 8, 13).toLocaleDateString(undefined, { month: "short", day: "numeric" }));
  assert.match(dayLabel(new Date(2025, 11, 1).getTime(), now), /2025/);
});

test("posts group under one heading per day, newest first", () => {
  const groups = byDay(
    [
      post("a", new Date(2026, 8, 20, 9)),
      post("b", new Date(2026, 8, 27, 9)),
      post("c", new Date(2026, 8, 27, 7)),
    ],
    now
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((u) => u.id)]),
    [
      ["Today", ["b", "c"]],
      [new Date(2026, 8, 20).toLocaleDateString(undefined, { month: "short", day: "numeric" }), ["a"]],
    ]
  );
});

test("a class is one source by id, a group by its name, the latest poster first", () => {
  const list = sourcesOf([
    post("a", new Date(2026, 8, 20), "8467908634", "Spanish 3 - 4330: AbarcaN p1 T1"),
    post("b", new Date(2026, 8, 25)),
    post("c", new Date(2026, 8, 24), "8467908634", "Spanish 3 - 4330: AbarcaN p1 T1"),
  ]);
  assert.deepEqual(
    list.map((s) => [s.key, s.count]),
    [
      ["r:CHS Hub: Gr10", 1],
      ["c:8467908634", 2],
    ]
  );
  assert.equal(sourceKey(post("d", now, "1")), "c:1");
});

test("only posts after the last look count as new, and an old board has none", () => {
  const seen = new Date(2026, 8, 24).getTime();
  assert.equal(unseenCount([post("a", new Date(2026, 8, 25)), post("b", new Date(2026, 8, 23))], seen), 1);
  assert.equal(unseenCount(undefined, seen), 0);
});
