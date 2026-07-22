// Public-release variant of copy-static.js: same static-asset copy, but
// deliberately never touches .env.local. A distributable build must not
// carry the maintainer's real GitHub OAuth Client Secret or NEXTAUTH_SECRET
// — anyone who downloaded the .exe would have them. It still needs *some*
// NEXTAUTH_SECRET for NextAuth to encrypt session cookies, so this generates
// a fresh random one at build time instead (unique per build, tied to no
// account). Without real GITHUB_ID/GITHUB_SECRET, "Sign in with GitHub" just
// won't work — everything else (anonymous browsing, search, install) does;
// anyone who wants login can set up their own OAuth App per the README.
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const root = path.join(__dirname, "..");
const standalone = path.join(root, ".next", "standalone");

fs.cpSync(path.join(root, ".next", "static"), path.join(standalone, ".next", "static"), { recursive: true });

const secret = crypto.randomBytes(32).toString("base64");
const envContent = `NEXTAUTH_SECRET=${secret}\nNEXTAUTH_URL=http://localhost:3000\n`;
fs.writeFileSync(path.join(standalone, ".env.production.local"), envContent, "utf8");

console.log("Copied static assets and generated a fresh NEXTAUTH_SECRET for this public build (no personal credentials included).");
