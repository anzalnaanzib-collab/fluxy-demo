// Media jobs: presenter (avatar) videos via HeyGen and designed graphics via Moda.
// Both are slow background jobs. Fluxy starts them; the browser tray polls for the result.
// Job ids carry their provider prefix so status checks need no database: "hg_<id>" / "md_<id>".
import type { ToolDef } from "./router";

const env = (k: string, d = "") => (process.env[k] || d).trim();
export const heygenOn = () => !!env("HEYGEN_API_KEY") && !!env("HEYGEN_AVATAR_ID");
export const modaOn = () => !!env("MODA_API_KEY");

export const VIDEO_TOOL = "make_presenter_video";
export const DESIGN_TOOL = "make_designed_graphic";

export const videoToolDef: ToolDef = {
  name: VIDEO_TOOL,
  description:
    "Render a short video of a presenter (avatar) speaking a script. ONLY use when the user explicitly asks to make, render or create a video with a presenter, spokesperson or avatar. Write the script yourself if the user didn't (spoken words only, under 150 words). It takes a few minutes; it appears in the Fluxy tray when ready.",
  inputSchema: {
    type: "object",
    properties: {
      script: { type: "string", description: "Exactly what the presenter says, under 150 words" },
      title: { type: "string", description: "Short title" },
      aspect: { type: "string", enum: ["9:16", "16:9", "1:1", "4:5"], description: "9:16 for Reels/TikTok/Stories (default)" },
    },
    required: ["script"],
  },
};

export const designToolDef: ToolDef = {
  name: DESIGN_TOOL,
  description:
    "Create a finished, on-brand designed graphic (social post, story, banner) from a description. ONLY use when the user explicitly asks to make or design a graphic, post design, banner or visual. Include the brand name, the headline/text to show, colours and style in the prompt. It takes a few minutes; it appears in the Fluxy tray when ready.",
  inputSchema: {
    type: "object",
    properties: {
      prompt: { type: "string", description: "Full design brief: what it is for, exact text, brand, colours, style" },
      title: { type: "string", description: "Short title" },
      size: { type: "string", enum: ["post", "story", "landscape", "square"], description: "post = 1080x1350 (default)" },
    },
    required: ["prompt"],
  },
};

export const MEDIA_NOTE =
  " If the user explicitly asks you to make a presenter/avatar video or a designed graphic, use the matching tool, then tell them it's being made and will appear in the Fluxy tray at the bottom right in a few minutes. Never claim it's finished or invent a link.";

export type MediaStart = { ok: true; job: string; kind: "video" | "design"; title: string } | { ok: false; error: string; message: string };
export type MediaStatus = { status: "working" | "done" | "failed"; url?: string; thumbnail?: string | null; kind?: "video" | "design"; message?: string };

const SIZES: Record<string, [number, number]> = { post: [1080, 1350], story: [1080, 1920], landscape: [1920, 1080], square: [1080, 1080] };

async function jsonOrText(r: Response) { const t = await r.text(); try { return JSON.parse(t); } catch { return { raw: t.slice(0, 300) }; } }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const errMsg = (j: any, r: Response) => String(j?.error?.message || j?.message || j?.raw || `status ${r.status}`).slice(0, 300);

// ---------- HeyGen ----------
const HG = () => env("HEYGEN_BASE_URL", "https://api.heygen.com");

export async function startVideo(a: { script?: string; title?: string; aspect?: string }, idem: string): Promise<MediaStart> {
  if (!heygenOn()) return { ok: false, error: "not_set_up", message: "Presenter videos aren't connected yet." };
  const script = String(a.script || "").trim().slice(0, 1500);
  if (script.length < 5) return { ok: false, error: "bad_request", message: "The script is empty." };
  const title = String(a.title || script.slice(0, 40)).slice(0, 80);
  const aspect = ["9:16", "16:9", "1:1", "4:5"].includes(String(a.aspect)) ? String(a.aspect) : "9:16";
  const body: Record<string, unknown> = { type: "avatar", avatar_id: env("HEYGEN_AVATAR_ID"), script, title, aspect_ratio: aspect, resolution: env("HEYGEN_RESOLUTION", "720p") };
  if (env("HEYGEN_VOICE_ID")) body.voice_id = env("HEYGEN_VOICE_ID");
  const r = await fetch(`${HG()}/v3/videos`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env("HEYGEN_API_KEY"), "Idempotency-Key": idem.replace(/[^A-Za-z0-9_:.-]/g, "").slice(0, 200) },
    body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
  });
  const j = await jsonOrText(r);
  const id = j?.data?.video_id;
  if (!r.ok || !id) { console.warn(`[fluxy] heygen start: ${errMsg(j, r)}`); return { ok: false, error: r.status === 429 ? "busy" : "provider_error", message: errMsg(j, r) }; }
  return { ok: true, job: `hg_${id}`, kind: "video", title };
}

async function videoStatus(id: string): Promise<MediaStatus> {
  const r = await fetch(`${HG()}/v3/videos/${encodeURIComponent(id)}`, { headers: { "x-api-key": env("HEYGEN_API_KEY") }, signal: AbortSignal.timeout(20_000) });
  const j = await jsonOrText(r);
  if (!r.ok) return r.status === 404 ? { status: "failed", kind: "video", message: "Video not found." } : { status: "working", kind: "video" };
  const d = j?.data || {};
  if (d.status === "completed" && d.video_url) return { status: "done", kind: "video", url: d.video_url, thumbnail: d.thumbnail_url || null };
  if (d.status === "failed") return { status: "failed", kind: "video", message: String(d.failure_message || d.failure_code || "The video couldn't be made.").slice(0, 200) };
  return { status: "working", kind: "video" };
}

// ---------- Moda ----------
const MD = () => env("MODA_BASE_URL", "https://api.moda.app/v1");
const mdHeaders = () => ({ "content-type": "application/json", authorization: `Bearer ${env("MODA_API_KEY")}`, "Moda-Version": env("MODA_VERSION", "2026-05-01") });

export async function startDesign(a: { prompt?: string; title?: string; size?: string }, idem: string): Promise<MediaStart> {
  if (!modaOn()) return { ok: false, error: "not_set_up", message: "Designed graphics aren't connected yet." };
  const prompt = String(a.prompt || "").trim().slice(0, 4000);
  if (prompt.length < 5) return { ok: false, error: "bad_request", message: "The design brief is empty." };
  const title = String(a.title || prompt.slice(0, 40)).slice(0, 80);
  const [width, height] = SIZES[String(a.size)] || SIZES.post;
  const send = (category: string) => fetch(`${MD()}/tasks`, {
    method: "POST", headers: mdHeaders(), signal: AbortSignal.timeout(30_000),
    body: JSON.stringify({ prompt, format: { category, width, height }, ...(category === "slides" ? { number_of_slides: 1 } : {}), idempotency_key: `${idem}:${category}`.slice(0, 200) }),
  });
  const first = env("MODA_CATEGORY", "social");
  let r = await send(first);
  let j = await jsonOrText(r);
  if (!r.ok && r.status === 400 && /categor/i.test(errMsg(j, r)) && first !== "slides") {
    // That category name isn't accepted: fall back to a one-page canvas, which Moda's docs show working.
    r = await send("slides"); j = await jsonOrText(r);
  }
  const id = j?.id || j?.data?.id;
  if (!r.ok || !id) { console.warn(`[fluxy] moda start: ${errMsg(j, r)}`); return { ok: false, error: r.status === 429 ? "busy" : "provider_error", message: errMsg(j, r) }; }
  return { ok: true, job: `md_${id}`, kind: "design", title };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findKey(o: any, key: string, depth = 0): any {
  if (!o || typeof o !== "object" || depth > 4) return undefined;
  if (o[key] != null) return o[key];
  for (const v of Object.values(o)) { const f = findKey(v, key, depth + 1); if (f != null) return f; }
  return undefined;
}

async function designStatus(taskId: string): Promise<MediaStatus> {
  const r = await fetch(`${MD()}/tasks/${encodeURIComponent(taskId)}`, { headers: mdHeaders(), signal: AbortSignal.timeout(20_000) });
  const j = await jsonOrText(r);
  if (!r.ok) return r.status === 404 ? { status: "failed", kind: "design", message: "Design not found." } : { status: "working", kind: "design" };
  const status = String(j?.status || j?.data?.status || "");
  if (["failed", "canceled", "expired"].includes(status)) return { status: "failed", kind: "design", message: `The design ${status}.` };
  if (status !== "succeeded") return { status: "working", kind: "design" };
  const canvas = findKey(j, "canvas_id");
  if (!canvas) return { status: "failed", kind: "design", message: "Finished, but no design was returned." };
  const e = await fetch(`${MD()}/canvases/${encodeURIComponent(canvas)}/export?format=png&wait=true`, { method: "POST", headers: mdHeaders(), signal: AbortSignal.timeout(28_000) });
  const ej = await jsonOrText(e);
  if (e.ok && ej?.status === "completed" && ej?.url) return { status: "done", kind: "design", url: ej.url, thumbnail: ej.url };
  return { status: "working", kind: "design" }; // export still rendering; the tray asks again shortly
}

export async function jobStatus(job: string): Promise<MediaStatus> {
  const m = /^(hg|md)_([A-Za-z0-9_.:-]{1,120})$/.exec(job);
  if (!m) return { status: "failed", message: "Unknown job." };
  try {
    return m[1] === "hg" ? await videoStatus(m[2]) : await designStatus(m[2]);
  } catch {
    return { status: "working" }; // network hiccup: try again next poll
  }
}
