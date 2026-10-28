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
}

const startOfUtcDay = () => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); };

class MemoryStore implements Store {
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
  constructor(private db: SupabaseClient) {}
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
