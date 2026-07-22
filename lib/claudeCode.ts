import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync } from "node:fs";
import type { Connector } from "./connectors";
import { parseGithubUrl } from "./githubUrl";

const execFileAsync = promisify(execFile);

const DEFAULT_CLAUDE_BIN = process.platform === "win32" ? "claude.cmd" : "claude";
// ponytail: Windows can't spawn .cmd shims without a shell (Node throws EINVAL
// otherwise), so shell:true is required here. To keep that safe, owner/repo
// are validated (in parseGithubUrl) against GitHub's own username/repo
// charset before they ever reach the shell — reject instead of escaping.
// The user-configurable CLI path (Settings) goes through the same shell,
// so it's validated the same way: plain path characters only, nothing a
// shell would treat as a separator or metacharacter.
const SAFE_BIN_PATH = /^[\w.\-:\\/ ]+$/;

function resolveClaudeBin(override?: string): string {
  const trimmed = override?.trim();
  if (trimmed && SAFE_BIN_PATH.test(trimmed)) return trimmed;
  return DEFAULT_CLAUDE_BIN;
}

export { parseGithubUrl };

function toMcpServerName(connector: Connector): string {
  return connector.name.replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase();
}

export interface InstallResult {
  ok: boolean;
  message: string;
  // Set once a post-install check actually ran. `undefined` means no check
  // was possible (never claim "working" without having looked); `false`
  // means the check ran and found a real problem — surfaced separately from
  // `ok` so "the add command succeeded" and "it's actually usable" don't
  // get collapsed into a single misleading green checkmark.
  verified?: boolean;
  // A foreign installer found in the README (see detectForeignInstallCommand)
  // when this app has no native way to install the connector itself. Shown
  // as a copy-to-clipboard command in the UI — deliberately never run by
  // this app, on purpose: it's an unreviewed remote command from whatever
  // repo happened to match a search, and running that automatically (even
  // behind a confirmation click) is the "curl | bash" supply-chain pattern.
  foreignCommand?: ForeignInstallHint;
}

// `npx -y github:owner/repo` only works if the repo itself is directly
// runnable from source — plenty of real MCP servers are TypeScript that
// needs a build step first, and only actually run via their *published*
// npm package (e.g. context7's repo is upstash/context7, but the runnable
// command is `npx @upstash/context7-mcp`, not `npx github:upstash/context7`).
// A repo that declares a "bin" in its package.json is normally published
// under that same package "name", so prefer that when we can see it.
//
// Returns null instead of guessing `github:owner/repo` when there's no real
// signal at all — some repos discovery tags "mcp" aren't a single runnable
// thing (e.g. ComposioHQ/awesome-claude-skills is a 30-skill index with no
// root package.json or bin), and writing a config entry for a guess with
// zero evidence just leaves a permanently-broken, un-debuggable server
// behind. No install beats a fake one.
async function resolveNpxSource(owner: string, repo: string, readme?: string | null): Promise<string | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/package.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const pkg = (await res.json()) as { name?: string; bin?: unknown };
      if (pkg.name && pkg.bin) return pkg.name;
    }
  } catch {
    // fall through to the README heuristic below
  }

  // Monorepos (context7, and plenty of others) publish the runnable MCP
  // server as a nested package that never shows up in the repo root's
  // package.json at all. Its real name is almost always linked from the
  // README instead — an npm badge or a "## Packages" list entry like
  // "[`@upstash/context7-mcp`](npmjs.com/package/@upstash/context7-mcp) - MCP server".
  if (readme) {
    for (const line of readme.split("\n")) {
      if (!/mcp/i.test(line)) continue;
      const match = line.match(/npmjs\.com\/package\/([^)\s]+)/);
      if (match) return decodeURIComponent(match[1]);
    }
  }

  return null;
}

// Node's spawn(file, args, {shell:true}) on Windows joins file+args into one
// command line for cmd.exe *without* quoting `file` itself — a bin path with
// a space (any custom path under "Program Files", or anywhere with a space
// in it) gets torn in half at that space and cmd tries to run only the first
// part. Quoting here is what actually makes spaced custom paths work; an
// unquoted "claude.cmd" default is untouched since it has nothing to quote.
function quoteForShell(value: string): string {
  return /\s/.test(value) && !value.startsWith('"') ? `"${value}"` : value;
}

function shellOpt() {
  // Explicit cwd instead of inheriting whatever directory the app happens
  // to be running from (which, for this app, is sometimes a path with a
  // space in it) — nothing here depends on cwd, so pin it somewhere neutral.
  return { shell: process.platform === "win32", cwd: homedir() };
}

function errStderr(err: unknown): string {
  return err && typeof err === "object" && "stderr" in err ? String((err as { stderr?: string }).stderr) : "";
}

async function fetchReadme(owner: string, repo: string): Promise<string | null> {
  for (const name of ["README.md", "readme.md", "Readme.md"]) {
    try {
      const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${name}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) return await res.text();
    } catch {
      // try the next filename
    }
  }
  return null;
}

interface ForeignInstallHint {
  command: string;
  platform: string;
}

// Not every repo speaks Claude Code's language — some ship their own
// installer instead: a pip/brew/go command, or a PowerShell/curl one-liner
// that pulls and runs a remote script. This app deliberately never runs
// that kind of command itself (fetching and executing an arbitrary,
// unreviewed remote script is exactly the "curl | bash" pattern that makes
// supply-chain attacks possible, regardless of how trustworthy any one repo
// looks) — but finding it and showing it beats leaving you to dig through
// the README yourself after a failed install.
function detectForeignInstallCommand(readme: string): ForeignInstallHint | null {
  const patterns = [
    /\birm\s+\S+\s*\|\s*iex\b/i,
    /\b(curl|wget)\s+\S+.*\|\s*(sh|bash|zsh)\b/i,
    /\bpipx?\s+install\s+\S/i,
    /\buv tool install\s+\S/i,
    /\bbrew install\s+\S/i,
    /\bgo install\s+\S/i,
  ];
  const fenceRe = /```(\w*)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = fenceRe.exec(readme))) {
    const [, lang, body] = match;
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (!patterns.some((p) => p.test(line))) continue;
      const platform =
        /powershell|ps1/i.test(lang) || /irm\s.*\|\s*iex/i.test(line)
          ? "Windows (PowerShell)"
          : /bash|sh|zsh/i.test(lang) || /\b(curl|wget)\b/i.test(line)
            ? "macOS/Linux (shell)"
            : "unspecified platform";
      return { command: line, platform };
    }
  }
  return null;
}

// "Awesome lists" (github.com/sindresorhus/awesome-style curated indexes)
// are a whole separate GitHub convention from installable tools — a
// hand-picked directory of links to *other* repos, with zero code of its
// own. hesreallyhim/awesome-claude-code and ComposioHQ/awesome-claude-skills
// are both this: real, useful pages to browse, but there is no single
// "install the list" command because the list isn't a thing you install.
// Catching this by name/description avoids a slow, doomed marketplace-add
// round-trip just to arrive at the same conclusion.
function isAwesomeListRepo(repo: { name: string; description: string }): boolean {
  if (/^awesome[-_]/i.test(repo.name)) return true;
  return /\b(awesome|curated|hand-picked)\b[^.]{0,40}\b(list|collection)\b/i.test(repo.description);
}

type McpRunCommand =
  | { kind: "stdio"; command: string; args: string[] }
  | { kind: "remote"; transport: "http" | "sse"; url: string };

// Almost every MCP server README shows a "add this to your MCP client config"
// JSON snippet (a `{ "mcpServers": { "name": { "command": ..., "args": [...] } } }`
// block, or a remote server's `{ "url": ... }`) — that's the author's own
// documented run command, and it catches cases a plain `npx -y <pkg>` guess
// can't: extra flags, non-npx runtimes (uvx, docker, a local build step),
// or a hosted server reachable only over HTTP/SSE with no local process at all.
function extractMcpRunCommand(readme: string, repo: string, connectorName: string): McpRunCommand | null {
  const blocks = [...readme.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const lowerRepo = repo.toLowerCase();
  const lowerConn = connectorName.toLowerCase();

  for (const block of blocks) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object") continue;

    const obj = parsed as Record<string, unknown>;
    const serversRaw = obj.mcpServers ?? obj.servers ?? obj;
    if (!serversRaw || typeof serversRaw !== "object") continue;

    const entries = Object.entries(serversRaw as Record<string, unknown>).filter(
      (e): e is [string, Record<string, unknown>] => typeof e[1] === "object" && e[1] !== null
    );
    if (entries.length === 0) continue;

    const [, entry] =
      entries.find(([key]) => key.toLowerCase() === lowerRepo) ??
      entries.find(([key]) => key.toLowerCase() === lowerConn) ??
      entries[0];

    if (typeof entry.url === "string") {
      const transport = entry.type === "sse" || entry.transport === "sse" ? "sse" : "http";
      return { kind: "remote", transport, url: entry.url };
    }
    if (typeof entry.command === "string") {
      const args = Array.isArray(entry.args) ? entry.args.filter((a): a is string => typeof a === "string") : [];
      return { kind: "stdio", command: entry.command, args };
    }
  }
  return null;
}

// The single most reliable signal there is: the repo author's own copy-paste
// `claude mcp add name -- command args...` line, straight from a fenced
// code block. Only trusted when it has the `--` separator the real CLI
// syntax requires — anything looser is more likely to misparse than help.
function extractClaudeMcpAddLine(readme: string): McpRunCommand | null {
  const blocks = [...readme.matchAll(/```(?:bash|sh|shell|txt|console)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  for (const block of blocks) {
    const line = block.split("\n").find((l) => /claude mcp add/.test(l));
    if (!line) continue;

    const tokens = line.match(/(?:[^\s"]+|"[^"]*")+/g);
    if (!tokens) continue;
    const addIdx = tokens.indexOf("add");
    const dashDashIdx = tokens.indexOf("--");
    if (addIdx === -1 || dashDashIdx === -1 || dashDashIdx <= addIdx) continue;

    const command = tokens[dashDashIdx + 1]?.replace(/^"|"$/g, "");
    const args = tokens
      .slice(dashDashIdx + 2)
      .map((t) => t.replace(/^"|"$/g, ""))
      .filter(Boolean);
    if (command) return { kind: "stdio", command, args };
  }
  return null;
}

function claudeDesktopConfigPath(): string {
  if (process.platform === "win32") {
    return join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  }
  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  return join(homedir(), ".config", "Claude", "claude_desktop_config.json");
}

// "Automatic" is supposed to mean generally available, not just wired into
// Claude Code — the separate Claude Desktop app reads its own config file
// and knows nothing about what Claude Code just did. Mirroring the same MCP
// entry there is the only way one click covers both. Best-effort and silent:
// only writes if Claude Desktop's own folder already exists (i.e. it's
// actually installed on this machine) — never creates it out of thin air.
async function mirrorMcpToClaudeDesktop(serverName: string, entry: Record<string, unknown>): Promise<void> {
  const configPath = claudeDesktopConfigPath();
  if (!existsSync(dirname(configPath))) return;
  try {
    const raw = await readFile(configPath, "utf8").catch(() => "{}");
    const config = (JSON.parse(raw || "{}") as { mcpServers?: Record<string, unknown> }) ?? {};
    config.mcpServers = { ...config.mcpServers, [serverName]: entry };
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
  } catch {
    // Malformed existing config, permissions, etc. — not worth failing the
    // install over; Claude Code's own copy already succeeded.
  }
}

async function unmirrorMcpFromClaudeDesktop(serverName: string): Promise<void> {
  const configPath = claudeDesktopConfigPath();
  if (!existsSync(configPath)) return;
  try {
    const raw = await readFile(configPath, "utf8");
    const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
    if (config.mcpServers && serverName in config.mcpServers) {
      delete config.mcpServers[serverName];
      await writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
    }
  } catch {
    // Malformed config or already gone — nothing more to do here.
  }
}

// `claude mcp add` reports success the moment the config entry is written —
// it doesn't mean the server actually starts and speaks the protocol. This
// runs the same health check `claude mcp get` does on demand, right after
// install, so a broken command (wrong package, missing runtime, bad args)
// shows up immediately instead of silently sitting there as a dead entry.
async function verifyMcpConnection(bin: string, serverName: string): Promise<boolean | undefined> {
  try {
    // A cold "npx -y <pkg>" has to resolve and cache the package from the
    // registry before it can even start speaking the protocol — 15s clipped
    // that first run short and reported a false "failed to connect" for a
    // server that connects fine a few seconds later. 45s covers a slow pull.
    const { stdout } = await execFileAsync(quoteForShell(bin), ["mcp", "get", serverName], {
      ...shellOpt(),
      timeout: 45000,
    });
    const statusLine = stdout.split("\n").find((l) => l.includes("Status:"));
    if (!statusLine) return undefined;
    return /✔|connected/i.test(statusLine);
  } catch {
    return undefined;
  }
}

async function installMcp(connector: Connector, bin: string): Promise<InstallResult> {
  const repoInfo = parseGithubUrl(connector.githubUrl);
  if (!repoInfo) {
    return { ok: false, message: "Couldn't determine the GitHub repo for this connector." };
  }
  const { owner, repo } = repoInfo;
  const serverName = toMcpServerName(connector);

  const readme = await fetchReadme(owner, repo);
  const documented = readme
    ? (extractClaudeMcpAddLine(readme) ?? extractMcpRunCommand(readme, repo, connector.name))
    : null;

  // `claude mcp add` defaults to "local" scope (tied to whatever directory
  // it happens to run in) — "-s user" is what actually makes an install
  // global/available everywhere, which is what "Automatic" is supposed to mean.
  let runArgs: string[];
  let desktopEntry: Record<string, unknown>;
  if (documented?.kind === "remote") {
    runArgs = ["mcp", "add", "--transport", documented.transport, "-s", "user", serverName, documented.url];
    desktopEntry = { type: documented.transport, url: documented.url };
  } else if (documented?.kind === "stdio") {
    runArgs = ["mcp", "add", "-s", "user", serverName, "--", documented.command, ...documented.args];
    desktopEntry = { command: documented.command, args: documented.args };
  } else {
    const source = await resolveNpxSource(owner, repo, readme);
    if (!source) {
      const hint = readme ? detectForeignInstallCommand(readme) : null;
      return {
        ok: false,
        message: hint
          ? `This isn't installable through Claude Code directly — the repo ships its own installer instead. Copy the command below and run it yourself.`
          : "Couldn't find a runnable MCP server here — no npm package and no install command documented in the README. This repo may not be a single installable MCP server (e.g. it could be a collection of multiple skills/tools instead).",
        foreignCommand: hint ?? undefined,
      };
    }
    runArgs = ["mcp", "add", "-s", "user", serverName, "--", "npx", "-y", source];
    desktopEntry = { command: "npx", args: ["-y", source] };
  }

  try {
    const { stdout, stderr } = await execFileAsync(quoteForShell(bin), runArgs, shellOpt());
    const [verified] = await Promise.all([
      verifyMcpConnection(bin, serverName),
      mirrorMcpToClaudeDesktop(serverName, desktopEntry),
    ]);
    const base = (stdout || stderr || "Installed.").trim();
    const message = verified === false ? `${base}\n⚠ Added, but the server failed to connect just now.` : base;
    return { ok: true, message, verified };
  } catch (err) {
    const stderr = errStderr(err);
    return { ok: false, message: stderr.trim() || (err instanceof Error ? err.message : String(err)) };
  }
}

async function uninstallMcp(connector: Connector, bin: string): Promise<InstallResult> {
  const serverName = toMcpServerName(connector);
  try {
    const { stdout, stderr } = await execFileAsync(
      quoteForShell(bin),
      ["mcp", "remove", serverName, "-s", "user"],
      shellOpt()
    );
    await unmirrorMcpFromClaudeDesktop(serverName);
    return { ok: true, message: (stdout || stderr || "Removed.").trim() };
  } catch (err) {
    const stderr = errStderr(err);
    return { ok: false, message: stderr.trim() || (err instanceof Error ? err.message : String(err)) };
  }
}

interface MarketplaceManifest {
  name: string;
  plugins: string[];
}

// `claude plugin marketplace add owner/repo` names the marketplace after the
// "name" field *inside* the repo's own .claude-plugin/marketplace.json — not
// after the repo string you passed in. thedotmack/claude-mem's manifest says
// "name": "thedotmack", so the real install id is "claude-mem@thedotmack",
// not the "claude-mem@claude-mem" a repo-name guess would produce. Reading
// the manifest ourselves (same path Claude Code itself resolves against)
// gets both halves of "plugin@marketplace" right instead of guessing.
async function fetchMarketplaceManifest(owner: string, repo: string): Promise<MarketplaceManifest | null> {
  try {
    const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/HEAD/.claude-plugin/marketplace.json`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { name?: string; plugins?: { name?: string }[] };
    const plugins = (json.plugins ?? []).map((p) => p.name).filter((n): n is string => Boolean(n));
    if (!json.name || plugins.length === 0) return null;
    return { name: json.name, plugins };
  } catch {
    return null;
  }
}

// A marketplace can list several plugins under different names — prefer one
// that actually matches this repo/connector over just grabbing the first.
function pickPluginName(manifest: MarketplaceManifest, repo: string, connectorName: string): string {
  const lowerRepo = repo.toLowerCase();
  const lowerConn = connectorName.toLowerCase();
  return (
    manifest.plugins.find((p) => p.toLowerCase() === lowerRepo) ??
    manifest.plugins.find((p) => p.toLowerCase() === lowerConn) ??
    manifest.plugins[0]
  );
}

// `claude plugin install` prints "✔ Successfully installed" the moment the
// command exits zero — that's the CLI's own claim, not independent proof.
// Reading its persisted state file back confirms the id actually landed
// there, catching the rare case where the process reported success but the
// write didn't stick (interrupted process, disk/permission issue, etc).
async function isPluginRegistered(pluginName: string, marketplaceName: string): Promise<boolean | undefined> {
  try {
    const raw = await readFile(join(homedir(), ".claude", "plugins", "installed_plugins.json"), "utf8");
    const installed = JSON.parse(raw) as InstalledPluginsFile;
    return `${pluginName}@${marketplaceName}` in (installed.plugins ?? {});
  } catch {
    return undefined;
  }
}

async function installPluginOrSkill(connector: Connector, bin: string): Promise<InstallResult> {
  const repoInfo = parseGithubUrl(connector.githubUrl);
  if (!repoInfo) {
    return { ok: false, message: "Couldn't determine the GitHub repo for this connector." };
  }
  const { owner, repo } = repoInfo;

  const quotedBin = quoteForShell(bin);
  const manifest = await fetchMarketplaceManifest(owner, repo);
  const marketplaceName = manifest?.name ?? repo;

  try {
    await execFileAsync(quotedBin, ["plugin", "marketplace", "add", `${owner}/${repo}`], shellOpt());
  } catch (err) {
    const stderr = errStderr(err);
    if (/already (exists|added|registered)/i.test(stderr)) {
      // Registered before (maybe stale, maybe from an earlier session) —
      // refresh it so the plugin list below reflects the repo's current state
      // instead of installing against a possibly out-of-date local cache.
      try {
        await execFileAsync(quotedBin, ["plugin", "marketplace", "update", marketplaceName], shellOpt());
      } catch {
        // Non-fatal — fall through and try the install anyway.
      }
    } else if (!manifest) {
      // No marketplace.json and the add itself failed — this repo isn't a
      // Claude Code plugin at all. Check whether it documents some other
      // install method before giving up outright.
      const readme = await fetchReadme(owner, repo);
      const hint = readme ? detectForeignInstallCommand(readme) : null;
      return {
        ok: false,
        message: hint
          ? `This isn't a Claude Code plugin — the repo ships its own installer instead. Copy the command below and run it yourself.`
          : stderr.trim() || "Couldn't add this repo as a plugin source.",
        foreignCommand: hint ?? undefined,
      };
    } else {
      return { ok: false, message: stderr.trim() || "Couldn't add this repo as a plugin source." };
    }
  }

  const pluginName = manifest ? pickPluginName(manifest, repo, connector.name) : repo;

  try {
    const { stdout, stderr } = await execFileAsync(
      quotedBin,
      ["plugin", "install", `${pluginName}@${marketplaceName}`],
      shellOpt()
    );
    const verified = await isPluginRegistered(pluginName, marketplaceName);
    const base = (stdout || stderr || "Installed.").trim();
    const message = verified === false ? `${base}\n⚠ The CLI reported success, but it isn't showing up as installed.` : base;
    return { ok: true, message, verified };
  } catch (err) {
    const stderr = errStderr(err);
    const message = stderr.trim() || (err instanceof Error ? err.message : String(err));
    return {
      ok: false,
      message: manifest
        ? message
        : `${message} — this repo's plugin name may differ from "${repo}"; check its README for the exact install command.`,
    };
  }
}

export async function installConnector(connector: Connector, claudeBin?: string): Promise<InstallResult> {
  const bin = resolveClaudeBin(claudeBin);

  if (isAwesomeListRepo({ name: connector.name, description: connector.description })) {
    return {
      ok: false,
      message:
        "This is a curated list of resources (an \"awesome list\"), not a single installable tool — there's nothing here to install directly. Open it on GitHub to browse and pick individual tools from it instead.",
    };
  }

  if (connector.category !== "mcp") return installPluginOrSkill(connector, bin);

  // Discovery tags a repo "mcp" from its GitHub topics/keywords, which is
  // just a popularity signal, not proof the repo *is* an MCP server —
  // affaan-m/ECC lists "mcp" among a dozen topics but is actually a full
  // Claude Code plugin (its own README says so: `/plugin install ecc@ecc`,
  // not `claude mcp add`). A real .claude-plugin/marketplace.json is the
  // same authoritative signal the CLI itself uses — trust that over the topic
  // tag, or `npx`-ing a plugin's CLI entrypoint as if it spoke MCP just hangs.
  const repoInfo = parseGithubUrl(connector.githubUrl);
  if (repoInfo) {
    const manifest = await fetchMarketplaceManifest(repoInfo.owner, repoInfo.repo);
    if (manifest) return installPluginOrSkill(connector, bin);
  }
  return installMcp(connector, bin);
}

// Mirrors installConnector's category dispatch, minus the safety net of a
// fresh manifest fetch — if it's already recorded as an installed plugin
// (checked directly below), uninstall it as one regardless of category.
export async function uninstallConnector(connector: Connector, claudeBin?: string): Promise<InstallResult> {
  const bin = resolveClaudeBin(claudeBin);
  const repoInfo = parseGithubUrl(connector.githubUrl);
  if (!repoInfo) {
    return { ok: false, message: "Couldn't determine the GitHub repo for this connector." };
  }

  const installedPlugin = await findInstalledPluginId(repoInfo.owner, repoInfo.repo);
  if (installedPlugin) return uninstallPlugin(installedPlugin, bin);
  if (connector.category === "mcp") return uninstallMcp(connector, bin);
  return { ok: false, message: "This doesn't look installed — nothing to remove." };
}

interface McpServerEntry {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
}

interface ClaudeConfig {
  mcpServers?: Record<string, McpServerEntry>;
  projects?: Record<string, { mcpServers?: Record<string, McpServerEntry> }>;
}

function entryToSource(entry: McpServerEntry): string {
  if (entry.url) return entry.url;
  return [entry.command, ...(entry.args ?? [])].filter(Boolean).join(" ");
}

// Reads Claude Code's own config file directly instead of shelling out to
// `claude mcp list` — that command health-checks every configured server
// over the network (several seconds), which made every dashboard load slow.
// A plain JSON read is near-instant and all we need is "is it registered".
export async function listInstalledSources(): Promise<string[]> {
  try {
    const raw = await readFile(join(homedir(), ".claude.json"), "utf8");
    const config = JSON.parse(raw) as ClaudeConfig;
    const cwd = process.cwd();
    const projectKeys = [cwd, cwd.replace(/\\/g, "/")];

    const buckets: Record<string, McpServerEntry>[] = [config.mcpServers ?? {}];
    for (const key of projectKeys) {
      const project = config.projects?.[key];
      if (project?.mcpServers) buckets.push(project.mcpServers);
    }

    return buckets.flatMap((servers) => Object.values(servers).map(entryToSource));
  } catch {
    return [];
  }
}

interface MarketplaceSource {
  source?: { source?: string; repo?: string };
}
interface InstalledPluginsFile {
  plugins?: Record<string, unknown[]>;
}

// Mirrors listInstalledSources() but for plugins/skills, which Claude Code
// tracks in two separate files instead of .claude.json: which marketplaces
// are known (and where each one's repo lives), and which "plugin@marketplace"
// ids are actually installed. Cross-referencing them gives the GitHub repo
// of every installed plugin whose marketplace is that repo itself — exactly
// the shape our own install flow creates, so a connector we installed
// earlier (or the person installed by hand, same convention) shows as
// installed here too.
export async function listInstalledPluginRepos(): Promise<string[]> {
  try {
    const pluginsDir = join(homedir(), ".claude", "plugins");
    const [marketRaw, installedRaw] = await Promise.all([
      readFile(join(pluginsDir, "known_marketplaces.json"), "utf8"),
      readFile(join(pluginsDir, "installed_plugins.json"), "utf8"),
    ]);
    const marketplaces = JSON.parse(marketRaw) as Record<string, MarketplaceSource>;
    const installed = JSON.parse(installedRaw) as InstalledPluginsFile;

    const installedMarketplaceNames = new Set(
      Object.keys(installed.plugins ?? {})
        .map((key) => key.split("@")[1])
        .filter(Boolean)
    );

    const repos: string[] = [];
    for (const [name, entry] of Object.entries(marketplaces)) {
      if (entry.source?.source === "github" && entry.source.repo && installedMarketplaceNames.has(name)) {
        repos.push(entry.source.repo);
      }
    }
    return repos;
  } catch {
    return [];
  }
}

// Same cross-reference as listInstalledPluginRepos, but for one specific
// repo, returning the exact "plugin@marketplace" id Claude Code has on
// record — a fresh manifest.json fetch could disagree with this if the repo
// changed since install, so uninstall needs what's *actually* registered.
async function findInstalledPluginId(owner: string, repo: string): Promise<string | null> {
  try {
    const pluginsDir = join(homedir(), ".claude", "plugins");
    const [marketRaw, installedRaw] = await Promise.all([
      readFile(join(pluginsDir, "known_marketplaces.json"), "utf8"),
      readFile(join(pluginsDir, "installed_plugins.json"), "utf8"),
    ]);
    const marketplaces = JSON.parse(marketRaw) as Record<string, MarketplaceSource>;
    const installed = JSON.parse(installedRaw) as InstalledPluginsFile;
    const targetRepo = `${owner}/${repo}`.toLowerCase();

    const marketplaceName = Object.entries(marketplaces).find(
      ([, entry]) => entry.source?.source === "github" && entry.source.repo?.toLowerCase() === targetRepo
    )?.[0];
    if (!marketplaceName) return null;

    return Object.keys(installed.plugins ?? {}).find((key) => key.endsWith(`@${marketplaceName}`)) ?? null;
  } catch {
    return null;
  }
}

async function uninstallPlugin(pluginId: string, bin: string): Promise<InstallResult> {
  try {
    const { stdout, stderr } = await execFileAsync(quoteForShell(bin), ["plugin", "uninstall", pluginId], shellOpt());
    return { ok: true, message: (stdout || stderr || "Removed.").trim() };
  } catch (err) {
    const stderr = errStderr(err);
    return { ok: false, message: stderr.trim() || (err instanceof Error ? err.message : String(err)) };
  }
}
