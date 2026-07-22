import type { Connector, ConnectorCategory, ConnectorIcon } from "./connectors";

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

// GitHub's search API doesn't support OR between `topic:` qualifiers
// ("Logical operators only apply to text, not to qualifiers"), so each
// topic needs its own query — and each query is capped at 1000 results
// (10 pages of 100) no matter what. That's GitHub's real ceiling; there's
// no legitimate way around it.
const CATEGORY_TOPICS: Record<ConnectorCategory, string[]> = {
  mcp: ["mcp-server", "model-context-protocol", "mcp"],
  plugin: ["claude-code-plugin", "claude-code"],
  skill: ["claude-skill", "claude-code-skill", "agent-skill"],
};

const ALL_TOPICS = [...new Set(Object.values(CATEGORY_TOPICS).flat())];
const PAGE_SIZE = 100;
const REQUEST_TIMEOUT_MS = 8000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// GitHub can go quiet instead of returning a fast 403 once a client is
// under sustained abuse-prevention throttling — without a timeout, a single
// stuck request can stall the background loop for minutes.
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function githubHeaders(token?: string): HeadersInit {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

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

interface PageResult {
  items: GitHubRepo[];
  hasMore: boolean;
  cursor: string | null;
  rateLimited: boolean;
}

// REST search — used when there's no server token (GraphQL requires auth).
async function fetchTopicPageRest(topic: string, page: number): Promise<PageResult> {
  const url = `https://api.github.com/search/repositories?q=${encodeURIComponent(
    `topic:${topic} archived:false`
  )}&sort=stars&order=desc&per_page=${PAGE_SIZE}&page=${page}`;
  let res: Response;
  try {
    res = await fetchWithTimeout(url, { headers: githubHeaders(), cache: "no-store" });
  } catch {
    return { items: [], hasMore: false, cursor: null, rateLimited: true }; // timed out: treat like a rate limit
  }
  if (!res.ok) {
    if (res.status === 403 || res.status === 429) {
      return { items: [], hasMore: false, cursor: null, rateLimited: true };
    }
    throw new Error(`GitHub search failed for topic ${topic} page ${page}: ${res.status}`);
  }
  const data = (await res.json()) as { items: GitHubRepo[] };
  return { items: data.items, hasMore: data.items.length === PAGE_SIZE, cursor: null, rateLimited: false };
}

const SEARCH_REPOS_QUERY = `
  query($q: String!, $after: String) {
    search(query: $q, type: REPOSITORY, first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        ... on Repository {
          databaseId
          name
          nameWithOwner
          owner { login }
          description
          url
          stargazerCount
          licenseInfo { key }
          pushedAt
          isArchived
          repositoryTopics(first: 20) { nodes { topic { name } } }
        }
      }
    }
  }
`;

interface GraphQLRepoNode {
  databaseId: number;
  name: string;
  nameWithOwner: string;
  owner: { login: string };
  description: string | null;
  url: string;
  stargazerCount: number;
  licenseInfo: { key: string } | null;
  pushedAt: string;
  isArchived: boolean;
  repositoryTopics: { nodes: { topic: { name: string } }[] };
}

// GitHub's GraphQL API shares the same 1000-result-per-search ceiling as
// REST, but authenticated calls draw from a 5000-point/hour budget instead
// of a 30/min wall — reaches that real ceiling reliably instead of tripping
// the REST search rate limit halfway through.
async function fetchTopicPageGraphQL(topic: string, cursor: string | null, token: string): Promise<PageResult> {
  let res: Response;
  try {
    res = await fetchWithTimeout("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        query: SEARCH_REPOS_QUERY,
        variables: { q: `topic:${topic} archived:false`, after: cursor },
      }),
    });
  } catch {
    return { items: [], hasMore: false, cursor: null, rateLimited: true }; // timed out: treat like a rate limit
  }

  if (res.status === 403 || res.status === 429) {
    return { items: [], hasMore: false, cursor: null, rateLimited: true };
  }
  if (!res.ok) {
    throw new Error(`GitHub GraphQL search failed for topic ${topic}: ${res.status}`);
  }

  const json = (await res.json()) as {
    data?: { search: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GraphQLRepoNode[] } };
    errors?: { type?: string; message: string }[];
  };

  if (json.errors?.length) {
    const rateLimited = json.errors.some((e) => e.type === "RATE_LIMITED");
    if (rateLimited) return { items: [], hasMore: false, cursor: null, rateLimited: true };
    throw new Error(`GitHub GraphQL search errored for topic ${topic}: ${json.errors[0].message}`);
  }

  const search = json.data!.search;
  const items: GitHubRepo[] = search.nodes.map((n) => ({
    id: n.databaseId,
    name: n.name,
    full_name: n.nameWithOwner,
    owner: { login: n.owner.login },
    description: n.description,
    html_url: n.url,
    stargazers_count: n.stargazerCount,
    topics: n.repositoryTopics.nodes.map((t) => t.topic.name),
    license: n.licenseInfo,
    pushed_at: n.pushedAt,
    archived: n.isArchived,
  }));

  return { items, hasMore: search.pageInfo.hasNextPage, cursor: search.pageInfo.endCursor, rateLimited: false };
}

// --- Continuous background discovery ---
//
// Instead of fetching on a user's request (which makes someone wait) or on
// a periodic timer (which bursts a batch of requests all at once), a single
// background loop ticks forever: one topic, one page, one request, then a
// pause — safely under GitHub's per-minute limit by a wide margin — forever.
// Every tick immediately updates the shared in-memory map, so requests to
// the app always read an instantly-available, ever-growing snapshot and
// never wait on GitHub. When every topic has been paged to its end (GitHub's
// real 1000-result-per-topic ceiling, or fewer if that topic has less),
// the whole cycle quietly restarts to pick up newly created repos over time.
const discovered = new Map<number, GitHubRepo>();
let lastTickAt = 0;

interface TopicState {
  cursor: string | null;
  page: number;
  exhausted: boolean;
}
const topicState = new Map<string, TopicState>(
  ALL_TOPICS.map((t) => [t, { cursor: null, page: 1, exhausted: false }])
);
let topicCursorIndex = 0;

function nextTopic(): string {
  for (let i = 0; i < ALL_TOPICS.length; i++) {
    const idx = (topicCursorIndex + i) % ALL_TOPICS.length;
    if (!topicState.get(ALL_TOPICS[idx])!.exhausted) {
      topicCursorIndex = (idx + 1) % ALL_TOPICS.length;
      return ALL_TOPICS[idx];
    }
  }
  // Every topic hit its end — start a fresh cycle so new repos surface over time.
  for (const state of topicState.values()) {
    state.exhausted = false;
    state.cursor = null;
    state.page = 1;
  }
  topicCursorIndex = 1 % ALL_TOPICS.length;
  return ALL_TOPICS[0];
}

async function tick(serverToken: string | undefined): Promise<{ rateLimited: boolean }> {
  const topic = nextTopic();
  const state = topicState.get(topic)!;

  const result = serverToken
    ? await fetchTopicPageGraphQL(topic, state.cursor, serverToken)
    : await fetchTopicPageRest(topic, state.page);

  if (result.rateLimited) return { rateLimited: true };

  for (const repo of result.items) discovered.set(repo.id, repo);
  lastTickAt = Date.now();

  // GitHub's search endpoint 422s past page 10 (its hard 1000-result-per-query
  // ceiling) — cap here too, matching the client-side loop's own check.
  if (result.hasMore && state.page < 10) {
    state.cursor = result.cursor;
    state.page += 1;
  } else {
    state.exhausted = true;
  }
  return { rateLimited: false };
}

let backgroundLoopStarted = false;

export function startBackgroundDiscovery(): void {
  const g = globalThis as unknown as { __vcDiscoveryStarted?: boolean };
  if (g.__vcDiscoveryStarted || backgroundLoopStarted) return;
  g.__vcDiscoveryStarted = true;
  backgroundLoopStarted = true;

  const serverToken = process.env.GITHUB_TOKEN;
  // GraphQL's 5000 pts/hour budget comfortably allows a tick every few
  // seconds; unauthenticated REST search is capped at 10 req/min, so pace
  // well under that instead.
  const normalDelayMs = serverToken ? 3000 : 7000;
  const rateLimitBackoffMs = 60_000;

  (async function loop() {
    for (;;) {
      let delay = normalDelayMs;
      try {
        const { rateLimited } = await tick(serverToken);
        if (rateLimited) delay = rateLimitBackoffMs;
      } catch (err) {
        console.error("Background GitHub discovery tick failed:", err);
      }
      await sleep(delay);
    }
  })();
}

export function getCachedConnectors(): Connector[] {
  return [...discovered.values()].map(toConnector);
}

export function getDiscoveryStatus(): { count: number; lastTickAt: number } {
  return { count: discovered.size, lastTickAt };
}

// The connector detail page looks a repo up by id here first, but most
// cards on screen were found by the *client's own* discovery (much faster
// and further along than this server-side loop) and were never seen by
// this process. Rather than 404 on every repo this loop hasn't reached yet,
// fetch that one repo directly — the plain repo endpoint, not search, so it
// draws from the much bigger core rate-limit budget instead of the 10-30/min
// search one.
export async function fetchConnectorById(id: string): Promise<Connector | null> {
  const sep = id.indexOf("--");
  if (sep === -1) return null;
  const owner = id.slice(0, sep);
  const repo = id.slice(sep + 2);

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  try {
    const res = await fetchWithTimeout(url, {
      headers: githubHeaders(process.env.GITHUB_TOKEN),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const repoData = (await res.json()) as GitHubRepo;
    return toConnector(repoData);
  } catch {
    return null;
  }
}
