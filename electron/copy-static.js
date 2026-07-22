// Next's standalone output (server.js + a pruned node_modules) doesn't
// automatically include static assets or env files — the docs say to copy
// them in yourself after `next build`. Run this right after that build.
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });

// Personal-use build: carries your own already-configured OAuth secrets
// (GITHUB_ID/GITHUB_SECRET/NEXTAUTH_SECRET) into the packaged app so
// "Sign in with GitHub" works without setting them up again. Don't hand
// this .exe to anyone else — it has your credentials in it.
const envLocal = path.join(root, ".env.local");
if (fs.existsSync(envLocal)) {
  fs.copyFileSync(envLocal, path.join(standalone, ".env.local"));
  fs.copyFileSync(envLocal, path.join(standalone, ".env.production.local"));
}

console.log("Copied static assets" + (fs.existsSync(envLocal) ? " and .env.local" : "") + " into the standalone build.");
