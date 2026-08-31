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
  serverExternalPackages: ["@cursor/sdk"],
};

export default nextConfig;
