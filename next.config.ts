import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundles a minimal, self-contained server (server.js + pruned
  // node_modules) instead of requiring the full project + node_modules at
  // runtime — this is what gets packaged into the Electron app.
  output: "standalone",
};

export default nextConfig;
