// GET /api/fluxy/ads?q=coffee&countries=DE -> owner-only check that the live-ads lookup works.
// Visitors never call this: on research screens Fluxy looks up live ads on the server by itself.
import { readSession } from "@/lib/session";
import { searchLiveAds } from "@/lib/liveads";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = readSession(req);
  if (!s || s.role !== "owner") return Response.json({ error: "not_granted" }, { status: 403 });
  const u = new URL(req.url);
  const countries = (u.searchParams.get("countries") || "").split(",").filter(Boolean);
  const r = await searchLiveAds({ query: u.searchParams.get("q") || "", countries, limit: Number(u.searchParams.get("limit") || 8) });
  return Response.json(r, { status: r.ok ? 200 : r.error === "bad_request" ? 400 : r.error === "not_set_up" ? 503 : 502, headers: { "cache-control": "no-store" } });
}
