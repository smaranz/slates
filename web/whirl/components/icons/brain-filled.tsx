import { createReactComponent } from "@tabler/icons-react";

/* Tabler ships no filled brain, and the filled stand-ins — database, bulb —
   read as storage or ideas rather than memory. So this is IconBrain's own
   silhouette: the three lobe circles per hemisphere that the outline is built
   from, grown to the outer edge of its 2px stroke the way Tabler's filled cuts
   are, then split down the middle by the seam that makes a brain a brain.
   Same 24 grid and the same 2–22 reach as IconPaletteFilled and the rest of
   the settings nav it sits in. */
export const IconBrainFilled = createReactComponent(
  "filled",
  "brain-filled",
  "IconBrainFilled",
  [
    [
      "path",
      {
        d: "M11.25 2.938A4.5 4.5 0 0 0 4.463 8.488A4.5 4.5 0 0 0 4.152 16.339A4.5 4.5 0 0 0 11.25 21.062L11.25 13.938A4.5 4.5 0 0 0 10.848 13.661A4.5 4.5 0 0 0 10.537 10.512A4.5 4.5 0 0 0 11.25 10.062Z",
        key: "svg-0",
      },
    ],
    [
      "path",
      {
        d: "M12.75 2.938A4.5 4.5 0 0 1 19.537 8.488A4.5 4.5 0 0 1 19.848 16.339A4.5 4.5 0 0 1 12.75 21.062L12.75 13.938A4.5 4.5 0 0 1 13.152 13.661A4.5 4.5 0 0 1 13.463 10.512A4.5 4.5 0 0 1 12.75 10.062Z",
        key: "svg-1",
      },
    ],
  ],
);
