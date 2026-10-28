"use client";
// Owner-only status page. Not linked from Fluxus. Shows which free AI is up and use per demo code.
import { useEffect, useState } from "react";

type Health = {
  store: string;
  providers: { id: string; models: Record<string, string>; hasKey: boolean; coolingUntil: string | null }[];
  codes: { label: string; role: string; cap: number }[];
  today: { label: string; provider: string; status: string; n: number }[];
};
const box: React.CSSProperties = { maxWidth: 820, margin: "0 auto", padding: "24px 16px" };
const cell: React.CSSProperties = { textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #46403e" };

export default function Owner() {
  const [h, setH] = useState<Health | null>(null);
  const [st, setSt] = useState<"loading" | "ok" | "denied" | "error">("loading");
  const load = async () => {
    setSt("loading");
    try {
      const r = await fetch("/api/fluxy/health", { cache: "no-store" });
      if (r.status === 401 || r.status === 403) return setSt("denied");
      if (!r.ok) return setSt("error");
      setH(await r.json()); setSt("ok");
    } catch { setSt("error"); }
  };
  useEffect(() => { load(); }, []);

  if (st === "loading") return <main style={box}><p>Loading…</p></main>;
  if (st === "denied") return <main style={box}><h1>Owner page</h1><p>Open <a style={{ color: "#66ffa3" }} href="/">Fluxy</a> and enter the <b>owner code</b> first, then come back here.</p></main>;
  if (st === "error" || !h) return <main style={box}><p>Couldn't load the status.</p><button onClick={load}>Try again</button></main>;
  const okToday = h.today.filter((t) => t.status === "ok").reduce((n, t) => n + t.n, 0);
  return (
    <main style={box}>
      <h1 style={{ marginTop: 0 }}>Fluxy status</h1>
      <p>Answers today: <b>{okToday}</b> · storage: {h.store === "supabase" ? "database" : "memory (resets on restart)"}</p>
      <h2>Free AIs (in the order Fluxy tries them)</h2>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr><th scope="col" style={cell}>AI</th><th scope="col" style={cell}>Key added</th><th scope="col" style={cell}>Status</th><th scope="col" style={cell}>Models</th></tr></thead>
        <tbody>{h.providers.map((p) => (
          <tr key={p.id}>
            <td style={cell}>{p.id}</td><td style={cell}>{p.hasKey ? "yes" : "no"}</td>
            <td style={cell}>{!p.hasKey ? "off" : p.coolingUntil ? `resting until ${new Date(p.coolingUntil).toLocaleString()}` : "ready"}</td>
            <td style={cell}>{Object.values(p.models).join(", ")}</td>
          </tr>))}</tbody>
      </table>
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
