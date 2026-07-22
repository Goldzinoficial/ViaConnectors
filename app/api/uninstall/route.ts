import { uninstallConnector } from "@/lib/claudeCode";
import { getConnectorById } from "@/lib/registry";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const id = body?.id;
  const claudeBin = typeof body?.claudeBin === "string" ? body.claudeBin : undefined;

  if (typeof id !== "string") {
    return Response.json({ ok: false, message: "Missing connector id." }, { status: 400 });
  }

  const connector = await getConnectorById(id);
  if (!connector) {
    return Response.json({ ok: false, message: "Connector not found." }, { status: 404 });
  }

  const result = await uninstallConnector(connector, claudeBin);
  return Response.json(result, { status: result.ok ? 200 : 422 });
}
