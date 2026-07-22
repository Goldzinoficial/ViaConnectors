const OWNER_RE = /^[a-zA-Z0-9-]{1,39}$/;
const REPO_RE = /^[a-zA-Z0-9_.-]{1,100}$/;

function resolveRelativeLinks(markdown: string, baseDir: string): string {
  return markdown.replace(/\]\((?!https?:\/\/|data:|#|mailto:)([^)]+)\)/g, (_match, p1: string) => {
    const cleaned = p1.replace(/^\.\//, "");
    return `](${baseDir}${cleaned})`;
  });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const owner = searchParams.get("owner") ?? "";
  const repo = searchParams.get("repo") ?? "";

  if (!OWNER_RE.test(owner) || !REPO_RE.test(repo)) {
    return Response.json({ error: "Invalid owner or repo." }, { status: 400 });
  }

  const headers: HeadersInit = { Accept: "application/vnd.github+json" };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers });
  if (!res.ok) {
    return Response.json({ error: "Couldn't fetch the README for this repo." }, { status: res.status });
  }

  const data = (await res.json()) as { content: string; download_url: string | null };
  const decoded = Buffer.from(data.content, "base64").toString("utf-8");

  let content = decoded;
  if (data.download_url) {
    const baseDir = data.download_url.slice(0, data.download_url.lastIndexOf("/") + 1);
    content = resolveRelativeLinks(decoded, baseDir);
  }

  return Response.json({ content });
}
