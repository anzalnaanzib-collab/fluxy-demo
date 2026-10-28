// GET -> is there a valid session? Used by the bridge to decide whether to show the code screen.
import { readSession } from "@/lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  const s = readSession(req);
  return Response.json(s ? { ok: true, role: s.role } : { ok: false }, { headers: { "cache-control": "no-store" } });
}
