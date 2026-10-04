import assert from "node:assert/strict";
import test from "node:test";

import {
  addDays,
  ageOn,
  bmr,
  burnEstimate,
  dayStats,
  defaultProfile,
  effectiveGoal,
  recommendedGoals,
  streak,
  weekStart,
  weeklyPace,
} from "./nutrition";
import type { FoodEntry, HealthState, Profile } from "./types";

// The targets have to match what CalAi gave on the phone: Mifflin–St Jeor,
// 7,700 kcal a kg, the sex floors, and a protein floor for people who train.

const TODAY = "2026-10-04";

function profile(patch: Partial<Profile> = {}): Profile {
  return {
    ...defaultProfile(),
    setUp: true,
    sex: "male",
    birthDate: "2008-06-01",
    heightCm: 175,
    weightKg: 75,
    startWeightKg: 75,
    targetWeightKg: 70,
    goal: "lose",
    paceKg: 0.5,
    activity: "active",
    ...patch,
  };
}

function meal(day: string, calories: number, patch: Partial<FoodEntry> = {}): FoodEntry {
  return { id: `f${day}${calories}`, day, at: 0, meal: "lunch", name: "Chicken rice bowl", serving: "1 bowl", servings: 1, per: { calories, protein: 30, carbs: 50, fat: 10 }, source: "manual", ...patch };
}

const state = (p: Profile, foods: FoodEntry[] = [], extra: Partial<HealthState["log"]> = {}): HealthState => ({
  profile: p,
  log: { foods, exercises: [], weights: [], water: {}, ...extra },
});

test("BMR is Mifflin–St Jeor", () => {
  assert.equal(bmr("male", 80, 180, 30), 1780);
  assert.equal(bmr("female", 80, 180, 30), 1614);
});

test("age turns over on the birthday, not before", () => {
  assert.equal(ageOn("2008-10-05", "2026-10-04"), 17);
  assert.equal(ageOn("2008-10-05", "2026-10-05"), 18);
});

test("a loss plan takes the pace's deficit off TDEE and fits macros to it", () => {
  // BMR 1758.75 × 1.725 = 3033.8, less 550 for half a kilo a week.
  assert.deepEqual(recommendedGoals(profile(), TODAY), { calories: 2484, protein: 155, carbs: 279, fat: 83 });
});

test("calories never go under the floor, and protein holds its per-kilo minimum", () => {
  const small = profile({ sex: "female", heightCm: 150, weightKg: 45, targetWeightKg: 40, activity: "sedentary", paceKg: 0.9 });
  assert.equal(recommendedGoals(small, TODAY).calories, 1200);
  const heavy = recommendedGoals(profile({ weightKg: 110, targetWeightKg: 90, activity: "active" }), TODAY);
  assert.ok(heavy.protein >= 110 * 1.6 - 1 || heavy.protein === Math.floor((heavy.calories * 0.35) / 4));
});

test("a target that contradicts the goal falls back to maintaining", () => {
  assert.equal(effectiveGoal(profile({ goal: "lose", targetWeightKg: 80 })), "maintain");
  assert.equal(effectiveGoal(profile({ goal: "gain", targetWeightKg: 60 })), "maintain");
  assert.equal(weeklyPace(profile({ goal: "maintain" })), 0);
});

test("the weekly pace stops at two pounds and at what's left to lose", () => {
  assert.equal(weeklyPace(profile({ paceKg: 2 })), 0.9);
  assert.ok(Math.abs(weeklyPace(profile({ targetWeightKg: 74.7, paceKg: 0.9 })) - 0.3) < 1e-9);
});

test("a day adds up what was eaten, rollover and burned calories when they're switched on", () => {
  const p = profile({ custom: { calories: 2000, protein: 150, carbs: 200, fat: 70 }, rollover: true, addBurned: true });
  const s = state(p, [meal("2026-10-03", 1700), meal(TODAY, 600, { servings: 1.5 })], {
    exercises: [{ id: "e1", day: TODAY, at: 0, kind: "f45", name: "Abacus", minutes: 45, calories: 480 }],
    water: { [TODAY]: 750 },
  });
  const day = dayStats(s, TODAY, TODAY);
  assert.equal(day.eaten, 900);
  assert.equal(day.rollover, 200);
  assert.equal(day.burned, 480);
  assert.equal(day.left, 2000 + 480 + 200 - 900);
  assert.equal(day.protein.value, 45);
  assert.equal(day.waterMl, 750);
  assert.ok(day.score! >= 1 && day.score! <= 10);
});

test("an empty day has no score, and burned calories don't count unless asked", () => {
  const day = dayStats(state(profile({ custom: { calories: 2000, protein: 150, carbs: 200, fat: 70 } }), [], {
    exercises: [{ id: "e1", day: TODAY, at: 0, kind: "run", name: "Run", minutes: 30, calories: 300 }],
  }), TODAY, TODAY);
  assert.equal(day.score, null);
  assert.equal(day.left, 2000);
  assert.equal(day.burned, 300);
});

test("the streak survives today until a whole day is missed", () => {
  const p = profile();
  assert.equal(streak(state(p, [meal(TODAY, 1), meal("2026-10-03", 1), meal("2026-10-02", 1), meal("2026-09-30", 1)]), TODAY), 3);
  assert.equal(streak(state(p, [meal("2026-10-03", 1), meal("2026-10-02", 1)]), TODAY), 2);
  assert.equal(streak(state(p, [meal("2026-10-02", 1)]), TODAY), 0);
});

test("an F45 class burns by its type, and effort moves it", () => {
  assert.equal(burnEstimate({ kind: "f45", type: "Cardio", minutes: 45, kg: 75 }), 450);
  assert.equal(burnEstimate({ kind: "f45", type: "Resistance", minutes: 45, kg: 75, effort: "hard" }), 388);
  assert.equal(burnEstimate({ kind: "f45", type: "Something new", minutes: 45, kg: 75 }), 394);
});

test("days step across the end of daylight saving, and weeks start on Sunday", () => {
  assert.equal(addDays("2026-10-31", 2), "2026-11-02");
  assert.equal(addDays("2026-03-07", 1), "2026-03-08");
  assert.equal(weekStart("2026-10-04"), "2026-10-04");
  assert.equal(weekStart("2026-10-10"), "2026-10-04");
});
