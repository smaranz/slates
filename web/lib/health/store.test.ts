import assert from "node:assert/strict";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The record on disk, in a throwaway home: what a device sends is checked
// field by field, weigh-ins move the profile's weight, and a meal's photo goes
// with the meal.

process.env.HOME = fsSync.mkdtempSync(path.join(os.tmpdir(), "slates-health-store-"));

const load = import("./store");

test("a fresh record is the default profile and an empty log", async () => {
  const { getState } = await load;
  const state = await getState();
  assert.equal(state.profile.setUp, false);
  assert.equal(state.profile.studio, "cupertino");
  assert.deepEqual(state.log, { foods: [], exercises: [], weights: [], water: {} });
});

test("a profile change keeps what checks out and ignores the rest", async () => {
  const { updateProfile } = await load;
  const profile = await updateProfile({ setUp: true, sex: "female", heightCm: 999, weightKg: 70, activity: "couch", custom: { calories: 2100, protein: 150, carbs: 220, fat: 70 }, studio: "../etc", units: "metric" });
  assert.equal(profile.setUp, true);
  assert.equal(profile.sex, "female");
  assert.equal(profile.heightCm, 250);
  assert.equal(profile.weightKg, 70);
  assert.equal(profile.activity, "active");
  assert.deepEqual(profile.custom, { calories: 2100, protein: 150, carbs: 220, fat: 70 });
  assert.equal(profile.studio, "cupertino");
  assert.equal(profile.units, "metric");
  assert.equal((await updateProfile({ custom: null })).custom, null);
});

test("foods are added, edited and removed, with their photo", async () => {
  const { changeLog, savePhoto, readPhoto } = await load;
  const photo = await savePhoto(new Uint8Array([0xff, 0xd8, 0xff]), "image/jpeg");
  let state = await changeLog({
    op: "add",
    kind: "food",
    entry: { day: "2026-10-04", meal: "lunch", name: "  Chicken   burrito ", servings: 1, per: { calories: 650, protein: 38, carbs: 70, fat: 22, sodium: "1200" }, photo, source: "photo", healthScore: 6.4, script: "<x>" },
  });
  const added = state.log.foods[0]!;
  assert.equal(added.name, "Chicken burrito");
  assert.equal(added.per.sodium, 1200);
  assert.equal(added.healthScore, 6);
  assert.equal(added.photo, photo);
  assert.equal("script" in added, false);

  state = await changeLog({ op: "update", kind: "food", id: added.id, patch: { servings: 1.5, meal: "dinner" } });
  assert.equal(state.log.foods[0]!.servings, 1.5);
  assert.equal(state.log.foods[0]!.meal, "dinner");
  assert.equal(state.log.foods[0]!.per.calories, 650);

  assert.ok(await readPhoto(photo));
  state = await changeLog({ op: "remove", kind: "food", id: added.id });
  assert.equal(state.log.foods.length, 0);
  assert.equal(await readPhoto(photo), null);
  await assert.rejects(changeLog({ op: "remove", kind: "food", id: added.id }), /gone/);
});

test("the newest weigh-in becomes the profile's weight", async () => {
  const { changeLog } = await load;
  let state = await changeLog({ op: "add", kind: "weight", entry: { day: "2026-10-01", kg: 72 } });
  state = await changeLog({ op: "add", kind: "weight", entry: { day: "2026-10-04", kg: 71.4 } });
  assert.equal(state.profile.weightKg, 71.4);
  const newest = state.log.weights.at(-1)!;
  state = await changeLog({ op: "remove", kind: "weight", id: newest.id });
  assert.equal(state.profile.weightKg, 72);
});

test("water is a day's total, and an F45 class keeps what it was", async () => {
  const { changeLog } = await load;
  let state = await changeLog({ op: "water", day: "2026-10-04", ml: 750 });
  assert.equal(state.log.water["2026-10-04"], 750);
  state = await changeLog({ op: "water", day: "2026-10-04", ml: 0 });
  assert.equal(state.log.water["2026-10-04"], undefined);

  state = await changeLog({
    op: "add",
    kind: "exercise",
    entry: { day: "2026-10-05", kind: "f45", name: "Abacus", minutes: 45, calories: 512, measured: true, f45: { workout: "Abacus", type: "Hybrid", studio: "cupertino", classId: 35894952, time: "06:00", coach: "Kelsey Sparr" } },
  });
  const f45 = state.log.exercises[0]!;
  assert.equal(f45.measured, true);
  assert.deepEqual(f45.f45, { workout: "Abacus", type: "Hybrid", studio: "cupertino", classId: 35894952, time: "06:00", coach: "Kelsey Sparr" });
  await assert.rejects(changeLog({ op: "add", kind: "weight", entry: {} }), /needs a weight/);
  await assert.rejects(changeLog({ op: "drop" }), /Unknown change/);
});
