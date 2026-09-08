import fs from "node:fs/promises";
import path from "node:path";

import { openai } from "@ai-sdk/openai";
import { generateImage } from "ai";

/**
 * Illustrations for the scenes that ask for one.
 *
 * Opt-in per lesson, because this is the only step that costs real money per
 * scene and adds tens of seconds to a render. Most homework explanations are
 * better served by typography anyway — a picture earns its place when the
 * thing being taught is genuinely visual.
 */

/** Landscape, to sit in the right half of a 16:9 scene without cropping. */
const SIZE = "1536x1024";

/**
 * One illustration on disk, or null.
 *
 * A failed image is deliberately not a failed lesson: the scene falls back to
 * its text layout, which was already designed to stand on its own. Losing a
 * whole render because one picture came back 400 would be the wrong trade.
 */
export async function drawScene(prompt: string, file: string): Promise<string | null> {
  try {
    const { image } = await generateImage({
      model: openai.image("gpt-image-1"),
      // The model is told the frame it's landing in — a bright illustration on
      // a white card would tear a hole in a dark composition.
      prompt: `${prompt}. Clean flat educational illustration, minimal, generous negative space, dark charcoal background, muted palette with a single soft blue accent, no text, no labels, no watermarks.`,
      size: SIZE,
    });

    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, Buffer.from(image.uint8Array));
    return file;
  } catch {
    return null;
  }
}
