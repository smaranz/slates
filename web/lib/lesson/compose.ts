import type { LessonGraph, LessonScript } from "./types";

/**
 * The HyperFrames composition for a lesson.
 *
 * HTML is the source of truth for the video: scenes are timed `.clip`
 * elements, a single paused GSAP timeline animates them, and the framework
 * owns playback and audio. The rules this file has to satisfy are HyperFrames'
 * own — every timeline registered on `window.__timelines`, no infinite
 * repeats, nothing built asynchronously, and entrances animated with
 * `gsap.from()` into the position CSS already puts them in.
 */

/** A beat of quiet before the voice starts, so a scene never opens mid-word. */
const LEAD_IN = 0.25;
/** How long the slide holds after the voice stops, so it doesn't cut dead. */
const TAIL = 0.6;
/** Overlap between neighbouring scenes — this is the crossfade. */
const CROSSFADE = 0.5;

/**
 * The Khan Academy look: chalk on a near-black board.
 *
 * Not Slates' own greys — those are tuned for a screen two feet away and read
 * as mud once H.264 has been at them. A teaching video wants a background dark
 * enough that a bright line is the only thing your eye can land on, which is
 * the whole reason Khan's videos are drawn on black.
 */
const THEME = {
  bg: "#0b0b0d",
  text: "#f4f4f5",
  muted: "#9a9aa2",
  accent: "#6fb1ff",
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

/**
 * Entrance eases, cycled so no two elements in a scene arrive the same way.
 * A scene where everything shares one ease reads as a slide deck, not motion.
 */
const EASES = ["expo.out", "power3.out", "power2.out", "back.out(1.4)"];

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

/**
 * Where every scene starts and how long it runs.
 *
 * Each scene is exactly as long as the sentence spoken over it, plus a lead-in
 * and a tail, and neighbours overlap by the crossfade. Nothing here is a fixed
 * "seconds per slide" — the voice sets the pace.
 */
export function planTimeline(timings: SceneTiming[]) {
  const scenes: { start: number; duration: number; audioStart: number }[] = [];
  let cursor = 0;

  for (const timing of timings) {
    const duration = LEAD_IN + timing.audioSeconds + TAIL;
    scenes.push({ start: t(cursor), duration: t(duration), audioStart: t(cursor + LEAD_IN) });
    cursor += duration - CROSSFADE;
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
 * runs — which matters, because HyperFrames reads the timeline synchronously
 * after load and anything built in a callback would miss the capture. Every
 * chrome affordance is off: this is a plot in a video, not a calculator
 * someone is going to click.
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

export function composeLesson(script: LessonScript, timings: SceneTiming[]): string {
  const plan = planTimeline(timings);

  // The title card is scene 0; the script's own scenes follow it.
  const slides = [
    { kind: "title" as const, heading: script.title, sub: script.subtitle, bullets: [] as string[] },
    ...script.scenes.map((scene) => ({
      kind: "content" as const,
      heading: scene.heading,
      sub: "",
      bullets: scene.bullets,
    })),
  ];

  const html: string[] = [];
  const tweens: string[] = [];
  const plots: string[] = [];

  slides.forEach((slide, i) => {
    const at = plan.scenes[i];
    const image = timings[i]?.imageFile;
    // Slide 0 is the title card, so scene N's graph is script.scenes[N - 1].
    const graph = i > 0 ? script.scenes[i - 1]?.graph : undefined;
    const art = graph || image;
    const id = `scene-${i}`;

    html.push(
      `      <div id="${id}" class="scene ${slide.kind}${art ? " has-art" : ""} clip" ` +
        `data-start="${at.start}" data-duration="${at.duration}" ` +
        // Alternating tracks so neighbouring scenes may overlap for the
        // crossfade; z-index (not the track) decides what paints on top.
        `data-track-index="${i % 2}" style="z-index: ${i + 1}">`
    );
    html.push(`        <div class="copy">`);

    if (slide.kind === "title") {
      html.push(`          <span class="eyebrow" id="${id}-eyebrow">Slates</span>`);
      html.push(`          <h1 class="title" id="${id}-heading">${escapeHtml(slide.heading)}</h1>`);
      html.push(`          <p class="subtitle" id="${id}-sub">${escapeHtml(slide.sub)}</p>`);
    } else {
      html.push(`          <h2 class="heading" id="${id}-heading">${escapeHtml(slide.heading)}</h2>`);
      if (slide.bullets.length) {
        html.push(`          <ul class="bullets">`);
        slide.bullets.forEach((bullet, b) => {
          html.push(
            `            <li class="bullet" id="${id}-b${b}"><span class="dot"></span><span>${escapeHtml(bullet)}</span></li>`
          );
        });
        html.push(`          </ul>`);
      }
    }

    html.push(`        </div>`);
    if (graph) {
      // Desmos draws into this node; it needs a real box before it mounts.
      html.push(`        <div class="art" id="${id}-art"><div class="graph" id="plot-${i}"></div></div>`);
      plots.push(plotCall(i, graph));
    } else if (image) {
      html.push(
        `        <div class="art" id="${id}-art"><img src="${escapeHtml(image)}" alt="" crossorigin="anonymous" /></div>`
      );
    }
    html.push(`      </div>`);

    /* ---- motion for this scene ---- */

    // Every scene after the first crossfades in over its predecessor, which is
    // still fully on screen. The transition is the outgoing scene's exit —
    // animating it out as well would leave an empty frame mid-fade.
    if (i > 0) {
      tweens.push(
        `        tl.from("#${id}", { opacity: 0, duration: ${CROSSFADE}, ease: "none" }, ${at.start});`
      );
    }

    // First entrance is offset from the scene's own start so it never lands on
    // the very first frame of the clip.
    const open = t(at.start + (i === 0 ? 0.2 : CROSSFADE * 0.5));

    if (slide.kind === "title") {
      tweens.push(
        `        tl.from("#${id}-eyebrow", { y: 24, opacity: 0, duration: 0.5, ease: "${EASES[2]}" }, ${open});`,
        `        tl.from("#${id}-heading", { y: 64, opacity: 0, duration: 0.8, ease: "${EASES[0]}" }, ${t(open + 0.15)});`,
        `        tl.from("#${id}-sub", { y: 36, opacity: 0, duration: 0.6, ease: "${EASES[1]}" }, ${t(open + 0.4)});`
      );
    } else {
      tweens.push(
        `        tl.from("#${id}-heading", { y: 48, opacity: 0, duration: 0.7, ease: "${EASES[0]}" }, ${open});`
      );
      slide.bullets.forEach((_, b) => {
        tweens.push(
          `        tl.from("#${id}-b${b}", { x: -40, opacity: 0, duration: 0.5, ease: "${EASES[(b % 3) + 1]}" }, ${t(open + 0.3 + b * 0.25)});`
        );
      });
      if (art) {
        tweens.push(
          `        tl.from("#${id}-art", { scale: 0.94, opacity: 0, duration: 0.8, ease: "${EASES[1]}" }, ${t(open + 0.2)});`
        );
      }
    }
  });

  // The one place an exit animation is allowed: the end of the last scene.
  const outro = t(plan.total - 0.6);
  tweens.push(
    `        tl.to("#scene-${slides.length - 1}", { opacity: 0, duration: 0.6, ease: "power2.in" }, ${outro});`
  );

  const audio = timings
    .map(
      (timing, i) =>
        `      <audio id="vo-${i}" data-start="${plan.scenes[i].audioStart}" ` +
        `data-duration="${t(timing.audioSeconds)}" data-track-index="${10 + i}" ` +
        // One track per line so a long tail can never collide with the next.
        `src="${escapeHtml(timing.audioFile)}" data-volume="1"></audio>`
    )
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(script.title)}</title>
${desmosTag(plots.length > 0)}
    <style>
      :root {
        --bg: ${THEME.bg};
        --text: ${THEME.text};
        --muted: ${THEME.muted};
        --accent: ${THEME.accent};
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: var(--bg);
        color: var(--text);
        font-family: "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
      }
      .scene {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        gap: 90px;
        width: 100%;
        height: 100%;
        padding: 110px 140px;
      }
      .copy {
        display: flex;
        flex: 1;
        flex-direction: column;
        justify-content: center;
        gap: 26px;
        min-width: 0;
      }
      /* A scene with a graph or picture gives it the right half and narrows the
         words to match. Without one, the text widens to carry the frame on its
         own — at the narrower measure it sat in the left third and left a hole. */
      .has-art .copy { flex: 0 0 50%; }
      .has-art .heading { max-width: 22ch; }
      .has-art .bullet { max-width: 30ch; }
      /* Desmos needs a laid-out box to mount into, so this is sized, not auto. */
      .graph {
        width: 100%;
        height: 660px;
        border-radius: 18px;
        overflow: hidden;
      }
      .art {
        display: flex;
        flex: 1;
        align-items: center;
        justify-content: center;
        min-width: 0;
      }
      .art img {
        max-width: 100%;
        max-height: 720px;
        border-radius: 24px;
        object-fit: contain;
      }
      .eyebrow {
        font-size: 30px;
        font-weight: 600;
        letter-spacing: 0.14em;
        text-transform: uppercase;
        color: var(--accent);
      }
      .title { margin: 0; font-size: 108px; font-weight: 700; line-height: 1.06; max-width: 20ch; }
      .subtitle { margin: 0; font-size: 42px; line-height: 1.35; color: var(--muted); max-width: 30ch; }
      .heading { margin: 0; font-size: 74px; font-weight: 700; line-height: 1.12; max-width: 30ch; }
      .bullets { margin: 14px 0 0; padding: 0; display: flex; flex-direction: column; gap: 22px; list-style: none; }
      .bullet { display: flex; align-items: flex-start; gap: 22px; font-size: 40px; line-height: 1.35; max-width: 46ch; }
      .dot {
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        margin-top: 15px;
        border-radius: 999px;
        background: var(--accent);
      }
    </style>
  </head>
  <body>
    <div
      data-composition-id="root"
      data-width="1920"
      data-height="1080"
      data-start="0"
      data-duration="${plan.total}"
    >
${html.join("\n")}

${audio}

      <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
      <script>
${plotHelper(plots)}
        window.__timelines = window.__timelines || {};
        const tl = gsap.timeline({ paused: true });

${tweens.join("\n")}

        window.__timelines["root"] = tl;
      </script>
    </div>
  </body>
</html>
`;
}
