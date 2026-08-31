import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /*
   * The desktop build ships a Next server inside the .app bundle. Standalone
   * output emits a self-contained server plus only the dependencies it actually
   * traces, so the bundle doesn't have to carry the whole node_modules tree —
   * and doesn't depend on npm existing on the machine that runs it.
   */
  output: "standalone",
};

export default nextConfig;
