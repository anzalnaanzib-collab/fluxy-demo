// GET /api/fluxy/media?job=hg_... -> status of a presenter video or designed graphic.
// The Fluxy tray in the browser asks this every few seconds until the file is ready.
import { readSession } from "@/lib/session";
import { getStore } from "@/lib/store";
import { clientKey } from "@/lib/http";
import { jobStatus, JOB_RE } from "@/lib/media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!readSession(req)) return Response.json({ error: "not_granted" }, { status: 401 });
  if ((await getStore().hit(`media:${clientKey(req)}`).catch(() => 0)) > 40) return Response.json({ status: "working" }, { status: 200 });
  const job = new URL(req.url).searchParams.get("job") || "";
  if (!JOB_RE.test(job)) return Response.json({ error: "bad_request" }, { status: 400 });
  return Response.json(await jobStatus(job), { headers: { "cache-control": "no-store" } });
}
