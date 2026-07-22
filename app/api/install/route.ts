import { installConnector } from "@/lib/claudeCode";
import { getConnectorById } from "@/lib/registry";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  const platform = body?.platform;
  const claudeBin = typeof body?.claudeBin === "string" ? body.claudeBin : undefined;

  if (typeof id !== "string") {
    return Response.json({ ok: false, message: "Missing connector id." }, { status: 400 });
  }
  if (platform !== "claude-code") {
    return Response.json(
      { ok: false, message: "Only Claude Code is supported right now — check Settings." },
      { status: 400 }
    );
  }

  const connector = await getConnectorById(id);
  if (!connector) {
    return Response.json({ ok: false, message: "Connector not found." }, { status: 404 });
  }

  const result = await installConnector(connector, claudeBin);
  return Response.json(result, { status: result.ok && result.verified !== false ? 200 : result.ok ? 207 : 422 });
}
