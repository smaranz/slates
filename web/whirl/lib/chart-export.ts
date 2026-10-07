"use client";

import { formatChartValue, type ChartSpec } from "./chart-spec";

/* Downloading a chart as a picture.

   The card on screen is HTML wrapped around an SVG, and its colors are all
   custom properties and Tailwind classes — none of which survive being
   serialized, because a detached SVG has no stylesheet and no --series-1 to
   look up. So the export does two things: it bakes every live computed
   style onto a clone of the plot, and it rebuilds the chrome around it
   (title, legend, source, watermark) as real SVG, since that chrome lives
   in the DOM and would otherwise be left behind. What lands in the file is
   the whole card, not a naked plot. */

const SCALE = 2;
const PAD = 20;
const TITLE_SIZE = 15;
const SUB_SIZE = 12;
const LEGEND_SIZE = 12;
const FOOT_SIZE = 11;
const LINE_GAP = 6;
const MIN_WIDTH = 420;

/* A serialized SVG carries no stylesheet and so can't reach Inter, which the
   app loads through an @font-face rule. The export states the system stack
   it will actually fall back to instead.

   Single quotes around the multi-word family, not double: this string gets
   interpolated raw into `font-family="…"` when the chrome is built, and a
   double quote in there closes the attribute early and hands the browser
   markup it can only refuse to decode. */
const FONT = "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

export const WATERMARK = "Made by Whirl";

/* A serialized SVG carries no stylesheet, so anything wearing a class or a
   var() has to be baked on as an inline style first. */
const INLINE_PROPS = [
  "fill",
  "fill-opacity",
  "stroke",
  "stroke-width",
  "stroke-opacity",
  "stroke-dasharray",
  "stroke-linecap",
  "stroke-linejoin",
  "opacity",
  "font-size",
  "font-weight",
  "text-anchor",
  "dominant-baseline",
];

const COLOR_PROPS = new Set(["fill", "stroke"]);

function inlineStyles(live: Element, clone: Element) {
  const computed = window.getComputedStyle(live);
  const declarations = INLINE_PROPS.map((prop) => {
    const value = computed.getPropertyValue(prop);
    return `${prop}:${COLOR_PROPS.has(prop) ? toRgb(value) : value}`;
  });
  clone.setAttribute("style", `${declarations.join(";")};font-family:${FONT}`);
  clone.removeAttribute("class");

  // The clone is untouched at this point, so the two trees still line up.
  for (let i = 0; i < live.children.length; i += 1) {
    const cloneChild = clone.children[i];
    if (cloneChild) inlineStyles(live.children[i], cloneChild);
  }
}

/**
 * Turn a `var(--series-3)` into the color it actually stands for.
 *
 * The cloned plot doesn't need this — copying computed styles resolves
 * every var on the way — but the legend the export rebuilds is handed the
 * same `var()` strings the card renders with, and a detached SVG has no
 * custom properties to look them up in. Unwraps a few levels because the
 * Tailwind theme layer aliases one var to another.
 */
function resolveColor(value: string, scope: CSSStyleDeclaration): string {
  let current = value.trim();
  for (let depth = 0; depth < 4; depth += 1) {
    const match = /^var\(\s*(--[\w-]+)\s*\)$/.exec(current);
    if (!match) break;
    const next = scope.getPropertyValue(match[1]).trim();
    if (!next) break;
    current = next;
  }
  return toRgb(current);
}

/** Colors the rebuilt chrome needs, resolved to something a detached SVG
 *  can render — a probe in the live card turns oklch and var() into rgb. */
function readInk(card: HTMLElement): {
  background: string;
  ink: string;
  muted: string;
} {
  const probe = document.createElement("span");
  probe.className = "text-muted-foreground";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  card.appendChild(probe);
  const muted = window.getComputedStyle(probe).color;
  probe.remove();

  const cardStyle = window.getComputedStyle(card);
  return {
    background: toRgb(cardStyle.backgroundColor || "#ffffff"),
    ink: toRgb(cardStyle.color),
    muted: toRgb(muted),
  };
}

let measureContext: CanvasRenderingContext2D | null = null;

function scratch(): CanvasRenderingContext2D | null {
  measureContext ??= document.createElement("canvas").getContext("2d");
  return measureContext;
}

function textWidth(text: string, size: number, weight = 400): number {
  const context = scratch();
  if (!context) return text.length * size * 0.55;
  context.font = `${weight} ${size}px ${FONT}`;
  return context.measureText(text).width;
}

/* The app's ink is written in oklch, and getComputedStyle hands oklch back
   as oklch — a modern color in a file someone may open in anything. Canvas
   normalizes any color it understands to plain rgb, so the PNG's colors
   don't depend on what opens it. A color canvas can't parse leaves
   fillStyle untouched, which the sentinel catches: better the original
   value than silently inheriting the last one. */
function toRgb(color: string): string {
  const context = scratch();
  if (!context || !color) return color;
  const SENTINEL = "#123456";
  context.fillStyle = SENTINEL;
  context.fillStyle = color;
  const resolved = context.fillStyle;
  return resolved === SENTINEL && color !== SENTINEL ? color : resolved;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/* The chrome is built as real DOM and handed to XMLSerializer rather than
   concatenated into a string. Model-written titles and category names go
   into it verbatim, and so do resolved color values — one stray quote or
   ampersand in any of them and the whole file stops being XML, which the
   browser reports only as "the source image cannot be decoded". Letting the
   DOM do the escaping means it cannot happen. */
function svgNode(
  name: string,
  attributes: Record<string, string | number>,
  text?: string,
): SVGElement {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, String(value));
  }
  if (text !== undefined) node.textContent = text;
  return node;
}

function textNode(
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  { weight = 400, anchor = "start" } = {},
): SVGElement {
  return svgNode(
    "text",
    {
      x,
      y,
      "font-family": FONT,
      "font-size": size,
      "font-weight": weight,
      fill: color,
      "text-anchor": anchor,
    },
    text,
  );
}

type LegendEntry = { label: string; index: number; x: number; row: number };

/** Legend entries, wrapped into rows that fit the export's width. Each
 *  carries its own slot index — two categories can share a name, and
 *  looking the color up by label would hand them the same hue. */
function layoutLegend(labels: string[], width: number): LegendEntry[] {
  const SWATCH = 8;
  const GAP = 14;
  const entries: LegendEntry[] = [];
  let x = 0;
  let row = 0;
  labels.forEach((label, index) => {
    const entryWidth = SWATCH + 5 + textWidth(label, LEGEND_SIZE) + GAP;
    if (x > 0 && x + entryWidth > width) {
      row += 1;
      x = 0;
    }
    entries.push({ label, index, x, row });
    x += entryWidth;
  });
  return entries;
}

/**
 * Compose the whole card as one standalone SVG: the live plot with its
 * styles baked in, plus the chrome rebuilt around it.
 */
function buildExportSvg({
  plot,
  card,
  spec,
  colors,
}: {
  plot: SVGSVGElement;
  card: HTMLElement;
  spec: ChartSpec;
  colors: string[];
}): { markup: string; width: number; height: number } {
  const { background, ink, muted } = readInk(card);
  const scope = window.getComputedStyle(card);
  const swatches = colors.map((color) => resolveColor(color, scope));

  const clone = plot.cloneNode(true) as SVGSVGElement;
  inlineStyles(plot, clone);
  /* The entrance clip and the donut's sweep mask are mid-flight state, not
     part of the chart — a download taken a third of a second in would
     otherwise save a third of a chart. */
  for (const node of clone.querySelectorAll("[clip-path],[mask]")) {
    node.removeAttribute("clip-path");
    node.removeAttribute("mask");
  }
  for (const node of clone.querySelectorAll("defs,mask,clipPath")) {
    node.remove();
  }

  const plotWidth = plot.width.baseVal.value;
  const plotHeight = plot.height.baseVal.value;

  const legendLabels =
    spec.type === "pie"
      ? (spec.categories ?? [])
      : spec.series.map((series) => series.name);
  const showLegend = legendLabels.length >= 2;

  const contentWidth = Math.max(
    plotWidth,
    textWidth(spec.title, TITLE_SIZE, 600),
    MIN_WIDTH - PAD * 2,
  );
  const width = contentWidth + PAD * 2;

  const body: SVGElement[] = [];
  let y = PAD;

  y += TITLE_SIZE;
  body.push(textNode(spec.title, PAD, y, TITLE_SIZE, ink, { weight: 600 }));

  if (spec.subtitle) {
    y += LINE_GAP + SUB_SIZE;
    body.push(textNode(spec.subtitle, PAD, y, SUB_SIZE, muted));
  }

  // The plot keeps its own size and sits centered — a donut is much narrower
  // than the card, and shoving it left would read as a mistake.
  y += 14;
  const plotX = PAD + (contentWidth - plotWidth) / 2;
  const plotGroup = svgNode("g", {
    transform: `translate(${plotX} ${y})`,
  });
  // Moving the clone's children rather than serializing them keeps every
  // node in the SVG namespace, which an innerHTML round-trip does not.
  plotGroup.append(...Array.from(clone.childNodes));
  body.push(plotGroup);
  y += plotHeight;

  if (showLegend) {
    const entries = layoutLegend(legendLabels, contentWidth);
    y += 14;
    const pieValues = spec.series[0]?.values ?? [];
    for (const entry of entries) {
      const rowY = y + entry.row * (LEGEND_SIZE + 6);
      const cx = PAD + entry.x + 4;
      body.push(
        svgNode("circle", {
          cx,
          cy: rowY,
          r: 4,
          fill: swatches[entry.index] ?? muted,
        }),
      );
      const value = spec.type === "pie" ? pieValues[entry.index] : undefined;
      const label =
        value === null || value === undefined
          ? entry.label
          : `${entry.label}  ${formatChartValue(value, spec)}`;
      body.push(textNode(label, cx + 9, rowY + 4, LEGEND_SIZE, muted));
    }
    const rows = Math.max(...entries.map((entry) => entry.row)) + 1;
    y += rows * (LEGEND_SIZE + 6);
  }

  /* The footer: the source on the left where a caption belongs, the
     signature on the right where one belongs. */
  y += 16;
  if (spec.source) {
    body.push(textNode(spec.source, PAD, y, FOOT_SIZE, muted));
  }
  body.push(
    textNode(WATERMARK, width - PAD, y, FOOT_SIZE, muted, { anchor: "end" }),
  );

  const height = y + PAD - 4;

  // No explicit xmlns: the node is already in the SVG namespace, and
  // XMLSerializer writes the declaration itself — setting it by hand as
  // well gets it emitted twice, which stops the output being XML at all.
  const root = svgNode("svg", {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  });
  root.append(
    svgNode("rect", { width, height, fill: background }),
    ...body,
  );

  return {
    width,
    height,
    markup: new XMLSerializer().serializeToString(root),
  };
}

function fileName(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return `${slug || "chart"}.png`;
}

/**
 * Save the card as a PNG at 2×. Throws with a readable reason — the caller
 * turns it into a toast rather than letting a click do nothing.
 */
export async function downloadChartPng({
  plot,
  card,
  spec,
  colors,
}: {
  plot: SVGSVGElement;
  card: HTMLElement;
  spec: ChartSpec;
  colors: string[];
}): Promise<void> {
  const { markup, width, height } = buildExportSvg({
    plot,
    card,
    spec,
    colors,
  });

  // A blob URL is same-origin, so the canvas it's drawn into stays clean and
  // can actually be read back.
  const svgUrl = URL.createObjectURL(
    new Blob([markup], { type: "image/svg+xml;charset=utf-8" }),
  );

  try {
    const image = new Image();
    image.src = svgUrl;
    try {
      await image.decode();
    } catch {
      // The browser only ever says "the source image cannot be decoded",
      // which tells nobody anything. Say what it means instead.
      throw new Error("The chart didn't survive being turned into a picture.");
    }

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * SCALE);
    canvas.height = Math.ceil(height * SCALE);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("This browser wouldn't give up a canvas.");
    context.scale(SCALE, SCALE);
    context.drawImage(image, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) throw new Error("The image came back empty.");

    const pngUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = pngUrl;
    link.download = fileName(spec.title);
    link.click();
    // Give the click a beat to start the download before the URL goes away.
    setTimeout(() => URL.revokeObjectURL(pngUrl), 10_000);
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
