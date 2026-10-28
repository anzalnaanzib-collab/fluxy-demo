// Daily housekeeping, called by Vercel Cron (see vercel.json). Only with the cron secret.
import { createClient } from "@supabase/supabase-js";
export const runtime = "nodejs";
export async function GET(req: Request) {
  if (!process.env.CRON_SECRET || req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return new Response("forbidden", { status: 403 });
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return Response.json({ ok: true, skipped: "no database" });
  const { error } = await createClient(url, key, { auth: { persistSession: false } }).rpc("cleanup_old");
  return Response.json({ ok: !error });
}
