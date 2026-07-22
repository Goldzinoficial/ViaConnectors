/**
 * githubClient.ts — Client-side GitHub API layer.
 *
 * Every call goes directly from the user's browser (Chrome) to
 * api.github.com. This means each user gets their own rate-limit
 * bucket (60 req/hr unauthenticated per IP, or 5 000 req/hr when
 * authenticated with their OAuth / personal token). The server is
 * never the bottleneck.
 *
 * An in-memory + localStorage cache avoids redundant calls entirely.
 */

import type { Connector, ConnectorCategory, ConnectorIcon } from "./connectors";

// ─── Token management ────────────────────────────────────────────
const TOKEN_KEY = "vc-github-token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string): void {
  if (typeof window === "undefined") return;
  if (token.trim()) {
    localStorage.setItem(TOKEN_KEY, token.trim());
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
}

/** Returns the best available token: session OAuth > stored PAT > null */
export function resolveToken(sessionToken?: string | null): string | null {
  return sessionToken || getStoredToken() || null;
}

// ─── Rate-limit status (observable from the UI) ──────────────────
export interface RateLimitInfo {
  remaining: number;
  limit: number;
  resetAt: Date;
  authenticated: boolean;
}

let lastRateInfo: RateLimitInfo | null = null;
export function getLastRateInfo(): RateLimitInfo | null {
  return lastRateInfo;
}

function updateRateInfo(res: Response, authenticated: boolean): void {
  const remaining = parseInt(res.headers.get("x-ratelimit-remaining") ?? "", 10);
  const limit = parseInt(res.headers.get("x-ratelimit-limit") ?? "", 10);
  const reset = parseInt(res.headers.get("x-ratelimit-reset") ?? "", 10);
  if (!isNaN(remaining) && !isNaN(limit)) {
    lastRateInfo = {
      remaining,
      limit,
      resetAt: new Date(reset * 1000),
      authenticated,
    };
  }
}

// ─── Caching layer ───────────────────────────────────────────────
const CACHE_PREFIX = "vc-gh-cache:";
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes — fine for a single README, refetched cheaply
// Discovery is deliberately slow (paced to respect GitHub's rate limit) and
// only grows, never goes stale in a way that matters here — a 15-minute
// TTL was throwing out a large, expensively-built list on every reload
// past that window and forcing a full re-crawl from scratch. A day is long
// enough to survive normal reload/revisit gaps without ever feeling "reset".
const DISCOVERY_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  ts: number;
}

function cacheGet<T>(key: string, ttlMs: number = CACHE_TTL_MS): T | null {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const entry: CacheEntry<T> = JSON.parse(raw);
    if (Date.now() - entry.ts > ttlMs) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function cacheSet<T>(key: string, data: T): void {
  try {
    const entry: CacheEntry<T> = { data, ts: Date.now() };
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));
  } catch {
    // localStorage full — silently ignore
  }
}

// ─── Core fetch wrapper ──────────────────────────────────────────
const TIMEOUT_MS = 10_000;

async function ghFetch(url: string, token: string | null): Promise<Response> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers, signal: controller.signal });
    updateRateInfo(res, !!token);
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Shared pacing for GitHub's Search API ────────────────────────
// The search endpoint's budget (10 req/min unauthenticated, 30/min
// authenticated) is enforced by GitHub per IP/token, no matter which
// feature in this app is asking — background discovery and interactive
// search share the same real budget.
//
// A fixed minimum gap between *every* call (the previous approach) forces
// an interactive search to queue behind whatever the background crawl is
// mid-wait on, even when the actual 60s budget has plenty of room — search
// ends up feeling laggy for no real reason. A sliding window is what
// GitHub itself is actually enforcing, so it's what we should enforce too:
// track the timestamps of the last calls, and let a new one through
// immediately whenever fewer than the limit happened in the past 60s.
// Background discovery paces itself far under that ceiling on its own, so
// in practice there's almost always room for a search to fire instantly.
const callTimestamps: number[] = [];

function throttledSearchFetch(url: string, token: string | null): Promise<Response> {
  const limit = token ? 28 : 9; // stay a couple under GitHub's 30/10 per-minute search budget
  const windowMs = 60_000;

  return new Promise((resolve, reject) => {
    const tryReserve = () => {
      const now = Date.now();
      while (callTimestamps.length && now - callTimestamps[0] > windowMs) {
        callTimestamps.shift();
      }
      if (callTimestamps.length < limit) {
        callTimestamps.push(now);
        ghFetch(url, token).then(resolve, reject);
      } else {
        const wait = windowMs - (now - callTimestamps[0]) + 50;
        setTimeout(tryReserve, wait);
      }
    };
    tryReserve();
  });
}

// ─── GitHub data types ───────────────────────────────────────────
interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: { login: string };
  description: string | null;
  html_url: string;
  stargazers_count: number;
  topics: string[];
  license: { key: string } | null;
  pushed_at: string;
  archived: boolean;
}

// ─── Mapping helpers (same logic as server-side) ─────────────────
const CATEGORY_TOPICS: Record<ConnectorCategory, string[]> = {
  mcp: ["mcp-server", "model-context-protocol", "mcp"],
  plugin: ["claude-code-plugin", "claude-code"],
  skill: ["claude-skill", "claude-code-skill", "agent-skill"],
};

// Repo authors describe what a thing actually IS in their own words far more
// reliably than GitHub topics — topics get copy-pasted, go stale, or get
// applied for reach across multiple tools. Graphify-Labs/graphify carries an
// "mcp" topic but its own description says "A /graphify skill for Claude
// Code, Cursor, Codex..." — installing it as an MCP server was never going
// to work. Checked before topics/name, since an explicit self-description
// beats a tag that may just mean "also touches MCP somehow".
const DESCRIPTION_PATTERNS: [RegExp, ConnectorCategory][] = [
  [/\bmcp server\b|\bmodel[- ]context[- ]protocol server\b/i, "mcp"],
  [/\/[\w-]+\s+skill\b|\bclaude(?:\s+code)?\s+skill\b|\bagent skill\b|\bskills? for claude\b/i, "skill"],
  [/\bclaude(?:\s+code)?\s+plugin\b|\bplugin for claude code\b/i, "plugin"],
];

function categorizeFromText(text: string): ConnectorCategory | null {
  for (const [pattern, category] of DESCRIPTION_PATTERNS) {
    if (pattern.test(text)) return category;
  }
  return null;
}

function categorize(repo: GitHubRepo): ConnectorCategory {
  const fromDescription = repo.description ? categorizeFromText(repo.description) : null;
  if (fromDescription) return fromDescription;

  const topics = repo.topics.map((t) => t.toLowerCase());
  if (topics.some((t) => CATEGORY_TOPICS.mcp.includes(t))) return "mcp";
  if (topics.some((t) => CATEGORY_TOPICS.skill.includes(t))) return "skill";

  // GitHub topics are applied inconsistently — plenty of skill/MCP repos
  // never get tagged with the exact strings above. The repo name is a much
  // more reliable signal for this ecosystem's naming conventions (e.g.
  // "xyz-skill", "claude-skill-xyz", "figma-mcp", "mcp-xyz").
  const name = repo.name.toLowerCase();
  if (/(^|[-_])mcp(s)?([-_]|$)/.test(name)) return "mcp";
  if (/(^|[-_])skills?([-_]|$)/.test(name)) return "skill";

  return "plugin";
}

function inferIcon(repo: GitHubRepo): ConnectorIcon {
  const text = `${repo.name} ${repo.description ?? ""} ${repo.topics.join(" ")}`.toLowerCase();
  if (/security|vuln|scan|snyk/.test(text)) return "security";
  if (/design|figma|ui|paint/.test(text)) return "design";
  if (/cloud|deploy|infra|vercel|aws/.test(text)) return "cloud";
  if (/database|sql|postgres|vector/.test(text)) return "database";
  if (/chat|slack|message|discord/.test(text)) return "chat";
  if (/reasoning|brain|think|llm/.test(text)) return "reasoning";
  if (/shell|automation|script|cli/.test(text)) return "automation";
  return "docs";
}

function trustScore(repo: GitHubRepo): number {
  let score = 60;
  if (repo.license) score += 15;
  if (!repo.archived) score += 5;
  const monthsSincePush =
    (Date.now() - new Date(repo.pushed_at).getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsSincePush < 3) score += 15;
  else if (monthsSincePush < 12) score += 5;
  if (repo.stargazers_count > 1000) score += 10;
  else if (repo.stargazers_count > 100) score += 5;
  return Math.min(99, score);
}

function toConnector(repo: GitHubRepo): Connector {
  return {
    id: repo.full_name.replace("/", "--"),
    name: repo.name,
    category: categorize(repo),
    icon: inferIcon(repo),
    owner: repo.owner.login,
    description: repo.description ?? "No description provided.",
    githubUrl: repo.html_url,
    stars: repo.stargazers_count,
    trustScore: trustScore(repo),
    installed: false,
    readme: repo.description ?? "No description provided.",
  };
}

// Repairs connectors cached before categorize() learned the name-based
// fallback — those were mapped from raw GitHub topics only, so anything
// that should've matched by name (e.g. "xyz-skill") got stuck defaulted
// to "plugin" and baked into the cache that way. Re-running the same
// name check against the already-cached name fixes it in place, so old
// cached volume doesn't have to be thrown away just to fix categorization.
const NAME_CATEGORY_PATTERNS: [RegExp, ConnectorCategory][] = [
  [/(^|[-_])mcp(s)?([-_]|$)/, "mcp"],
  [/(^|[-_])skills?([-_]|$)/, "skill"],
];

function reclassify(c: Connector): Connector {
  // Re-run the same description check fresh installs get — catches repos
  // that were mis-tagged straight from a misleading GitHub topic (like
  // graphify, cached as "mcp" from a topic even though it self-describes
  // as a skill) and not just the ones that fell through to the "plugin"
  // default.
  const fromDescription = categorizeFromText(c.description);
  if (fromDescription && fromDescription !== c.category) return { ...c, category: fromDescription };

  if (c.category !== "plugin") return c;
  const name = c.name.toLowerCase();
  for (const [pattern, category] of NAME_CATEGORY_PATTERNS) {
    if (pattern.test(name)) return { ...c, category };
  }
  return c;
}

// ─── Search repos by topic (client-side) ─────────────────────────
const ALL_TOPICS = [...new Set(Object.values(CATEGORY_TOPICS).flat())];
const PAGE_SIZE = 100;

// Each topic belongs to exactly one category (see CATEGORY_TOPICS above),
// so this lookup lets the discovery loop fetch the currently-selected tab's
// topics first instead of working through the fixed list in order.
const TOPIC_CATEGORY: Record<string, ConnectorCategory> = Object.fromEntries(
  Object.entries(CATEGORY_TOPICS).flatMap(([cat, topics]) =>
    topics.map((t) => [t, cat as ConnectorCategory])
  )
);

export interface DiscoveryProgress {
  loaded: number;
  topics: { topic: string; done: boolean }[];
  rateLimited: boolean;
  error: string | null;
}

/**
 * Fetches connectors from GitHub directly in the browser, forever — like
 * the server's own background loop (lib/github.ts), it never really
 * finishes: once every topic hits GitHub's 1000-result ceiling, it starts
 * a fresh pass over all of them to pick up newly created repos, so the
 * feed keeps growing for as long as the tab stays open. It only stops
 * outright if a full 15-minute-fresh cache already exists.
 *
 * Calls `onProgress` after every page with the connectors found so far
 * (always sorted by stars, highest first), so the UI can render cards as
 * they arrive. `priorityCategory.current` (if given) is read before each
 * topic pick, so switching tabs mid-discovery reprioritizes remaining
 * topics toward whatever category is on screen. On a real rate limit,
 * it waits exactly until GitHub's own reported reset time instead of a
 * guessed delay, then keeps going — it never gives up.
 */
export async function discoverConnectors(
  token: string | null,
  onProgress?: (progress: DiscoveryProgress, connectorsSoFar: Connector[]) => void,
  priorityCategory?: { current: ConnectorCategory }
): Promise<void> {
  // Check cache first. Reused as-is regardless of when it was written —
  // reclassify() below repairs any stale categorization in place instead of
  // needing a cache-key bump that would throw away everything discovered
  // so far and force a full slow re-crawl just to fix a few categories.
  const cacheKey = "discovery:" + (token ? "auth" : "anon");
  const cachedRaw = cacheGet<Connector[]>(cacheKey, DISCOVERY_CACHE_TTL_MS);
  if (cachedRaw && cachedRaw.length > 0) {
    const cached = cachedRaw.map(reclassify);
    onProgress?.(
      {
        loaded: cached.length,
        topics: ALL_TOPICS.map((t) => ({ topic: t, done: true })),
        rateLimited: false,
        error: null,
      },
      cached
    );
    return;
  }

  const seen = new Map<number, GitHubRepo>();
  const topicDone = new Map(ALL_TOPICS.map((t) => [t, false]));
  const topicPage = new Map(ALL_TOPICS.map((t) => [t, 1]));

  function pickNextTopic(): string | null {
    const wanted = priorityCategory?.current;
    if (wanted) {
      const match = ALL_TOPICS.find((t) => !topicDone.get(t) && TOPIC_CATEGORY[t] === wanted);
      if (match) return match;
    }
    return ALL_TOPICS.find((t) => !topicDone.get(t)) ?? null;
  }

  const sortedSoFar = () => [...seen.values()].map(toConnector).sort((a, b) => b.stars - a.stars);

  const emitProgress = (rateLimited: boolean, error: string | null = null) => {
    onProgress?.(
      {
        loaded: seen.size,
        topics: ALL_TOPICS.map((t) => ({ topic: t, done: topicDone.get(t)! })),
        rateLimited,
        error,
      },
      sortedSoFar()
    );
  };

  for (;;) {
    let topic = pickNextTopic();
    if (!topic) {
      // Every topic hit GitHub's 1000-result ceiling — start a fresh pass
      // instead of stopping, so newly created repos surface over time.
      for (const t of ALL_TOPICS) {
        topicDone.set(t, false);
        topicPage.set(t, 1);
      }
      topic = pickNextTopic()!;
    }

    const page = topicPage.get(topic)!;
    const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
      `topic:${topic} archived:false`
    )}&sort=stars&order=desc&per_page=${PAGE_SIZE}&page=${page}`;

    try {
      // Paced through the shared queue — see throttledSearchFetch above.
      const res = await throttledSearchFetch(url, token);

      if (res.status === 403 || res.status === 429) {
        emitProgress(true);
        // Wait exactly until GitHub's own reset time (falling back to 60s
        // if it didn't send one), then retry the same page — never give up.
        const resetAt = getLastRateInfo()?.resetAt;
        const wait = resetAt ? Math.max(2000, resetAt.getTime() - Date.now() + 1500) : 60_000;
        await new Promise((r) => setTimeout(r, wait));
        continue;
      }

      if (!res.ok) {
        topicDone.set(topic, true);
        emitProgress(false);
        continue;
      }

      const data = (await res.json()) as { items: GitHubRepo[]; total_count: number };
      for (const repo of data.items) {
        seen.set(repo.id, repo);
      }

      if (data.items.length < PAGE_SIZE || page >= 10) {
        topicDone.set(topic, true);
      } else {
        topicPage.set(topic, page + 1);
      }

      emitProgress(false);
      cacheSet(cacheKey, sortedSoFar());
    } catch (err) {
      topicDone.set(topic, true);
      emitProgress(false, err instanceof Error ? err.message : "Network error");
    }
  }
}

/**
 * Fetches one page (of each of a category's topics) directly — used both
 * for the tab-switch quick-fill (page 1) and for scrolling to the bottom
 * of the list (next page), so the feed can keep extending itself on
 * demand instead of only growing whenever the background loop happens to
 * get around to it. Paced through the same shared queue as background
 * discovery, so it never pushes the combined rate over GitHub's limit.
 * GitHub caps search at page 10 (1000 results) per topic — asking beyond
 * that 422s, so callers should stop paginating a topic once a page comes
 * back with fewer than PAGE_SIZE items or page 10 is reached.
 */
export async function fetchCategoryPage(
  category: ConnectorCategory,
  page: number,
  token: string | null
): Promise<Connector[]> {
  const seen = new Map<number, GitHubRepo>();
  await Promise.all(
    CATEGORY_TOPICS[category].map(async (topic) => {
      const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
        `topic:${topic} archived:false`
      )}&sort=stars&order=desc&per_page=${PAGE_SIZE}&page=${page}`;
      try {
        const res = await throttledSearchFetch(url, token);
        if (!res.ok) return;
        const data = (await res.json()) as { items: GitHubRepo[] };
        for (const repo of data.items) seen.set(repo.id, repo);
      } catch {
        // best-effort — a failed topic just means fewer results, not a hard error
      }
    })
  );

  return [...seen.values()].map(toConnector);
}

/** Quick top-starred fill for one category — just page 1 of fetchCategoryPage. */
export function quickFillCategory(category: ConnectorCategory, token: string | null): Promise<Connector[]> {
  return fetchCategoryPage(category, 1, token);
}

/**
 * Searches *all* of GitHub for `queryText` — no topic constraint. Our
 * curated topic list is what the background crawl uses to stay scoped to
 * the AI-connector ecosystem, but most repos out there are tagged
 * inconsistently, so requiring one of those exact topics made typed
 * searches come up empty for anything the crawl hadn't already tagged.
 * Each match still gets run through the same categorize() as everywhere
 * else, so it lands under the correct mcp/plugin/skill tab regardless of
 * which tab happened to be open when you searched.
 */
export async function searchConnectorsByText(
  queryText: string,
  token: string | null
): Promise<Connector[]> {
  const text = queryText.trim();
  if (!text) return [];

  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    `${text} in:name,description archived:false`
  )}&sort=stars&order=desc&per_page=${PAGE_SIZE}`;

  try {
    const res = await throttledSearchFetch(url, token);
    if (!res.ok) return [];
    const data = (await res.json()) as { items: GitHubRepo[] };
    return data.items.map(toConnector);
  } catch {
    return [];
  }
}

// ─── Fetch README (client-side, no server proxy) ─────────────────
// atob() decodes base64 into a Latin-1 "binary string" — one char per
// byte. GitHub's README content is UTF-8, so multi-byte sequences (emoji,
// accents, CJK) need re-decoding through TextDecoder, or they come out
// as mojibake.
function decodeBase64Utf8(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder("utf-8").decode(bytes);
}

function resolveRelativeLinks(markdown: string, baseDir: string): string {
  return markdown.replace(/\]\((?!https?:\/\/|data:|#|mailto:)([^)]+)\)/g, (_match, p1: string) => {
    const cleaned = p1.replace(/^\.\//, "");
    return `](${baseDir}${cleaned})`;
  });
}

export async function fetchReadme(
  owner: string,
  repo: string,
  token: string | null
): Promise<{ content: string | null; error: string | null }> {
  const cacheKey = `readme:${owner}/${repo}`;
  const cached = cacheGet<string>(cacheKey);
  if (cached) return { content: cached, error: null };

  try {
    const res = await ghFetch(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      token
    );

    if (!res.ok) {
      if (res.status === 403 || res.status === 429) {
        return { content: null, error: "GitHub rate limit reached. Sign in or add a token in Settings for higher limits." };
      }
      return { content: null, error: "Couldn't fetch the README for this repo." };
    }

    const data = (await res.json()) as { content: string; download_url: string | null };
    const decoded = decodeBase64Utf8(data.content);

    let content = decoded;
    if (data.download_url) {
      const baseDir = data.download_url.slice(0, data.download_url.lastIndexOf("/") + 1);
      content = resolveRelativeLinks(decoded, baseDir);
    }

    cacheSet(cacheKey, content);
    return { content, error: null };
  } catch {
    return { content: null, error: "Network error while fetching the README." };
  }
}

// ─── Cache management ────────────────────────────────────────────
export function clearCache(): void {
  if (typeof window === "undefined") return;
  const keys: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(CACHE_PREFIX)) keys.push(key);
  }
  keys.forEach((k) => localStorage.removeItem(k));
}
