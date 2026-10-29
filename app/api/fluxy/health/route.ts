// GET -> owner-only status: which free AIs are up, answers today per code.
import { PROVIDERS, hasKey } from "@/lib/config";
import { readSession, codeList } from "@/lib/session";
import { getStore, storeKind } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = readSession(req);
  if (!s || s.role !== "owner") return Response.json({ error: "not_granted" }, { status: 403 });
  let cooling = new Map<string, number>(), today: { label: string; provider: string; status: string; n: number }[] = [], storeError: string | null = null;
  try {
    const store = getStore();
    [cooling, today] = await Promise.all([store.coolingDown(), store.today()]);
  } catch (e) {
    storeError = (e as { message?: string })?.message || JSON.stringify(e).slice(0, 300);
  }
  return Response.json({
    store: storeKind(),
    storeError,
    providers: PROVIDERS.map((p) => ({
      id: p.id, models: p.models, hasKey: hasKey(p),
      coolingUntil: cooling.get(p.id as string) ? new Date(cooling.get(p.id as string)!).toISOString() : null,
    })),
    codes: codeList().map((c) => ({ label: c.label, role: c.role, cap: c.cap })),
    today,
  }, { headers: { "cache-control": "no-store" } });
}
