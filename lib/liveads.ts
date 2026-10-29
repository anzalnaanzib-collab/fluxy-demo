// Live ads: looks up ads brands are currently running on Facebook and Instagram
// (Meta's official ads_archive API). Used quietly inside research screens; never
// shown to users as its own feature or by the source's name.
import type { ToolDef } from "./router";

export const LIVE_ADS_TOOL = "find_live_ads";
export const liveAdsOn = () => !!process.env.META_AD_LIBRARY_TOKEN;

const EU = ["AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE"];

// Screens where research happens (Fluxus uses #/route addresses). Override with FLUXY_RESEARCH_PAGES.
export const RESEARCH_PAGES = new Set(
  (process.env.FLUXY_RESEARCH_PAGES || "research,competitors,trends,insights,ads,strategy,visibility,creative-lab,campaigns")
    .split(",").map((x) => x.trim().replace(/^\/+/, "")).filter(Boolean),
);
export const isResearchPage = (page?: string) => !!page && RESEARCH_PAGES.has(page.replace(/^#?\/*/, "").split(/[/?]/)[0]);

export const liveAdsToolDef: ToolDef = {
  name: LIVE_ADS_TOOL,
  description:
    "Look up ads that brands are currently running on Facebook and Instagram. Use it whenever the user's task involves competitors, rivals, other brands, market or audience research, or ad ideas, using the brand or competitor names (or the product category) as the query. Full data covers ads shown in EU countries; outside the EU only political or social-issue ads are available, so default to EU countries unless told otherwise. If nothing is found, say so plainly. Never invent ads.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "Brand, page name or keyword" },
      countries: { type: "array", items: { type: "string" }, description: "2-letter country codes; empty = EU countries" },
    },
    required: ["query"],
  },
};

// Added to the AI's instructions on research screens, so the answer reads as part of the research.
export const LIVE_ADS_NOTE =
  " You can look up ads competitors are currently running with the find_live_ads tool. When you use its results, call them 'ads currently running on Facebook and Instagram' or 'live ads'; never name the tool or its data source. Quote ad text briefly, name the page, and include the ad's link where useful.";

export type LiveAd = { page: unknown; text: string; headline: string; started: unknown; stopped: unknown; platforms: unknown; link: unknown };
export type LiveAdsResult = { ok: true; query: string; countries: string[]; count: number; ads: LiveAd[]; note: string } | { ok: false; error: string; message: string };

export async function searchLiveAds(args: { query?: string; countries?: string[]; limit?: number; active?: "ACTIVE" | "ALL" }): Promise<LiveAdsResult> {
  const token = process.env.META_AD_LIBRARY_TOKEN;
  if (!token) return { ok: false, error: "not_set_up", message: "Live ads aren't connected yet." };
  const q = String(args.query || "").trim().slice(0, 100);
  if (q.length < 2) return { ok: false, error: "bad_request", message: "Search needs at least 2 characters." };
  const countries = (Array.isArray(args.countries) ? args.countries : [])
    .map((c) => String(c).toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 10);
  const use = countries.length ? countries : EU;
  const version = process.env.META_GRAPH_VERSION || "v23.0";
  const api = new URL(`${process.env.META_GRAPH_BASE || "https://graph.facebook.com"}/${version}/ads_archive`);
  api.searchParams.set("search_terms", q);
  api.searchParams.set("ad_reached_countries", JSON.stringify(use));
  api.searchParams.set("ad_type", "ALL");
  api.searchParams.set("ad_active_status", args.active || "ACTIVE");
  api.searchParams.set("limit", String(Math.min(Math.max(args.limit || 8, 1), 20)));
  api.searchParams.set("fields", "id,page_name,ad_creative_bodies,ad_creative_link_titles,ad_delivery_start_time,ad_delivery_stop_time,publisher_platforms,ad_snapshot_url");
  try {
    const r = await fetch(api, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const m = String(j?.error?.message || `status ${r.status}`);
      console.warn(`[fluxy] live ads: ${m.slice(0, 200)}`);
      return j?.error?.code === 190
        ? { ok: false, error: "token_expired", message: "Live ads are unavailable right now (the access token expired)." }
        : { ok: false, error: "source_error", message: m.slice(0, 300) };
    }
    const ads: LiveAd[] = (j.data || []).map((a: Record<string, unknown>) => ({
      page: a.page_name,
      text: ((a.ad_creative_bodies as string[]) || [])[0]?.slice(0, 500) || "",
      headline: ((a.ad_creative_link_titles as string[]) || [])[0] || "",
      started: a.ad_delivery_start_time, stopped: a.ad_delivery_stop_time || null,
      platforms: a.publisher_platforms, link: a.ad_snapshot_url,
    }));
    return { ok: true, query: q, countries: use, count: ads.length, ads,
      note: use.every((c) => EU.includes(c)) ? "Ads shown in the EU." : "Outside the EU only political and social-issue ads are included." };
  } catch (e) {
    return { ok: false, error: "unreachable", message: String((e as Error).message).slice(0, 200) };
  }
}
