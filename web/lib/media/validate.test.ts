import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_IMAGE_MODEL, DEFAULT_SPEECH_MODEL, DEFAULT_VIDEO_MODEL, VIDEO_MODELS } from "./catalog";
import { MediaInputError, resolveInput, validateVideoInput } from "./validate";

test("applies image and video defaults", () => {
  const image = resolveInput({ kind: "image", prompt: "A quiet blue room" });
  assert.equal(image.model, DEFAULT_IMAGE_MODEL);
  assert.equal(image.options.aspect_ratio, "1:1");
  assert.equal(image.options.resolution, "1K");
  assert.equal(image.options.quality, "medium");

  const video = resolveInput({ kind: "video", prompt: "A slow wave" });
  assert.equal(video.model, DEFAULT_VIDEO_MODEL);
  assert.equal(video.options.duration_secs, 4);
  assert.equal(video.options.aspect_ratio, "16:9");
  assert.equal(video.options.resolution, "720p");
  assert.equal(video.options.generate_audio, false);
});

test("applies speech, sound and music defaults", () => {
  const speech = resolveInput({ kind: "speech", prompt: "Hello there." });
  assert.equal(speech.model, DEFAULT_SPEECH_MODEL);
  assert.equal(speech.options.voice_id, "JBFqnCBsd6RMkjVDRZzb");
  assert.equal(resolveInput({ kind: "sfx", prompt: "A distant bell" }).options.prompt_influence, 0.3);
  assert.equal(resolveInput({ kind: "music", prompt: "Soft piano" }).options.model_id, "music_v2_5");
});

test("rejects unknown models, unsupported values, bad ranges, empty and oversized prompts", () => {
  assert.throws(() => resolveInput({ kind: "image", prompt: "A sky", model: "missing-model" }), /Unknown image model/);
  assert.throws(
    () => resolveInput({ kind: "video", prompt: "A sky", aspectRatio: "2:1" }),
    /aspect_ratio 2:1 isn't available for veo-3.1-fast-generate-001 — use 16:9 or 9:16/,
  );
  assert.throws(() => resolveInput({ kind: "video", prompt: "A sky", durationSecs: 5 }), /duration_secs 5 isn't available/);
  assert.throws(() => resolveInput({ kind: "sfx", prompt: "Door", durationSecs: 31 }), /between 0.5 and 30/);
  assert.throws(() => resolveInput({ kind: "music", prompt: "Song", lengthSecs: 301 }), /from 3 to 300/);
  assert.throws(() => resolveInput({ kind: "image", prompt: "  " }), /prompt can't be empty/);
  assert.throws(() => resolveInput({ kind: "speech", prompt: "x".repeat(10_001) }), /allows 10000/);
  const modelWithoutFrame = { ...VIDEO_MODELS[0]!, id: "video-without-frame", startFrame: false };
  assert.throws(
    () => validateVideoInput({ kind: "video", prompt: "Animate", model: modelWithoutFrame.id, startFrameId: "med_abcdefgh" }, modelWithoutFrame),
    /start_frame isn't available/,
  );
  assert.throws(() => resolveInput({ kind: "video", prompt: "Animate", startFrameId: "../frame" }), MediaInputError);
});
