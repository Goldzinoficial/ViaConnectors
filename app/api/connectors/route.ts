import { getAllConnectors } from "@/lib/registry";

export async function GET() {
  const connectors = await getAllConnectors();
  return Response.json(connectors);
}
