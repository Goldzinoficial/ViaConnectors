import { listInstalledSources, listInstalledPluginRepos } from "@/lib/claudeCode";

export async function GET() {
  const [mcpSources, pluginRepos] = await Promise.all([listInstalledSources(), listInstalledPluginRepos()]);
  return Response.json({ mcpSources, pluginRepos });
}
