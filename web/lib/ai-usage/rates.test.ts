import assert from "node:assert/strict";
import test from "node:test";

import { estimatePrice, rateForModel } from "./rates";
import { activatePlan, linkPlan, removePlan, useEnv } from "./plans";
import type { UsagePlan } from "./types";

test("known model uses the rate card", () => {
  const price = estimatePrice({
    model: "gpt-5.6-sol",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
  });
  assert.equal(price.listUsd, 35);
  assert.equal(price.costUsd, 35);
  assert.equal(price.covered, false);
});

test("unknown model falls back to the default rate", () => {
  const rate = rateForModel("brand-new-model-xyz");
  assert.equal(rate.input, 2);
  assert.equal(rate.output, 8);
  const price = estimatePrice({
    model: "brand-new-model-xyz",
    inputTokens: 1_000_000,
    outputTokens: 0,
  });
  assert.equal(price.listUsd, 2);
});

test("elevenlabs characters bill per thousand", () => {
  const price = estimatePrice({
    model: "eleven_multilingual_v2",
    inputTokens: 2000,
    unit: "characters",
  });
  assert.equal(price.unit, "characters");
  assert.equal(price.listUsd, 0.36);
  assert.equal(price.costUsd, 0.36);
});

test("cursor covered calls keep listUsd but costUsd is zero", () => {
  const price = estimatePrice({
    model: "grok-4.7",
    inputTokens: 1_000_000,
    outputTokens: 1_000_000,
    covered: true,
  });
  assert.equal(price.listUsd, 18);
  assert.equal(price.costUsd, 0);
  assert.equal(price.covered, true);
});

test("composer list price when covered", () => {
  const price = estimatePrice({
    model: "composer-2.5",
    inputTokens: 1_000_000,
    outputTokens: 0,
    covered: true,
  });
  assert.equal(price.listUsd, 1.25);
  assert.equal(price.costUsd, 0);
});

function seed(): UsagePlan[] {
  return [
    {
      id: "old",
      provider: "openai",
      label: "Old key",
      kind: "api",
      monthlyUsd: null,
      keyHint: "••••1111",
      active: true,
      linkedAt: 1,
      source: "linked",
    },
  ];
}

test("linking an api plan activates it and deactivates the previous api plan", () => {
  const next = linkPlan(seed(), {
    id: "new",
    provider: "openai",
    label: "Work",
    kind: "api",
    keyHint: "••••2222",
    linkedAt: 2,
  });
  assert.equal(next.length, 2);
  assert.equal(next.find((p) => p.id === "old")?.active, false);
  assert.equal(next.find((p) => p.id === "new")?.active, true);
});

test("activating a subscription does not deactivate api plans", () => {
  const withSub = linkPlan(seed(), {
    id: "plus",
    provider: "openai",
    label: "Plus",
    kind: "subscription",
    monthlyUsd: 20,
    linkedAt: 3,
  });
  assert.equal(withSub.find((p) => p.id === "old")?.active, true);
  assert.equal(withSub.find((p) => p.id === "plus")?.active, true);

  const activated = activatePlan(withSub, "plus");
  assert.equal(activated.find((p) => p.id === "old")?.active, true);
  assert.equal(activated.find((p) => p.id === "plus")?.active, true);
});

test("remove drops the plan", () => {
  const next = removePlan(seed(), "old");
  assert.equal(next.length, 0);
});

test("useEnv deactivates linked api plans for that provider", () => {
  const next = useEnv(seed(), "openai");
  assert.equal(next[0]?.active, false);
});
