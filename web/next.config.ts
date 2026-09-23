import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The desktop build ships a Next server inside the .app bundle. Standalone
   * output emits a self-contained server plus only the dependencies it actually
   * traces, so the bundle doesn't have to carry the whole node_modules tree —
   * and doesn't depend on npm existing on the machine that runs it.
   */
  output: "standalone",
  /*
   * @cursor/sdk ships its own pre-bundled webpack chunks (numbered files plus
   * sidecar .LICENSE.txt banners). Bundling that through Turbopack too fails
   * on the .LICENSE.txt files; requiring it natively via Node sidesteps it.
   */
  /*
   * `pdfjs-dist` joins it for the same reason: the estimator reads a teacher's
   * PDF on the server, and Turbopack's bundling of pdf.mjs fails at runtime
   * there. Required natively, it works exactly as it does in a plain script.
   */
  serverExternalPackages: ["@cursor/sdk", "pdfjs-dist"],
  /*
   * pdf.js loads its worker by path at runtime, so dependency tracing never
   * sees it and the standalone build shipped `pdf.mjs` without
   * `pdf.worker.mjs` beside it. In the packaged app every attachment then
   * failed with "Setting up fake worker failed", silently falling back to
   * estimates made from titles. Named here so the trace carries it.
   */
  outputFileTracingIncludes: {
    "/api/estimate": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
  },
  // The floating dev-mode badge (route info, build activity) — off, not just
  // repositioned, so it never shows up over the composer or a card corner.
  devIndicators: false,
};

export default nextConfig;
