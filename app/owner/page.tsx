"use client";
// Owner-only status page. Not linked from Fluxus. Shows which free AI is up and use per demo code.
import { useEffect, useState } from "react";

type Paid = { capUsd: number; spentUsd: number; on: boolean; why: string; byProvider: { provider: string; spentUsd: number; answers: number }[] };
type Health = {
  paid?: Paid;
  store: string;
  storeError?: string | null;
  providers: { id: string; label?: string; paidPrice?: string | null; models: Record<string, string>; hasKey: boolean; coolingUntil: string | null }[];
  codes: { label: string; role: string; cap: number }[];
  today: { label: string; provider: string; status: string; n: number }[];
};
const box: React.CSSProperties = { maxWidth: 820, margin: "0 auto", padding: "24px 16px" };
const cell: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #46403e" };

export default function Owner() {
  const [h, setH] = useState<Health | null>(null);
  const [st, setSt] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const [why, setWhy] = useState("");
  const [probe, setProbe] = useState<{ id: string; model?: string; ok: boolean; status: number; ms?: number; detail: string }[] | null>(null);
  const [probing, setProbing] = useState(false);
  const runProbe = async () => {
    setProbing(true); setProbe(null);
    try { const r = await fetch("/api/fluxy/probe", { method: "POST" }); const j = await r.json(); setProbe(j.results || []); }
    catch { setProbe([{ id: "all", ok: false, status: 0, detail: "Couldn't run the test" }]); }
    setProbing(false);
  };
  const load = async () => {
    setSt("loading");
    try {
      const r = await fetch("/api/fluxy/health", { cache: "no-store" });
      if (r.status === 401 || r.status === 403) return setSt("denied");
      if (!r.ok) { setWhy(`Server error ${r.status}: ${(await r.text()).slice(0, 200)}`); return setSt("error"); }
      setH(await r.json()); setSt("ok");
    } catch (e) { setWhy(String(e)); setSt("error"); }
  };
  useEffect(() => { load(); }, []);

  if (st === "loading") return <main style={box}><p>Loading…</p></main>;
  if (st === "denied") return <main style={box}><h1>Owner page</h1><p>Open <a style={{ color: "#66ffa3" }} href="/">Fluxy</a> and enter the <b>owner code</b> first, then come back here.</p></main>;
  if (st === "error" || !h) return <main style={box}><p>Couldn't load the status.</p><p style={{ fontFamily: "monospace", fontSize: 12 }}>{why}</p><p>Check your settings here: <a style={{ color: "#66ffa3" }} href="/api/fluxy/setup-check">settings check</a></p><button onClick={load}>Try again</button></main>;
  const okToday = h.today.filter((t) => t.status === "ok").reduce((n, t) => n + t.n, 0);
  return (
    <main style={box}>
      <h1 style={{ marginTop: 0 }}>Fluxy status</h1>
      {h.storeError && <p style={{ color: "#ff8a7a" }}>Database problem: {h.storeError}</p>}
      <p>Answers today: <b>{okToday}</b> · storage: {h.store === "supabase" ? "database" : "memory (resets on restart)"}</p>
      {h.paid && (
        <section aria-labelledby="paid-h">
          <h2 id="paid-h">Paid credits this month</h2>
          <p style={{ fontSize: 20 }}><b>${h.paid.spentUsd.toFixed(4)}</b> of ${h.paid.capUsd.toFixed(2)} cap
            {" "}<span style={{ color: h.paid.on ? "#66ffa3" : "#ffd47a" }}>· {h.paid.on ? "paid backups ON" : "paid backups OFF"}</span></p>
          <div role="meter" aria-label="Paid credits used" aria-valuemin={0} aria-valuemax={h.paid.capUsd} aria-valuenow={h.paid.spentUsd}
            style={{ height: 10, borderRadius: 999, background: "#2e2a29", overflow: "hidden", maxWidth: 480 }}>
            <div style={{ height: "100%", width: `${h.paid.capUsd ? Math.min(100, (h.paid.spentUsd / h.paid.capUsd) * 100) : 0}%`, background: h.paid.capUsd && h.paid.spentUsd / h.paid.capUsd > 0.8 ? "#ffd47a" : "#66ffa3" }} />
          </div>
          {h.paid.why && <p style={{ color: "#ffd47a" }}>{h.paid.why}</p>}
          {h.paid.byProvider.length > 0 && (
            <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
              <thead><tr><th scope="col" style={cell}>Paid AI</th><th scope="col" style={cell}>Spent</th><th scope="col" style={cell}>Answers</th></tr></thead>
              <tbody>{h.paid.byProvider.map((b) => (<tr key={b.provider}><td style={cell}>{b.provider}</td><td style={cell}>${b.spentUsd.toFixed(4)}</td><td style={cell}>{b.answers}</td></tr>))}</tbody>
            </table>)}
          <p style={{ color: "#bab2ac", fontSize: 13 }}>Paid AIs are only used after every free AI is out, and stop before the cap. "Test each AI" calls are tiny and not counted here.</p>
        </section>)}
      <h2>AIs (in the order Fluxy tries them: free first, then paid)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th scope="col" style={cell}>AI</th><th scope="col" style={cell}>Key added</th><th scope="col" style={cell}>Status</th><th scope="col" style={cell}>Models</th></tr></thead>
        <tbody>{h.providers.map((p) => (
          <tr key={p.id}>
            <td style={cell}>{p.label || p.id}{p.paidPrice ? <><br /><small style={{ color: "#bab2ac" }}>paid · {p.paidPrice}</small></> : null}</td><td style={cell}>{p.hasKey ? "yes" : "no"}</td>
            <td style={cell}>{!p.hasKey ? "off" : p.coolingUntil ? `resting until ${new Date(p.coolingUntil).toLocaleString()}` : "ready"}</td>
            <td style={cell}>{Object.values(p.models).join(", ")}</td>
          </tr>))}</tbody>
      </table>
      <h2>Test each AI</h2>
      <p style={{ color: "#bab2ac", fontSize: 13 }}>Sends a 3-word test question to each AI and shows exactly what it replied.</p>
      <button onClick={runProbe} disabled={probing} style={{ padding: "8px 14px", borderRadius: 999, border: 0, background: "#66ffa3", color: "#15151a", fontWeight: 700 }}>{probing ? "Testing…" : "Test each AI"}</button>
      {probe && (
        <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 12 }}>
          <thead><tr><th scope="col" style={cell}>AI</th><th scope="col" style={cell}>Result</th><th scope="col" style={cell}>Reply or error</th></tr></thead>
          <tbody>{probe.map((r) => (
            <tr key={r.id}><td style={cell}>{r.id}<br /><small style={{ color: "#bab2ac" }}>{r.model}</small></td>
              <td style={cell}>{r.ok ? "✅ working" : `❌ failed${r.status ? ` (${r.status})` : ""}`}</td>
              <td style={{ ...cell, fontFamily: "monospace", fontSize: 12, wordBreak: "break-word" }}>{r.detail}</td></tr>))}</tbody>
        </table>)}
      <h2>Demo codes</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th scope="col" style={cell}>Label</th><th scope="col" style={cell}>Answers today</th><th scope="col" style={cell}>Daily cap</th></tr></thead>
        <tbody>{h.codes.map((c) => (
          <tr key={c.label}><td style={cell}>{c.label}{c.role === "owner" ? " (owner)" : ""}</td>
            <td style={cell}>{h.today.filter((t) => t.label === c.label && t.status === "ok").reduce((n, t) => n + t.n, 0)}</td>
            <td style={cell}>{c.cap}</td></tr>))}</tbody>
      </table>
      <p style={{ color: "#bab2ac", fontSize: 13 }}>To add or remove a demo code, change FLUXY_DEMO_CODES in Vercel and redeploy.</p>
      <button onClick={load} style={{ marginTop: 8, padding: "8px 14px", borderRadius: 999, border: 0, background: "#66ffa3", color: "#15151a", fontWeight: 700 }}>Refresh</button>
    </main>
  );
}
