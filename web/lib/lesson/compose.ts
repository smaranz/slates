import { penDash, penFrame, penRing, penRule, RING_BOX } from "./ink";
import type { LessonGraph, LessonScript } from "./types";

/**
 * The HyperFrames composition for a lesson.
 *
 * This is a board, not a slide deck, and the difference is the whole point.
 * A deck shows you a finished thought and then replaces it with the next
 * finished thought; a board is empty until someone writes on it, and what they
 * wrote stays there while they explain the next part. Every Khan Academy video
 * ever made is the second thing, and it is why they feel like being taught
 * rather than being presented at.
 *
 * So: one continuous dark surface, taller than the frame. Words are written on
 * in the hand of a pen font, a word at a time, as the voice says them. Marks —
 * dashes, rules, the ring round the term that matters — are hand-drawn strokes
 * that draw themselves on, left to right, from geometry baked in at compose
 * time. Nothing ever crossfades out. When the board runs past the bottom of
 * the frame the view pans down to follow the pen, and what came before is
 * still up there, exactly as it would be on a real board.
 *
 * The rules this file has to satisfy are HyperFrames' own: one paused GSAP
 * timeline registered on `window.__timelines`, nothing driven by a clock or an
 * unseeded random, no infinite repeats, and every visual state reachable from
 * a time value alone. The timeline is built inside `document.fonts.ready` —
 * the documented setup path — because the pan distances are measured off the
 * real laid-out board, and measuring before the pen font loads would measure
 * the fallback.
 */

/** A beat of quiet before the voice starts, so a scene never opens mid-word. */
const LEAD_IN = 0.35;
/** How long the board holds after the voice stops, so it doesn't cut dead. */
const TAIL = 0.55;

/** The frame. The board is this wide and scrolls vertically inside it. */
const FRAME_W = 1920;
const FRAME_H = 1080;

/** The art well — a graph or a picture sits in a box exactly this size. */
const ART_W = 780;
const ART_H = 520;

/**
 * Chalk on a near-black board.
 *
 * Not Slates' own greys — those are tuned for a screen two feet away and read
 * as mud once H.264 has been at them. A teaching video wants a background dark
 * enough that a bright line is the only thing your eye can land on, which is
 * the whole reason Khan's videos are drawn on black.
 *
 * The ink colours are a real pen set rather than one accent: a teacher reaches
 * for a different colour when they change what they are doing, and "the yellow
 * one" only works as an instruction if yellow means something. Headings are
 * blue, working is white, and yellow is kept for the ring round the thing you
 * are meant to take away.
 */
const THEME = {
  bg: "#0b0b0d",
  chalk: "#f4f4f5",
  heading: "#7cc4ff",
  muted: "#8b8b93",
  mark: "#ffd479",
};

/**
 * Curve colours, cycled per expression.
 *
 * Khan-style: a handful of saturated colours that hold up against black, each
 * distinct enough that "the blue one" and "the green one" are usable
 * instructions in the narration.
 */
const CURVES = ["#6fb1ff", "#74d99f", "#ffd479", "#ff8ab5"];

/**
 * Desmos' `invertedColors` gives us dark graph paper, but it inverts the
 * expression colours along with everything else — a light blue curve comes out
 * orange. Passing the inverse means the colour that lands on screen is the one
 * that was asked for.
 */
function invertHex(hex: string): string {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return `#${(0xffffff ^ value).toString(16).padStart(6, "0")}`;
}

export interface SceneTiming {
  /** Seconds of narration audio for this scene, measured from the file. */
  audioSeconds: number;
  /** Absolute path to the narration MP3, relative to the project root. */
  audioFile: string;
  /** Project-relative path to this scene's illustration, when it has one. */
  imageFile?: string;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Two decimals is finer than a frame at 30fps; more just makes the HTML noisy. */
const t = (seconds: number) => Math.round(seconds * 100) / 100;

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));

/**
 * Where every scene starts and how long it runs.
 *
 * Each scene is exactly as long as the sentence spoken over it, plus a lead-in
 * and a tail. Nothing here is a fixed "seconds per slide" — the voice sets the
 * pace. Unlike the deck this replaced there is no overlap between neighbours:
 * a board has nothing to crossfade, so scenes simply follow one another and
 * two narration tracks can never talk over each other.
 */
export function planTimeline(timings: SceneTiming[]) {
  const scenes: { start: number; duration: number; audioStart: number }[] = [];
  let cursor = 0;

  for (const timing of timings) {
    const duration = LEAD_IN + timing.audioSeconds + TAIL;
    scenes.push({ start: t(cursor), duration: t(duration), audioStart: t(cursor + LEAD_IN) });
    cursor += duration;
  }

  const last = scenes[scenes.length - 1];
  return { scenes, total: t(last.start + last.duration) };
}

/**
 * Desmos' own script tag, loaded only when a lesson actually plots something.
 *
 * The key is read from the environment so an install can use its own; the
 * default is the demo key Desmos publishes in its API docs, which is what
 * makes this work out of the box.
 */
function desmosTag(needed: boolean): string {
  if (!needed) return "";
  const key = process.env.DESMOS_API_KEY || "dcb31709b452b1cf9dc26972add0fda6";
  return `    <script src="https://www.desmos.com/api/v1.11/calculator.js?apiKey=${encodeURIComponent(key)}"></script>`;
}

/**
 * The calculators, built synchronously.
 *
 * Desmos' script tag is blocking, so the global is there by the time this
 * runs — which matters, because the plots have to be mounted and laid out
 * before the board is measured for its pan distances. Every chrome affordance
 * is off: this is a plot in a video, not a calculator someone is going to
 * click.
 */
function plotHelper(plots: string[]): string {
  if (!plots.length) return "";
  return `        function plot(id, expressions, bounds) {
          const calc = Desmos.GraphingCalculator(document.getElementById(id), {
            expressions: false,
            settingsMenu: false,
            zoomButtons: false,
            keypad: false,
            lockViewport: true,
            border: false,
            // Dark graph paper, to sit on the board rather than glare off it.
            invertedColors: true,
          });
          calc.setMathBounds(bounds);
          expressions.forEach((e, i) => calc.setExpression({ id: "e" + i, latex: e.latex, color: e.color }));
        }

${plots.join("\n")}
`;
}

/** One `plot(...)` call, with colours pre-inverted for Desmos' dark mode. */
function plotCall(index: number, graph: LessonGraph): string {
  const expressions = graph.expressions.map((e, n) => ({
    latex: e.latex,
    color: invertHex(e.color && /^#[0-9a-f]{6}$/i.test(e.color) ? e.color : CURVES[n % CURVES.length]),
  }));
  return `        plot("plot-${index}", ${JSON.stringify(expressions)}, ${JSON.stringify(graph.bounds)});`;
}

/* ------------------------------------------------------------------ */
/*  Handwriting                                                        */
/* ------------------------------------------------------------------ */

/**
 * A line of text, written a word at a time.
 *
 * Each word is its own inline-block with an opaque cover sitting exactly over
 * it. Sliding that cover off to the right uncovers the word from its left
 * edge, which is what writing looks like; a small round nib rides the cover's
 * leading edge so the reveal reads as a pen moving rather than a wipe passing.
 *
 * Per *word* rather than per line, because a line long enough to wrap would
 * otherwise uncover both of its lines at once — a diagonal wipe across a
 * paragraph, which is the exact slide-deck tell this file exists to get rid
 * of. Word by word also happens to be the honest thing: it lands with the
 * voice saying it.
 */
interface WrittenLine {
  html: string;
  /** Cover ids in reading order — one tween each, staggered. */
  masks: string[];
  /** The ring round the emphasised run, when this line carries one. */
  ring?: { markup: string; ids: string[] };
}

function writeLine(idBase: string, text: string, emphasis?: string): WrittenLine {
  // Where the emphasised run sits, in characters. Case-insensitive because the
  // model is quoting a phrase back out of its own prose and rarely matches case.
  let runStart = -1;
  let runEnd = -1;
  const term = emphasis?.trim();
  if (term) {
    const found = text.toLowerCase().indexOf(term.toLowerCase());
    if (found >= 0) {
      runStart = found;
      runEnd = found + term.length;
    }
  }

  const masks: string[] = [];
  const pieces: string[] = [];
  let ring: WrittenLine["ring"];

  // Walk the words with their offsets so a word can be tested against the run.
  const words = [...text.matchAll(/\S+/g)];
  let ringOpen = false;

  words.forEach((match, index) => {
    const word = match[0];
    const at = match.index ?? 0;
    const inRun = runStart >= 0 && at < runEnd && at + word.length > runStart;

    // The ring wraps the contiguous group of words it covers, so its box is
    // their union and CSS can size it without measuring anything.
    if (inRun && !ringOpen) {
      pieces.push(`<span class="emph">`);
      ringOpen = true;
    } else if (!inRun && ringOpen) {
      ring = penRing(`${idBase}-ring`, `${idBase}:${term}`);
      pieces.push(ring.markup, `</span>`);
      ringOpen = false;
    }

    const mask = `${idBase}-m${index}`;
    masks.push(mask);
    pieces.push(
      `<span class="write" data-layout-allow-occlusion>` +
        `<span class="ink">${escapeHtml(word)}</span>` +
        `<span class="cover" id="${mask}"><i class="nib"></i></span></span>`
    );
    // A real space between the spans, outside them, so the line wraps normally
    // and no cover ever sits over the gap.
    if (index < words.length - 1) pieces.push(" ");
  });

  if (ringOpen) {
    ring = penRing(`${idBase}-ring`, `${idBase}:${term}`);
    pieces.push(ring.markup, `</span>`);
  }

  return { html: pieces.join(""), masks, ring };
}

/**
 * How long a line takes to write, and the gap between its words.
 *
 * Both scale with the word count and then get clamped, so a two-word heading
 * does not snap into place and a fifteen-word jotting is not still being
 * written after the voice has moved on. Words overlap slightly — the next one
 * starts before the last has finished — because a hand does not stop between
 * words.
 */
function writeTiming(wordCount: number) {
  const step = clamp(1.15 / Math.max(1, wordCount), 0.055, 0.15);
  return { step, each: clamp(step * 1.6, 0.1, 0.26), total: step * wordCount };
}

/* ------------------------------------------------------------------ */
/*  The composition                                                    */
/* ------------------------------------------------------------------ */

export function composeLesson(script: LessonScript, timings: SceneTiming[]): string {
  const plan = planTimeline(timings);

  const blocks: string[] = [];
  const tweens: string[] = [];
  const plots: string[] = [];

  /**
   * Every draw-on stroke in the lesson, hung on the timeline the same way:
   * the dash offset eases from 1 (nothing laid down) to 0 (the whole stroke),
   * linearly, because a pen moves at the speed it moves.
   */
  const draw = (id: string, at: number, duration: number) =>
    tweens.push(
      `          tl.fromTo("#${id}", { strokeDashoffset: 1 }, ` +
        `{ strokeDashoffset: 0, duration: ${t(duration)}, ease: "none" }, ${t(at)});`
    );

  /** A written line: covers slide off word by word, nibs blink on and out. */
  const write = (line: WrittenLine, at: number) => {
    const timing = writeTiming(line.masks.length);
    line.masks.forEach((mask, index) => {
      const start = t(at + index * timing.step);
      tweens.push(
        `          tl.fromTo("#${mask}", { xPercent: 0 }, ` +
          `{ xPercent: 101, duration: ${t(timing.each)}, ease: "none" }, ${start});`,
        `          tl.set("#${mask} .nib", { opacity: 1 }, ${start});`,
        `          tl.to("#${mask} .nib", { opacity: 0, duration: 0.08, ease: "none" }, ` +
          `${t(start + timing.each - 0.08)});`
      );
    });
    return timing.total;
  };

  /* ---- the title block: the topic, written at the top of the board ---- */

  const titleLine = writeLine("t-head", script.title);
  const subLine = writeLine("t-sub", script.subtitle);
  const rule = penRule("t-rule", 980, script.title);

  blocks.push(
    `      <div class="block title-block" id="block-0">`,
    `        <h1 class="hand title">${titleLine.html}</h1>`,
    `        <div class="rule-well">${rule.markup}</div>`,
    `        <p class="hand sub">${subLine.html}</p>`,
    `      </div>`
  );

  {
    const at = plan.scenes[0].start + 0.15;
    const titleEnd = write(titleLine, at);
    draw(rule.ids[0], at + titleEnd + 0.1, 0.5);
    draw(rule.ids[1], at + titleEnd + 0.32, 0.42);
    write(subLine, at + titleEnd + 0.45);
  }

  /* ---- one block per scene ---- */

  script.scenes.forEach((scene, index) => {
    const n = index + 1;
    const at = plan.scenes[n];
    const spoken = timings[n]?.audioSeconds ?? 4;
    const image = timings[n]?.imageFile;
    const graph = scene.graph;
    const art = graph || image;
    const id = `s${n}`;

    // The emphasised term is rung wherever it actually appears — the heading
    // if it is there, otherwise the first jotting that contains it. Looking in
    // both is worth the few lines: the model puts it in either.
    const term = scene.emphasis?.trim() || undefined;
    const inHeading = !!term && scene.heading.toLowerCase().includes(term.toLowerCase());
    const ringBullet = inHeading
      ? -1
      : scene.bullets.findIndex((b) => !!term && b.toLowerCase().includes(term.toLowerCase()));

    const heading = writeLine(`${id}-h`, scene.heading, inHeading ? term : undefined);
    const bullets = scene.bullets.map((bullet, b) =>
      writeLine(`${id}-b${b}`, bullet, b === ringBullet ? term : undefined)
    );
    const dashes = scene.bullets.map((bullet, b) => penDash(`${id}-d${b}`, `${id}:${b}:${bullet}`));

    blocks.push(`      <div class="block${art ? " has-art" : ""}" id="block-${n}">`);
    blocks.push(`        <div class="copy">`);
    blocks.push(`          <h2 class="hand heading">${heading.html}</h2>`);
    if (bullets.length) {
      blocks.push(`          <ul class="jottings">`);
      bullets.forEach((line, b) => {
        blocks.push(
          `            <li class="jotting">${dashes[b].markup}` +
            `<span class="hand body">${line.html}</span></li>`
        );
      });
      blocks.push(`          </ul>`);
    }
    blocks.push(`        </div>`);

    if (art) {
      const frame = penFrame(`${id}-frame`, ART_W, ART_H, `${id}:${scene.heading}`);
      blocks.push(`        <div class="art">`);
      if (graph) {
        // Desmos draws into this node; it needs a real box before it mounts.
        blocks.push(`          <div class="plot" id="plot-${n}"></div>`);
        plots.push(plotCall(n, graph));
      } else if (image) {
        blocks.push(`          <img class="picture" src="${escapeHtml(image)}" alt="" />`);
      }
      blocks.push(`          ${frame.markup}`);
      blocks.push(`        </div>`);

      // The frame is drawn first and the plot appears inside it, so the box is
      // established before anything fills it — the order a hand would do it in.
      draw(`${id}-frame`, at.start + 0.45, 0.85);
      tweens.push(
        `          tl.fromTo("#block-${n} .art > :first-child", { opacity: 0 }, ` +
          `{ opacity: 1, duration: 0.5, ease: "power1.out" }, ${t(at.start + 1.05)});`
      );
    }
    blocks.push(`      </div>`);

    /* ---- motion for this scene ---- */

    const open = at.start + 0.12;
    const headEnd = write(heading, open);

    // Jottings are spread across the front two-thirds of the narration, so the
    // last one has landed while the voice is still talking about it rather than
    // arriving after the point has been made.
    const bodyFrom = open + headEnd + 0.3;
    const bodySpan = Math.max(0.7, at.start + LEAD_IN + spoken * 0.66 - bodyFrom);
    bullets.forEach((line, b) => {
      const lineAt = bodyFrom + (bodySpan * b) / Math.max(1, bullets.length);
      draw(dashes[b].ids[0], lineAt, 0.22);
      write(line, lineAt + 0.18);
    });

    // The ring lands late, on the beat where the narration says why this is the
    // bit to remember. Two passes, the second chasing the first.
    const ring = heading.ring ?? bullets.find((line) => line.ring)?.ring;
    if (ring) {
      const ringAt = at.start + LEAD_IN + spoken * 0.74;
      draw(ring.ids[0], ringAt, 0.5);
      draw(ring.ids[1], ringAt + 0.22, 0.44);
    }
  });

  const audio = timings
    .map(
      (timing, i) =>
        `      <audio id="vo-${i}" data-start="${plan.scenes[i].audioStart}" ` +
        `data-duration="${t(timing.audioSeconds)}" data-track-index="${10 + i}" ` +
        // One track per line so a long tail can never collide with the next.
        `src="${escapeHtml(timing.audioFile)}" data-volume="1"></audio>`
    )
    .join("\n");

  // Absolute times the view has to be settled at, one per block, handed to the
  // browser so the pan can be measured against the real laid-out board.
  const panBeats = plan.scenes.map((scene) => t(scene.start)).join(", ");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(script.title)}</title>
${desmosTag(plots.length > 0)}
    <style>
      /* The pen, copied in beside the composition so a render needs no network. */
      @font-face {
        font-family: "Drawably Pen";
        src: url("fonts/DrawablyPen.ttf") format("truetype");
        font-weight: 400;
        font-display: block;
      }
      /* The fallback hands, declared rather than merely named: the renderer
         only supplies a face it has been told about, and a bare family name in
         a font stack silently becomes a generic. These are the two handwriting
         faces the host is likely to already have, and they only ever come into
         play if the pen above failed to copy. */
      @font-face {
        font-family: "Bradley Hand";
        src: local("Bradley Hand"), local("BradleyHandITCTT-Bold");
      }
      @font-face {
        font-family: "Segoe Print";
        src: local("Segoe Print");
      }
      :root {
        --bg: ${THEME.bg};
        --chalk: ${THEME.chalk};
        --heading: ${THEME.heading};
        --muted: ${THEME.muted};
        --mark: ${THEME.mark};
      }
      * { box-sizing: border-box; }
      body { margin: 0; background: var(--bg); color: var(--chalk); }

      /* The frame. The board scrolls inside it and never spills out. */
      .board {
        position: absolute;
        inset: 0;
        overflow: hidden;
        background: var(--bg);
      }
      /* The board itself: one surface, as tall as the lesson needs — which is
         taller than the frame, so it is declared as intentional overflow. The
         part hanging past the bottom is the part not written on yet. */
      .chalk {
        position: absolute;
        top: 0;
        left: 0;
        width: ${FRAME_W}px;
        padding: 104px 130px 220px;
        display: flex;
        flex-direction: column;
        gap: 168px;
        will-change: transform;
      }

      .block { display: flex; align-items: flex-start; gap: 80px; width: 100%; }
      /* The opening block holds the frame on its own, so it is sized to it —
         the pan down to the first scene should feel like leaving the title,
         which needs the title to have had the screen. */
      .title-block {
        flex-direction: column;
        justify-content: center;
        align-items: flex-start;
        gap: 30px;
        min-height: 830px;
      }
      .copy { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 34px; }
      .has-art .copy { flex: 0 0 720px; }

      /* Handwriting. The pen font first, then the declared fallback hands. */
      .hand {
        margin: 0;
        font-family: "Drawably Pen", "Bradley Hand", "Segoe Print", cursive;
        font-weight: 400;
        line-height: 1.34;
      }
      .title { font-size: 112px; line-height: 1.14; max-width: 24ch; }
      .sub { font-size: 46px; color: var(--muted); max-width: 34ch; }
      .heading { font-size: 76px; line-height: 1.2; color: var(--heading); }
      .body { font-size: 42px; }

      .jottings { margin: 6px 0 0; padding: 0; display: flex; flex-direction: column; gap: 26px; list-style: none; }
      .jotting { display: flex; align-items: flex-start; gap: 22px; }
      .rule-well { height: 22px; }

      /* One word, and the cover that is sitting on top of it until it is
         written. The pair is declared as intentional occlusion — covering the
         text IS the mechanism here, so the layout audit is right about what it
         sees and wrong only about it being a defect. The waiver goes on this
         wrapper rather than on the cover because the audit looks for it
         upwards from the text it found hidden, and the text is the cover's
         sibling, not its child. The cover reaches a little past the word on every side so no
         sliver of ink shows through before it moves. */
      .write { position: relative; display: inline-block; }
      .ink { position: relative; }
      .cover {
        position: absolute;
        top: -0.12em;
        bottom: -0.12em;
        left: 0;
        right: -0.14em;
        background: var(--bg);
        will-change: transform;
      }
      /* The pen tip, riding the cover's leading edge. Sized in em so it stays
         in proportion whether it is writing a title or a jotting. */
      .nib {
        position: absolute;
        left: -0.1em;
        top: 62%;
        width: 0.2em;
        height: 0.2em;
        margin-top: -0.1em;
        border-radius: 50%;
        background: currentColor;
        opacity: 0;
      }

      /* Marks. Each sits in the flow or over the thing it marks, and carries
         its colour down through currentColor on the stroke. */
      .ink-rule { display: block; color: var(--muted); overflow: visible; }
      .ink-dash { display: block; flex-shrink: 0; margin-top: 0.42em; color: var(--muted); overflow: visible; }
      /* inline-block, not inline: the ring is absolutely positioned against
         this box, and an inline box that could break across lines does not
         give one. A two-to-five word term has no business wrapping anyway. */
      .emph { display: inline-block; position: relative; }
      /* Left, top and size are written on by script once the span has been
         measured — see the ring fitting below. */
      .ink-ring { position: absolute; color: var(--mark); overflow: visible; pointer-events: none; }

      /* The art well: a sketched box with a plot or a picture inside it. */
      .art { position: relative; flex: 0 0 ${ART_W}px; width: ${ART_W}px; height: ${ART_H}px; }
      .plot { position: absolute; inset: 12px; border-radius: 12px; overflow: hidden; }
      .picture {
        position: absolute;
        inset: 14px;
        width: calc(100% - 28px);
        height: calc(100% - 28px);
        object-fit: contain;
      }
      .ink-frame { position: absolute; inset: 0; color: var(--muted); overflow: visible; }
    </style>
  </head>
  <body>
    <div
      data-composition-id="root"
      data-width="${FRAME_W}"
      data-height="${FRAME_H}"
      data-start="0"
      data-duration="${plan.total}"
    >
      <div class="board">
        <div class="chalk" id="chalk" data-layout-allow-overflow>
${blocks.join("\n")}
        </div>
      </div>

${audio}

      <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
      <script>
${plotHelper(plots)}
        // The board is built and measured before the timeline is registered.
        // Fonts first: the pan distances come off the real laid-out board, and
        // measuring it in the fallback face would measure the wrong board.
        document.fonts.ready.then(function () {
          const tl = gsap.timeline({ paused: true });
          const chalk = document.getElementById("chalk");

          /* ---- fit the rings ---- */

          // Every other mark on the board was generated at its true size in
          // Node. A ring cannot be, because it has to fit a run of text whose
          // width depends on the pen font — so it arrives drawn in a nominal
          // ${RING_BOX.width}x${RING_BOX.height} box and gets its coordinates
          // multiplied through to the measured span here. Scaling the numbers
          // rather than the element keeps the coordinate space square with the
          // pixel grid: the stroke stays an even weight the whole way round and
          // the dash normalisation the draw-on relies on still holds.
          //
          // Safe as a straight number rewrite because these paths are only ever
          // "M x y Q x y x y ..." out of one generator: absolute commands, and
          // every number an x or a y in alternation.
          //
          // The number pattern is written with [0-9] and [.] rather than \d and
          // \. on purpose: this whole script is emitted from a template literal,
          // which eats a backslash it does not recognise. \d arrived in the
          // browser as a literal "d", matched nothing, and every ring rendered
          // at its unscaled size — silently, because the SVG still had the right
          // viewBox. A class with no backslashes in it cannot regress that way.
          document.querySelectorAll("svg.ink-ring").forEach(function (ring) {
            const term = ring.parentNode;
            const padX = term.offsetHeight * 0.34;
            const padY = term.offsetHeight * 0.26;
            const boxW = term.offsetWidth + padX * 2;
            const boxH = term.offsetHeight + padY * 2;
            const sx = boxW / ${RING_BOX.width};
            const sy = boxH / ${RING_BOX.height};

            ring.setAttribute("viewBox", "0 0 " + boxW + " " + boxH);
            ring.style.left = -padX + "px";
            ring.style.top = -padY + "px";
            ring.style.width = boxW + "px";
            ring.style.height = boxH + "px";

            ring.querySelectorAll("path").forEach(function (path) {
              let axis = 0;
              path.setAttribute(
                "d",
                path.getAttribute("d").replace(/-?[0-9]*[.]?[0-9]+/g, function (number) {
                  const scaled = parseFloat(number) * (axis++ % 2 === 0 ? sx : sy);
                  return scaled.toFixed(2);
                })
              );
            });
          });

          /* ---- the pan ---- */

          // Where the board has to sit for a given block to be in frame.
          //
          // The block is aligned near the TOP of the frame, not centred on it.
          // Centring looked right for a block that fills the screen and wrong
          // for every other one: a short scene floated in the middle with a
          // hole under it, and the previous scene's last line got sliced in
          // half by the top edge, which reads as a bug rather than as history.
          // Top-aligning leaves clean board below the pen — which is where the
          // next line is going, and how a page actually fills up.
          const view = ${FRAME_H};
          // Less than the gap between blocks, so the block above lands just
          // off the top of the frame instead of showing a clipped sliver of its
          // last line — which read as a rendering fault rather than as history.
          const headroom = 150;
          const travel = Math.max(0, chalk.scrollHeight - view);
          function restFor(index) {
            const block = document.getElementById("block-" + index);
            if (!block) return 0;
            return -Math.min(travel, Math.max(0, block.offsetTop - headroom));
          }

          const beats = [${panBeats}];
          let resting = restFor(0);
          tl.set(chalk, { y: resting }, 0);
          for (let i = 1; i < beats.length; i += 1) {
            const next = restFor(i);
            if (Math.abs(next - resting) < 1) continue;
            // The move lands just before the block's own ink starts, so the
            // pen is never writing while the board is still travelling.
            tl.fromTo(
              chalk,
              { y: resting },
              { y: next, duration: 0.8, ease: "power2.inOut" },
              Math.max(0, beats[i] - 0.5)
            );
            resting = next;
          }

          /* ---- the ink ---- */

${tweens.join("\n")}

          window.__timelines["root"] = tl;
          if (window.__hfForceTimelineRebind) window.__hfForceTimelineRebind();
        });
      </script>
    </div>
  </body>
</html>
`;
}
