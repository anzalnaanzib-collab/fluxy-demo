// GET -> which settings are filled in on Vercel (yes/no only, never the values).
// Lets the owner spot a missing or mistyped setting without logging in.
import { codeList } from "@/lib/session";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const has = (k: string) => !!(process.env[k] && process.env[k]!.trim());

export async function GET() {
  const secret = process.env.FLUXY_SESSION_SECRET || "";
  let codes = { demo: 0, owner: false };
  try { const l = codeList(); codes = { demo: l.filter((c) => c.role === "viewer").length, owner: l.some((c) => c.role === "owner") }; } catch {}
  const checks = {
    FLUXY_SESSION_SECRET: secret.trim().length >= 32 ? "ok" : secret ? "too short (needs 32+ characters)" : "MISSING",
    FLUXY_DEMO_CODES: codes.demo > 0 ? `ok (${codes.demo} codes)` : has("FLUXY_DEMO_CODES") ? "filled but no valid codes (format CODE:Label:limit)" : "MISSING",
    FLUXY_OWNER_CODE: codes.owner ? "ok" : has("FLUXY_OWNER_CODE") ? "too short (needs 10+ characters)" : "MISSING",
    GEMINI_API_KEY: has("GEMINI_API_KEY") ? "ok" : "ok (optional, not added)",
    GROQ_API_KEY: has("GROQ_API_KEY") ? "ok" : "ok (optional, not added)",
    OPENROUTER_API_KEY: has("OPENROUTER_API_KEY") ? "ok" : "ok (optional, not added)",
    DATABASE: has("SUPABASE_URL") || has("SUPABASE_SERVICE_ROLE_KEY") ? (has("SUPABASE_URL") && has("SUPABASE_SERVICE_ROLE_KEY") ? "ok (Supabase in use)" : "half set: add both SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or remove both") : "ok (not used)",
    ANY_AI_KEY: ["GEMINI_API_KEY", "GROQ_API_KEY", "OPENROUTER_API_KEY"].some(has) ? "ok" : "MISSING (add at least one AI key)",
  };
  const allOk = Object.values(checks).every((v) => v.startsWith("ok"));
  return Response.json({ allOk, checks, note: allOk ? "All settings found." : "Fix the ones not marked ok in Vercel > Settings > Environment Variables, then Redeploy." },
    { headers: { "cache-control": "no-store" } });
}
