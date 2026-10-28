// GET -> what Fluxy can do right now (any available free AI counts). No AI names.
import { PROVIDERS, hasKey, GEMINI_FREE_BLOCKED } from "@/lib/config";
import { readSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { country } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!readSession(req)) return Response.json({ error: "not_granted" }, { status: 401 });
  const cooling = await getStore().coolingDown().catch(() => new Map());
  const c = country(req);
  const up = PROVIDERS.filter((p) => hasKey(p) && !cooling.has(p.id) && !(p.id === "gemini" && c && GEMINI_FREE_BLOCKED.has(c)));
  const maxImages = Math.max(0, ...up.map((p) => (p.can.images ? p.maxImages : 0)));
  return Response.json(
    { available: up.length > 0, tools: up.some((p) => p.can.tools), images: maxImages ? { maxCount: maxImages } : null },
    { headers: { "cache-control": "no-store" } },
  );
}
