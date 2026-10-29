// Small state: which AI is cooling down, rate-limit counters, answers per code.
// Uses Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set (shared
// across all server instances); otherwise keeps it in memory, which is fine
// for a small demo but resets when the server restarts.
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { ProviderId, Tier } from "./config";

export type UsageRow = {
  requestId: string; label: string; provider: ProviderId; model: string; tier: Tier;
  status: "ok" | "failed" | "fell_through"; inputTokens?: number; outputTokens?: number; errorCode?: string;
};

export interface Store {
  coolingDown(): Promise<Map<ProviderId, number>>;           // provider -> until (ms)
  coolDown(p: ProviderId, untilMs: number, reason: string): Promise<void>;
  hit(bucket: string): Promise<number>;                       // hits this minute
  answersToday(label: string): Promise<number>;
  record(u: UsageRow): Promise<void>;
  today(): Promise<{ label: string; provider: ProviderId; status: string; n: number }[]>;
  // Paid ledger (micro-dollars). reliable=false means paid AIs must stay off.
  reliable: boolean;
  paidReserve(r: { requestId: string; provider: ProviderId; model: string; label: string; tier: Tier; est: number; cap: number }): Promise<boolean>;
  paidSettle(requestId: string, provider: ProviderId, cost: number, inTok: number, outTok: number): Promise<void>;
  paidRelease(requestId: string, provider: ProviderId): Promise<void>;
  paidMonth(): Promise<{ total: number; byProvider: { provider: string; spent: number; answers: number }[] }>;
}

const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

type Ledger = { requestId: string; provider: ProviderId; status: "reserved" | "ok" | "released"; reserved: number; cost: number; at: number };
class MemoryStore implements Store {
  // Memory resets when the server restarts, so a cap kept here can't be trusted.
  reliable = process.env.FLUXY_ALLOW_PAID_WITHOUT_DB === "1";
  ledger: Ledger[] = [];
  private monthStart() { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); }
  private held() { const m = this.monthStart(); return this.ledger.filter((l) => l.at >= m).reduce((n, l) => n + l.cost + (l.status === "reserved" ? l.reserved : 0), 0); }
  async paidReserve(r: { requestId: string; provider: ProviderId; est: number; cap: number }) {
    if (this.ledger.some((l) => l.requestId === r.requestId && l.provider === r.provider)) return true;
    if (this.held() + r.est > r.cap) return false;
    this.ledger.push({ requestId: r.requestId, provider: r.provider, status: "reserved", reserved: r.est, cost: 0, at: Date.now() });
    return true;
  }
  async paidSettle(requestId: string, provider: ProviderId, cost: number) {
    const l = this.ledger.find((x) => x.requestId === requestId && x.provider === provider); if (l) { l.cost = cost; l.status = "ok"; }
  }
  async paidRelease(requestId: string, provider: ProviderId) {
    const l = this.ledger.find((x) => x.requestId === requestId && x.provider === provider && x.status === "reserved"); if (l) l.status = "released";
  }
  async paidMonth() {
    const m = this.monthStart(), by = new Map<string, { provider: string; spent: number; answers: number }>();
    for (const l of this.ledger) if (l.at >= m) {
      const e = by.get(l.provider) || { provider: l.provider, spent: 0, answers: 0 };
      e.spent += l.cost + (l.status === "reserved" ? l.reserved : 0); if (l.status === "ok") e.answers++; by.set(l.provider, e);
    }
    return { total: this.held(), byProvider: [...by.values()] };
  }
  cool = new Map<ProviderId, number>();
  hits = new Map<string, number>();
  rows: (UsageRow & { at: number })[] = [];
  async coolingDown() { return new Map([...this.cool].filter(([, t]) => t > Date.now())); }
  async coolDown(p: ProviderId, until: number) { this.cool.set(p, until); }
  async hit(bucket: string) {
    const k = `${bucket}|${Math.floor(Date.now() / 60000)}`;
    const n = (this.hits.get(k) || 0) + 1;
    this.hits.set(k, n);
    if (this.hits.size > 5000) this.hits.clear();
    return n;
  }
  async answersToday(label: string) {
    const t = startOfUtcDay();
    return this.rows.filter((r) => r.label === label && r.status === "ok" && r.at >= t).length;
  }
  async record(u: UsageRow) {
    this.rows.push({ ...u, at: Date.now() });
    if (this.rows.length > 20000) this.rows = this.rows.slice(-10000);
  }
  async today() {
    const t = startOfUtcDay(), m = new Map<string, { label: string; provider: ProviderId; status: string; n: number }>();
    for (const r of this.rows) if (r.at >= t) {
      const k = `${r.label}|${r.provider}|${r.status}`;
      const e = m.get(k) || { label: r.label, provider: r.provider, status: r.status, n: 0 };
      e.n++; m.set(k, e);
    }
    return [...m.values()];
  }
}

class SupabaseStore implements Store {
  reliable = true;
  constructor(private db: SupabaseClient) {}
  async paidReserve(r: { requestId: string; provider: ProviderId; model: string; label: string; tier: Tier; est: number; cap: number }) {
    const { data, error } = await this.db.rpc("paid_reserve", { req: r.requestId, prov: r.provider, mdl: r.model, lbl: r.label, tr: r.tier, est: r.est, cap: r.cap });
    if (error) throw error;
    return data === true;
  }
  async paidSettle(requestId: string, provider: ProviderId, cost: number, inTok: number, outTok: number) {
    const { error } = await this.db.rpc("paid_settle", { req: requestId, prov: provider, cost, inp: inTok, outp: outTok });
    if (error) throw error;
  }
  async paidRelease(requestId: string, provider: ProviderId) {
    const { error } = await this.db.rpc("paid_release", { req: requestId, prov: provider });
    if (error) throw error;
  }
  async paidMonth() {
    const [t, b] = await Promise.all([this.db.rpc("paid_month_micros"), this.db.rpc("paid_by_provider")]);
    if (t.error) throw t.error; if (b.error) throw b.error;
    return { total: Number(t.data || 0), byProvider: ((b.data || []) as { provider: string; spent_micros: number; answers: number }[]).map((r) => ({ provider: r.provider, spent: Number(r.spent_micros), answers: r.answers })) };
  }
  async coolingDown() {
    const { data, error } = await this.db.from("provider_cooldowns").select("provider,cooldown_until").gt("cooldown_until", new Date().toISOString());
    if (error) throw error;
    return new Map((data || []).map((r) => [r.provider as ProviderId, Date.parse(r.cooldown_until)]));
  }
  async coolDown(p: ProviderId, until: number, reason: string) {
    const { error } = await this.db.rpc("cool_down", { prov: p, until_ts: new Date(until).toISOString(), why: reason });
    if (error) throw error;
  }
  async hit(bucket: string) {
    const { data, error } = await this.db.rpc("hit_rate_limit", { b: bucket });
    if (error) throw error;
    return Number(data);
  }
  async answersToday(label: string) {
    const { data, error } = await this.db.rpc("answers_today", { lbl: label });
    if (error) throw error;
    return Number(data);
  }
  async record(u: UsageRow) {
    const { error } = await this.db.from("usage_events").upsert({
      request_id: u.requestId, code_label: u.label, provider: u.provider, model: u.model, tier: u.tier,
      status: u.status, input_tokens: u.inputTokens ?? null, output_tokens: u.outputTokens ?? null, error_code: u.errorCode ?? null,
    }, { onConflict: "request_id,provider" });
    if (error) throw error;
  }
  async today() {
    const { data, error } = await this.db.rpc("usage_today");
    if (error) throw error;
    return (data || []) as { label: string; provider: ProviderId; status: string; n: number }[];
  }
}

let store: Store | null = null;
export function getStore(): Store {
  if (store) return store;
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  store = url && key ? new SupabaseStore(createClient(url, key, { auth: { persistSession: false } })) : new MemoryStore();
  return store;
}
export const storeKind = () => (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY ? "supabase" : "memory");

// Only for tests.
export const _setStore = (s: Store | null) => { store = s; };
export { MemoryStore };
