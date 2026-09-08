import { roughEllipse, roughLine, roughRoundedRect } from "drawably";

/**
 * The pen the board is drawn with.
 *
 * Every stroke in a lesson is generated here, in Node, while the composition
 * is being written — never in the browser. HyperFrames seeks each frame
 * independently, so a sketch that re-rolled its own wobble on mount would come
 * out shaped differently in every frame of the same render and the ink would
 * appear to crawl. Drawably's generators take a seed and hand back an SVG path
 * string, which means the geometry can be baked into the HTML as a static
 * attribute and the renderer is never asked to make a decision.
 *
 * `boil` is 0 everywhere for the same reason, and because it is the right look
 * anyway: chalk that has been written stays written. The boiling doodle the
 * library does by default belongs on a button you can hover, not on a line
 * someone is trying to read off a board.
 */

/** Every generator gets this. Only the seed changes between strokes. */
const HAND = { roughness: 1, boil: 0 } as const;

/**
 * Stroke weights, in px against the 1920x1080 frame.
 *
 * A board pen is much broader than a UI sketch — drawably's 2px default is a
 * ballpoint, and at this frame size it renders as a grey hair that H.264 then
 * eats entirely. These are sized to sit next to 74px handwriting.
 */
export const NIB = { thin: 4, pen: 5.5, marker: 8 } as const;

/**
 * A seed derived from the text a stroke belongs to.
 *
 * Seeding from content rather than from a counter means a lesson draws itself
 * the same way every time it is rendered — re-rendering after a failed encode
 * produces the same board, not a subtly different one — while two different
 * headings never share a wobble. FNV-1a, because it is four lines and the
 * distribution only has to be good enough to look unrepeated.
 */
export function seedFrom(text: string): number {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * One pen stroke, ready to be drawn on.
 *
 * `pathLength="1"` is what makes this work without measuring any geometry: it
 * renormalises the path's own length to 1, so a dash array of 1 with an offset
 * of 1 hides the stroke completely whatever its real shape, and easing that
 * offset to 0 lays it down from its start to its end. That is the whole
 * draw-on effect, and it needs no `getTotalLength()` call — which matters,
 * because the path is built in Node where there is no SVG engine to ask.
 *
 * The offset is written as an attribute as well as tweened. The timeline is
 * paused at frame 0 and a stroke whose tween has not begun yet renders at
 * whatever the DOM says, so without the attribute every stroke in the lesson
 * would be fully drawn before the pen ever reached it.
 */
function stroke(id: string, d: string, width: number, extra = ""): string {
  return (
    `<path id="${id}" d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1" ` +
    `fill="none" stroke="currentColor" stroke-width="${width}" ` +
    `stroke-linecap="round" stroke-linejoin="round"${extra}/>`
  );
}

/**
 * A drawing and the strokes inside it, in the order a hand would lay them down.
 *
 * The composer needs the ids back to hang tweens on them, and it needs them
 * ordered, because two strokes of one drawing are drawn in sequence rather
 * than together — that is the difference between a pen and a stencil.
 */
export interface Ink {
  markup: string;
  ids: string[];
}

/**
 * The rule under the lesson title.
 *
 * Drawn as two passes with different seeds. A single stroke under a title
 * reads as a border; a line gone over twice reads as someone underlining it,
 * and it is the cheapest signal on the board that a hand was involved.
 */
export function penRule(id: string, width: number, key: string): Ink {
  const seed = seedFrom(key);
  const first = roughLine(0, 8, width, 6, { ...HAND, seed });
  const second = roughLine(2, 13, width - 6, 12, { ...HAND, seed: seed + 1, roughness: 1.3 });
  return {
    markup:
      `<svg class="ink-rule" viewBox="0 0 ${width} 22" width="${width}" height="22" aria-hidden="true">` +
      stroke(`${id}-a`, first, NIB.pen) +
      stroke(`${id}-b`, second, NIB.thin) +
      `</svg>`,
    ids: [`${id}-a`, `${id}-b`],
  };
}

/**
 * The short dash that marks a jotting.
 *
 * Khan's board has no bullet characters on it — a line of writing gets a dash
 * in front of it because the pen was already there. Fixed width, because these
 * all sit in one column and a ragged left edge would read as a mistake rather
 * than as handwriting.
 */
export function penDash(id: string, key: string): Ink {
  const d = roughLine(2, 11, 34, 10, { ...HAND, seed: seedFrom(key), roughness: 1.2 });
  return {
    markup:
      `<svg class="ink-dash" viewBox="0 0 38 22" width="38" height="22" aria-hidden="true">` +
      stroke(id, d, NIB.pen) +
      `</svg>`,
    ids: [id],
  };
}

/** The box penRing draws into. The browser rescales its coordinates to fit. */
export const RING_BOX = { width: 300, height: 100 } as const;

/**
 * The ring around the term that matters.
 *
 * The one mark whose size cannot be known here: it has to fit a run of text
 * whose width depends on a font that only exists in the browser. So it is
 * drawn into a nominal box and the *coordinates* are rescaled at load time to
 * the measured span — not the SVG, which is the important distinction. Squashing
 * the element with `preserveAspectRatio="none"` was the obvious approach and it
 * fails twice over: it thins the ink along whichever axis stretched more, and
 * `vector-effect="non-scaling-stroke"` (the usual cure for that) breaks the
 * `pathLength` normalisation the draw-on depends on, so every ring in the
 * lesson shows up faintly from the first frame. Rewriting the numbers keeps one
 * honest coordinate space: even stroke, working dashes, exact fit.
 *
 * Two passes, deliberately not concentric: a hand that circles something goes
 * round twice and misses.
 */
export function penRing(id: string, key: string): Ink {
  const seed = seedFrom(key);
  const { width, height } = RING_BOX;
  const outer = roughEllipse(width / 2, height / 2, 143, 43, { ...HAND, seed, roughness: 1.4 });
  const inner = roughEllipse(width / 2 + 1, height / 2 + 1, 137, 39, {
    ...HAND,
    seed: seed + 7,
    roughness: 1.6,
  });
  return {
    markup:
      `<svg class="ink-ring" viewBox="0 0 ${width} ${height}" aria-hidden="true">` +
      stroke(`${id}-a`, outer, NIB.pen) +
      stroke(`${id}-b`, inner, NIB.thin) +
      `</svg>`,
    ids: [`${id}-a`, `${id}-b`],
  };
}

/**
 * The frame around a graph or a picture.
 *
 * Generated at the exact pixel size of the box it surrounds, so unlike the
 * ring this one needs no stretching and keeps an even stroke all the way
 * round. Its job is to stop a Desmos plot from looking like a screenshot
 * someone pasted onto the board: a sketched box around it puts the plot *on*
 * the board instead of in front of it.
 */
export function penFrame(id: string, width: number, height: number, key: string): Ink {
  const d = roughRoundedRect(3, 3, width - 6, height - 6, 14, {
    ...HAND,
    seed: seedFrom(key),
    roughness: 1.1,
  });
  return {
    markup:
      `<svg class="ink-frame" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" aria-hidden="true">` +
      stroke(id, d, NIB.thin) +
      `</svg>`,
    ids: [id],
  };
}
