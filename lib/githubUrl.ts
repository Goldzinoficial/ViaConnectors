const GITHUB_OWNER_RE = /^[a-zA-Z0-9-]{1,39}$/;
const GITHUB_REPO_RE = /^[a-zA-Z0-9_.-]{1,100}$/;

export function parseGithubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  if (!match) return null;
  const [, owner, repo] = match;
  if (!GITHUB_OWNER_RE.test(owner) || !GITHUB_REPO_RE.test(repo)) return null;
  return { owner, repo };
}
