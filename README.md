# ViaConnectors

Universal integration manager for Claude — discover, install, verify and
uninstall MCPs, plugins and skills from a single dashboard, in the browser or
through a native Windows desktop app.

No fixed catalog: everything is fetched live from GitHub, with a local cache
so browsing stays instant without hammering the API.

## What it does

### Live discovery

- Continuous topic-based GitHub search that never stops — as long as the tab
  stays open, the connector list keeps growing.
- Instant text search: typing finds anything right away, even things that
  weren't cached yet.
- Real infinite-scroll pagination that never locks up on rate limits —
  respects GitHub's limit with a sliding window and waits for the exact
  reset time the API itself reports when needed.
- Automatic classification between **MCP**, **Plugin** and **Skill** —
  doesn't blindly trust GitHub *topics* (which authors fill in however they
  like): reads the repo's description looking for phrases like *"MCP
  server"*, *"a /name skill"* or *"Claude Code plugin"* before falling back
  to the repo name as a last resort.

### Real installs, not just a pretty button

- **MCP**: before running anything, the app reads the repo's README looking
  for the real command the author documented — a ready-made `claude mcp add`
  line, an MCP client config JSON block, or the actual npm package link
  (important for monorepos, where the root package isn't the runnable one).
  Only falls back to guessing `npx -y <repo>` as a last resort — and if it
  can't find any reliable signal at all, it **refuses to install** instead of
  writing a broken entry into your config.
- **Plugin/Skill**: reads the repo's real `marketplace.json` to build the
  `plugin@marketplace` identifier correctly — instead of guessing that the
  plugin name and the marketplace name always match the repo name (in
  practice, they often don't).
- **Actually global scope**: installs with `--scope user`, available in
  every project — not stuck to whatever directory the process happened to
  run in.
- **Claude Desktop too**: when installing an MCP, the app mirrors the same
  config into Claude Desktop's `claude_desktop_config.json` (if it's
  installed on the machine), preserving any server that's already there.
- **Post-install verification**: after installing, it actually checks
  whether the MCP server connects or the plugin got registered — the button
  shows "Installed ⚠" with the reason instead of pretending success when the
  command merely exited without error but doesn't actually work.
- **Repos that aren't installable** (e.g. "awesome" lists, collections of
  many items with no single install target) are detected and rejected
  immediately, with a clear message, without attempting anything.
- **Third-party installers** (`pip`, `uv tool install`, `brew`,
  `curl | bash`, `irm | iex`) are detected in the README and shown as a
  copyable command — the app **never** runs remote scripts on its own, not
  even with a confirmation prompt. This is deliberate: downloading and
  running unreviewed code from any repository is the classic supply-chain
  attack pattern, and no "are you sure?" dialog actually fixes that problem.
- **Install location**: automatic (finds Claude Code on the machine) or
  manual, pointing at the right executable through the system's native file
  picker.
- **Uninstall**: a dedicated button that removes the plugin/skill or MCP
  server — on both sides, Claude Code and Claude Desktop.
- **Auto-detection on launch**: the app reads Claude Code's real
  configuration (`.claude.json`, `known_marketplaces.json`,
  `installed_plugins.json`) as soon as it loads, to mark everything you
  already have as "Installed" — even things never installed through this
  app.

### Login and account

- Real GitHub OAuth (Auth.js) to raise the search rate limit.
- Optional personal GitHub token in Settings, for faster background
  discovery.

### Desktop app

Packaged with Electron into a portable Windows `.exe` — no separately
installed Node.js required (uses Electron's own binary running as a plain
Node process to serve Next.js). Its own icon, occupied-port detection, a
diagnostic log file (useful since an app launched from a shortcut has no
console to print to).

## Running locally

```bash
npm install
cp .env.example .env.local   # fill in GITHUB_ID/SECRET and NEXTAUTH_SECRET
npm run dev
```

Open http://localhost:3000.

For GitHub login to work, create an OAuth App at
https://github.com/settings/developers with callback
`http://localhost:3000/api/auth/callback/github` and fill in `.env.local`.
`GITHUB_TOKEN` (optional) raises the connector search rate limit.

Actually installing MCPs/plugins/skills requires the `claude` CLI (Claude
Code) installed and on the PATH of the machine running the Next.js server.

## Building the desktop app (Windows)

```bash
npm run dist:win
```

Packages a portable `.exe` into `dist-electron/`. **Heads up**: this build
bakes your `.env.local` (real credentials) into the executable, so login
works without reconfiguring — don't hand that specific `.exe` to anyone
else. `dist-electron/` is in `.gitignore` for exactly this reason.

## Tests

```bash
npm test
```

## Architecture

- `app/` — pages (App Router): landing, `login`, `dashboard`,
  `connector/[id]`, `settings`
- `app/api/connectors` — lists connectors (real GitHub data, falls back to
  mock if the GitHub API fails/hits its rate limit)
- `app/api/install` — really installs a connector (MCP, plugin or skill)
- `app/api/uninstall` — uninstalls it, on both sides (Claude Code + Desktop)
- `app/api/installed` — what's already installed on the machine, to mark
  the right cards on load
- `app/api/pick-claude-file` — opens Windows' native file picker
- `app/api/auth/[...nextauth]` — GitHub OAuth via Auth.js
- `lib/github.ts` — fetches and maps GitHub repos to `Connector` (server-side
  background discovery loop)
- `lib/githubClient.ts` — the same search, but running in the browser
  (faster, local cache, instant search)
- `lib/claudeCode.ts` — all the real install/uninstall/verification logic
  via the Claude Code CLI, README command extraction, Claude Desktop
  mirroring
- `lib/registry.ts` — single source of connectors (GitHub + mock fallback)
- `lib/connectors.ts` — types and mock data (fallback)
- `lib/platforms.ts` — supported target platforms (today: Claude Code only)
- `components/` — reusable UI (header, cards, tabs/search, theme, icons,
  scroll-reveal, platform picker, install/uninstall button)
- `electron/` — desktop app packaging (main process, icon, static asset
  copy, after-pack hook)

See `docs/superpowers/specs/2026-07-12-viaconnectors-ui-shell-design.md`
for the interface design.

## Security

- No credentials are hardcoded in the code — everything comes from
  environment variables (`.env.local`, never committed).
- The app never automatically runs third-party remote scripts, even when it
  finds the command in a repo's README — it always shows it to you to copy
  and run yourself.
