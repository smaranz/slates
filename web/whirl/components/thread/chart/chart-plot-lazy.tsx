"use client";

import { lazy, Suspense } from "react";

import type { ChartSpec } from "@whirl/lib/chart-spec";
import { plotHeight } from "./chart-data";

/* Recharts is the single biggest dependency in the thread bundle, and it
   draws exactly one thing: the inline chart card. Most conversations never
   contain a chart, but every page load used to pay for it up front — the
   chat home route shipped the whole plotting library before anyone had
   typed anything.

   So the plots load on demand. Suspense rather than next/dynamic's own
   `loading`, because the fallback needs the spec to size itself: these
   cards sit inside a streaming transcript, and a chart that grew into
   place after loading would shove the reply the reader is following. The
   placeholder reserves the exact box the real plot fills — chart-data.ts
   owns those numbers for both — so the swap moves nothing. */

const ChartPlotImpl = lazy(() =>
  import("./chart-plot").then((module) => ({ default: module.ChartPlot })),
);

export function ChartPlot(props: {
  spec: ChartSpec;
  colors: string[];
  /** Series highlighted from the legend — the rest recede. */
  activeSeries: number | null;
  /** Play the entrance. False on a cold mount, so re-opening a thread
   *  paints its charts at rest rather than replaying every one. */
  draw: boolean;
}) {
  return (
    <Suspense
      fallback={
        /* Mirrors the wrapper every branch of the real plot renders, so the
           card's height is identical before and after the chunk lands. */
        <div
          className="mt-3 w-full"
          style={{
            height: plotHeight(
              props.spec.type,
              props.spec.categories?.length ?? 0,
            ),
          }}
        />
      }
    >
      <ChartPlotImpl {...props} />
    </Suspense>
  );
}
