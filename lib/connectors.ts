export type ConnectorCategory = "plugin" | "mcp" | "skill";

export type ConnectorIcon =
  | "docs"
  | "design"
  | "reasoning"
  | "security"
  | "automation"
  | "cloud"
  | "database"
  | "chat";

export interface Connector {
  id: string;
  name: string;
  category: ConnectorCategory;
  icon: ConnectorIcon;
  owner: string;
  description: string;
  githubUrl: string;
  stars: number;
  trustScore: number;
  installed: boolean;
  readme: string;
}

export const connectors: Connector[] = [
  {
    id: "context7-mcp",
    name: "context7-mcp",
    category: "mcp",
    icon: "docs",
    owner: "upstash",
    description: "Real-time docs for libraries, right in your agent.",
    githubUrl: "https://github.com/upstash/context7",
    stars: 4200,
    trustScore: 98,
    installed: false,
    readme:
      "Fetches up-to-date documentation for libraries and frameworks directly into your AI agent's context, avoiding stale training-data answers.",
  },
  {
    id: "figma-mcp",
    name: "figma-mcp",
    category: "mcp",
    icon: "design",
    owner: "figma",
    description: "Bring Figma designs directly into code.",
    githubUrl: "https://github.com/figma/mcp",
    stars: 2800,
    trustScore: 94,
    installed: true,
    readme:
      "Reads Figma file structure, styles and components so your agent can translate a design directly into production code.",
  },
  {
    id: "reasoning-mcp",
    name: "reasoning-mcp",
    category: "mcp",
    icon: "reasoning",
    owner: "anthropic",
    description: "Chain-of-thought scratchpad for deep reasoning.",
    githubUrl: "https://github.com/anthropics/reasoning-mcp",
    stars: 1900,
    trustScore: 91,
    installed: false,
    readme:
      "Gives the agent a persistent scratchpad to work through multi-step problems before answering.",
  },
  {
    id: "sentinel-mcp",
    name: "sentinel-mcp",
    category: "mcp",
    icon: "security",
    owner: "snyk",
    description: "Scans dependencies and repos for known vulnerabilities.",
    githubUrl: "https://github.com/snyk/sentinel-mcp",
    stars: 3100,
    trustScore: 99,
    installed: false,
    readme:
      "Runs a vulnerability scan against a repository's dependency tree and reports known CVEs before you install anything.",
  },
  {
    id: "shell-runner",
    name: "shell-runner",
    category: "plugin",
    icon: "automation",
    owner: "continuedev",
    description: "Runs shell commands and scripts on your behalf.",
    githubUrl: "https://github.com/continuedev/shell-runner",
    stars: 950,
    trustScore: 88,
    installed: false,
    readme:
      "Executes shell commands requested by the agent inside a sandboxed working directory.",
  },
  {
    id: "cloudops-mcp",
    name: "cloudops-mcp",
    category: "mcp",
    icon: "cloud",
    owner: "vercel",
    description: "Manage cloud infra and deployments from your agent.",
    githubUrl: "https://github.com/vercel/cloudops-mcp",
    stars: 2200,
    trustScore: 96,
    installed: false,
    readme:
      "Lets the agent inspect and trigger deployments, environment variables and DNS records on your cloud provider.",
  },
  {
    id: "pgvector-mcp",
    name: "pgvector-mcp",
    category: "mcp",
    icon: "database",
    owner: "supabase",
    description: "Query and manage your database from the agent.",
    githubUrl: "https://github.com/supabase/pgvector-mcp",
    stars: 1400,
    trustScore: 93,
    installed: false,
    readme:
      "Exposes safe, read-scoped SQL queries against a Postgres database with pgvector support for embeddings.",
  },
  {
    id: "slack-connect",
    name: "slack-connect",
    category: "plugin",
    icon: "chat",
    owner: "slack",
    description: "Send messages and read channels from your agent.",
    githubUrl: "https://github.com/slackapi/slack-connect",
    stars: 1100,
    trustScore: 90,
    installed: false,
    readme:
      "Bridges your agent to Slack: read channel history and post messages with a scoped bot token.",
  },
  {
    id: "design-taste-skill",
    name: "design-taste-skill",
    category: "skill",
    icon: "design",
    owner: "anthropic",
    description: "Teaches the agent to critique and improve UI taste.",
    githubUrl: "https://github.com/anthropics/design-taste-skill",
    stars: 1600,
    trustScore: 95,
    installed: false,
    readme:
      "A skill file with heuristics for typography, spacing and color so the agent avoids templated-looking interfaces.",
  },
];

export function getConnector(id: string): Connector | undefined {
  return connectors.find((c) => c.id === id);
}
