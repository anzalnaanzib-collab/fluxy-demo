// GET -> owner-only status: which free AIs are up, answers today per code.
import { PROVIDERS, hasKey } from "@/lib/config";
import { readSession, codeList } from "@/lib/session";
import { getStore, storeKind } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = readSession(req);
  if (!s || s.role !== "owner") return Response.json({ error: "not_granted" }, { status: 403 });
  const store = getStore();
  const [cooling, today] = await Promise.all([store.coolingDown(), store.today()]);
  return Response.json({
    store: storeKind(),
    providers: PROVIDERS.map((p) => ({
      id: p.id, models: p.models, hasKey: hasKey(p),
      coolingUntil: cooling.get(p.id) ? new Date(cooling.get(p.id)!).toISOString() : null,
    })),
    codes: codeList().map((c) => ({ label: c.label, role: c.role, cap: c.cap })),
    today,
  }, { headers: { "cache-control": "no-store" } });
}
