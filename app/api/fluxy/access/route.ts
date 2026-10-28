// POST { code } -> sets the session cookie. Rate limited per IP.
import { z } from "zod";
import { checkCode, newSession, sign, cookieHeader } from "@/lib/session";
import { getStore } from "@/lib/store";
import { clientKey } from "@/lib/http";

export const runtime = "nodejs";
const Body = z.object({ code: z.string().min(1).max(64) });

export async function POST(req: Request) {
  const tries = await getStore().hit(`access:${clientKey(req)}`).catch(() => 0);
  if (tries > 8) return Response.json({ error: "too_many_tries" }, { status: 429 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "bad_request" }, { status: 400 });
  const hit = checkCode(parsed.data.code);
  if (!hit) return Response.json({ error: "wrong_code" }, { status: 401 });
  const s = newSession(hit);
  return Response.json({ ok: true, role: s.role }, { headers: { "set-cookie": cookieHeader(sign(s), 7 * 24 * 3600) } });
}

export async function DELETE() {
  return Response.json({ ok: true }, { headers: { "set-cookie": cookieHeader("", 0) } });
}
