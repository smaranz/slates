/* The moment every transform value sits at its default (rest pose: rotation
   a multiple of 360, scale exactly 1, y at 0), motion collapses the element's
   transform to "none" — and the browser swaps from its anti-aliased
   transformed-element rasterization to pixel-snapped untransformed rendering.
   That swap is the infamous one-pixel snap right as an animation settles.
   Baking a sub-pixel (invisible) scale into every transform keeps it
   permanently non-identity, so the element renders through the same
   rasterization path at rest and mid-animation alike. Pass as a
   `transformTemplate` to any motion element whose animation lands on the
   identity pose. */
const RASTER_PIN = "scale(1.0001)";

export const pinRasterPath = (_: unknown, generated: string) =>
  generated && generated !== "none" ? `${generated} ${RASTER_PIN}` : RASTER_PIN;

export const EASE_OUT = [0.22, 0.61, 0.36, 1] as const;

/* Opacity and transforms are compositor work — near-free. `filter` is not:
   any filter, blur(0) included, pins its element into its own render
   surface and keeps it there for as long as the property is set. Left
   behind after an entrance, that surface turns every later paint inside
   the subtree — a scroll, a hover pill, a streamed token — into a filtered
   re-rasterization of the whole layer, and it stops descendant
   backdrop-filters from rendering at all.

   So a blur entrance is only ever borrowed. Hand it back the moment it
   lands: `transitionEnd: SHED_BLUR`. `none` still interpolates as blur(0),
   so animating away from it later works unchanged. */
export const SHED_BLUR = { filter: "none" } as const;

/* The app's one entrance: a soft blur-fade with a short rise on a snappy,
   barely-overshooting spring. Elements sharing a view cascade by passing
   increasing delays — same motion, a beat apart — instead of each
   inventing its own scale/direction. Spread onto a motion element:
   `<motion.div {...rise(0.06)}>`. */
export const rise = (delay = 0) => ({
  initial: { opacity: 0, y: 10, filter: "blur(4px)" },
  animate: {
    opacity: 1,
    y: 0,
    filter: "blur(0px)",
    transitionEnd: SHED_BLUR,
  },
  transition: {
    opacity: { duration: 0.3, ease: EASE_OUT, delay },
    filter: { duration: 0.3, ease: EASE_OUT, delay },
    y: { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9, delay },
  },
  transformTemplate: pinRasterPath,
});

/* The same entrance for pane-sized surfaces — the transcript, the settings
   and store faces — minus the blur. A blur's cost scales with the area it
   covers, so a few pixels of radius over a whole pane is at once the most
   expensive thing in the frame and the least visible thing in the
   transition. The rise and the fade carry it; they cost nothing. */
export const paneRise = (delay = 0) => ({
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: {
    opacity: { duration: 0.3, ease: EASE_OUT, delay },
    y: { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.9, delay },
  },
  transformTemplate: pinRasterPath,
});

/* The flip a pane-sized face makes when its content swaps beneath a
   stationary frame: settings sections, store tabs, and the away face's own
   hop between the two. Quicker than `paneRise` — these happen in rapid
   succession and should feel like flipping, not arriving — and the exit is
   quicker still, so the incoming face isn't kept waiting. Spread onto the
   keyed child of a `mode="popLayout"` AnimatePresence. */
export const paneFlip = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: {
    opacity: 0,
    y: -6,
    transition: { duration: 0.1, ease: [0.4, 0, 1, 1] as const },
  },
  transition: {
    opacity: { duration: 0.18, ease: EASE_OUT },
    y: { type: "spring" as const, stiffness: 560, damping: 36, mass: 0.8 },
  },
  transformTemplate: pinRasterPath,
};
