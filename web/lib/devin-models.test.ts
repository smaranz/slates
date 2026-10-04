import assert from "node:assert/strict";
import test from "node:test";

import { DEVIN_FAMILIES, devinVariant } from "./devin-models";

const family = (slug: string) => DEVIN_FAMILIES.find((f) => f.slug === slug)!;

test("a thinking level picks the family's matching variant", () => {
  assert.equal(devinVariant(family("claude-sonnet-5.5"), "low"), "claude-sonnet-5-5-low");
  assert.equal(devinVariant(family("claude-sonnet-5.5"), "xhigh"), "claude-sonnet-5-5-xhigh");
  assert.equal(devinVariant(family("gpt-5.2"), "medium"), "MODEL_GPT_5_2_MEDIUM");
});

test("a level a family lacks falls to the nearest one", () => {
  assert.equal(devinVariant(family("swe-2"), "low"), "swe-2-medium");
  assert.equal(devinVariant(family("swe-2"), "xhigh"), "swe-2-max");
  assert.equal(devinVariant(family("claude-opus-4.6"), "high"), "claude-opus-4-6-thinking");
  assert.equal(devinVariant(family("fusion"), "high"), "fusion-claude-opus-5-5-high-sidekick-swe-2-medium");
});

test("one-variant families and 1M windows", () => {
  assert.equal(devinVariant(family("adaptive"), "high"), "adaptive");
  assert.equal(devinVariant(family("claude-haiku-4.5"), "low"), "MODEL_PRIVATE_11");
  assert.equal(devinVariant(family("glm-5.2"), "low"), "glm-5-2-none");
});
