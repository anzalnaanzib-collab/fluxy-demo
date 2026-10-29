// GET -> owner-only status: which free AIs are up, answers today per code.
import { PROVIDERS, hasKey, PAID_CAP_USD, usd } from "@/lib/config";
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
  let paid: { capUsd: number; spentUsd: number; on: boolean; why: string; byProvider: { provider: string; spentUsd: number; answers: number }[] } =
    { capUsd: PAID_CAP_USD, spentUsd: 0, on: false, why: "", byProvider: [] };
  try {
    const store = getStore();
    const m = await store.paidMonth();
    paid = { capUsd: PAID_CAP_USD, spentUsd: usd(m.total), on: PAID_CAP_USD > 0 && store.reliable,
      why: PAID_CAP_USD <= 0 ? "Monthly cap is 0, so paid AIs are off" : !store.reliable ? "Needs the database (Supabase) so spending is never forgotten" : "",
      byProvider: m.byProvider.map((b) => ({ provider: b.provider, spentUsd: usd(b.spent), answers: b.answers })) };
  } catch (e) { paid.why = "Ledger not set up yet: run supabase/paid.sql in Supabase. (" + String((e as { message?: string })?.message || e).slice(0, 120) + ")"; }
  return Response.json({
    paid,
    store: storeKind(),
    storeError,
    providers: PROVIDERS.map((p) => ({
      id: p.id, label: p.paid ? p.paid.label : p.id, paidPrice: p.paid ? `$${p.paid.inPerM} in / $${p.paid.outPerM} out per 1M tokens${p.paid.perCall ? ` + $${p.paid.perCall}/call` : ""}` : null, models: p.models, hasKey: hasKey(p),
      coolingUntil: cooling.get(p.id as string) ? new Date(cooling.get(p.id as string)!).toISOString() : null,
    })),
    codes: codeList().map((c) => ({ label: c.label, role: c.role, cap: c.cap })),
    today,
  }, { headers: { "cache-control": "no-store" } });
}
