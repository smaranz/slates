import assert from "node:assert/strict";
import test from "node:test";

import { generalAgentPrompt } from "./prompt";

test("the master prompt describes a general agent and the assigned task", () => {
  const prompt = generalAgentPrompt({
    name: "Helper", job: "", rules: "Check the result", style: "Keep replies short",
    platform: "Windows_NT", workspace: "workspace", browser: true,
  });
  assert.match(prompt, /general-purpose agent given a specific task/);
  assert.match(prompt, /Check the result/);
  assert.match(prompt, /Keep replies short/);
  assert.match(prompt, /send_file/);
  assert.match(prompt, /do not inspect unrelated personal data/);
  assert.doesNotMatch(prompt, /school|student|tutor|grade|slates_board|search_chats/i);
});
