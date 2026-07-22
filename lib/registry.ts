import { connectors as mockConnectors, type Connector } from "./connectors";
import { getCachedConnectors, fetchConnectorById } from "./github";
import { listInstalledSources, parseGithubUrl } from "./claudeCode";

export async function getAllConnectors(): Promise<Connector[]> {
  const live = getCachedConnectors();
  const connectors = live.length > 0 ? live : mockConnectors;

  const installedSources = await listInstalledSources();
  if (installedSources.length === 0) return connectors;

  return connectors.map((c) => {
    if (c.category !== "mcp") return c;
    const repoInfo = parseGithubUrl(c.githubUrl);
    if (!repoInfo) return c;
    const slug = `${repoInfo.owner}/${repoInfo.repo}`.toLowerCase();
    const installed = installedSources.some((s) => s.toLowerCase().includes(slug));
    return installed ? { ...c, installed: true } : c;
  });
}

export async function getConnectorById(id: string): Promise<Connector | undefined> {
  const all = await getAllConnectors();
  const found = all.find((c) => c.id === id);
  if (found) return found;

  // Not (yet) in this server's own discovery pool — most cards on screen
  // were found by the browser's own faster crawl instead. Fetch it directly.
  const fetched = await fetchConnectorById(id);
  return fetched ?? undefined;
}
