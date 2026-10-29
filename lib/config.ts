// Which AIs Fluxy may use, in order, and what each can do.
// Free AIs come first. Paid AIs are only tried after every free one is out,
// and only while this month's paid spend is under FLUXY_PAID_MONTHLY_CAP_USD.
// Model IDs are settings: change them in Vercel's environment variables
// without touching code (see .env.example). Verify each on the provider's
// own model page before a demo; free models change often.

export type ProviderId = "gemini" | "groq" | "openrouter" | "xai" | "anthropic" | "perplexity" | "gemini_paid" | "openai";
export const PROVIDER_IDS: ProviderId[] = ["gemini", "groq", "openrouter", "xai", "anthropic", "perplexity", "gemini_paid", "openai"];
export type Tier = "quick" | "default";

export type Provider = {
  id: ProviderId;
  baseUrl: string;          // OpenAI-compatible endpoint
  keyEnv: string;           // name of the env var holding the API key
  models: Record<Tier, string>;
  can: { tools: boolean; images: boolean; json: boolean };
  maxImages: number;
  extraHeaders?: Record<string, string>;
  path?: string;            // defaults to /chat/completions
  api?: "chat" | "pplx-agent";  // pplx-agent = Perplexity's Agent API (since Sep 2026)
  paid?: {
    label: string;                          // shown on the owner page only
    inPerM: number; outPerM: number;        // USD per 1M tokens (the higher, long-prompt rate is not used here)
    perCall?: number;                       // USD fixed fee per call (e.g. web search)
    priceDate: string;                      // when the price was read
  };
  maxTokensField?: "max_tokens" | "max_completion_tokens";
};
const num = (k: string, d: number) => { const v = Number(process.env[k]); return Number.isFinite(v) && v >= 0 && process.env[k] !== "" && process.env[k] !== undefined ? v : d; };

const env = (k: string, d: string) => (process.env[k] && process.env[k]!.trim()) || d;

export const PROVIDERS: Provider[] = [
  {
    id: "gemini",
    baseUrl: env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
    keyEnv: "GEMINI_API_KEY",
    models: {
      quick: env("GEMINI_MODEL_QUICK", "gemini-flash-lite-latest"),
      default: env("GEMINI_MODEL_DEFAULT", "gemini-flash-lite-latest"),
    },
    can: { tools: true, images: true, json: true },
    maxImages: 4,
  },
  {
    id: "groq",
    baseUrl: env("GROQ_BASE_URL", "https://api.groq.com/openai/v1"),
    keyEnv: "GROQ_API_KEY",
    models: {
      quick: env("GROQ_MODEL_QUICK", "openai/gpt-oss-20b"),
      default: env("GROQ_MODEL_DEFAULT", "openai/gpt-oss-120b"),
    },
    can: { tools: true, images: false, json: true },
    maxImages: 0,
  },
  {
    id: "openrouter",
    baseUrl: env("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    keyEnv: "OPENROUTER_API_KEY",
    // Only free models. "openrouter/free" routes to whichever free model is available.
    models: {
      quick: env("OPENROUTER_MODEL_QUICK", "openrouter/free"),
      default: env("OPENROUTER_MODEL_DEFAULT", "openrouter/free"),
    },
    can: { tools: false, images: false, json: false },
    maxImages: 0,
    extraHeaders: { "X-Title": "Fluxy demo" },
  },

  // ---------- Paid backups (pay-as-you-go). Only after all free AIs are out. ----------
  // Prices: USD per 1M tokens, read 2026-10-29 (see replica/paid.md for sources).
  // Override any price with e.g. XAI_PRICE_IN / XAI_PRICE_OUT if the provider changes it.
  {
    id: "xai",
    baseUrl: env("XAI_BASE_URL", "https://api.x.ai/v1"),
    keyEnv: "XAI_API_KEY",
    models: { quick: env("XAI_MODEL", "grok-4.3"), default: env("XAI_MODEL", "grok-4.3") },
    can: { tools: true, images: true, json: true },
    maxImages: 4,
    paid: { label: "Grok", inPerM: num("XAI_PRICE_IN", 1.25), outPerM: num("XAI_PRICE_OUT", 2.5), priceDate: "2026-10-29" },
  },
  {
    id: "anthropic",
    baseUrl: env("ANTHROPIC_BASE_URL", "https://api.anthropic.com/v1"),
    keyEnv: "ANTHROPIC_API_KEY",
    models: { quick: env("ANTHROPIC_MODEL", "claude-haiku-5-5"), default: env("ANTHROPIC_MODEL", "claude-haiku-5-5") },
    can: { tools: true, images: true, json: false },
    maxImages: 4,
    // Haiku 5.5: $0.10 in / $0.50 out up to 100K-token prompts. Fluxy prompts are far smaller.
    paid: { label: "Claude", inPerM: num("ANTHROPIC_PRICE_IN", 0.1), outPerM: num("ANTHROPIC_PRICE_OUT", 0.5), priceDate: "2026-10-29" },
  },
  {
    id: "perplexity",
    baseUrl: env("PERPLEXITY_BASE_URL", "https://api.perplexity.ai"),
    path: env("PERPLEXITY_PATH", "/v1/agent"),
    api: "pplx-agent",
    keyEnv: "PERPLEXITY_API_KEY",
    // Agent API with live web search. It reports its own exact cost, which Fluxy uses for the ledger.
    models: { quick: env("PERPLEXITY_MODEL", "perplexity/sonar"), default: env("PERPLEXITY_MODEL", "perplexity/sonar") },
    can: { tools: false, images: false, json: false },
    maxImages: 0,
    // Sonar $0.25 / $2.50 per 1M, plus a web-search fee counted at a safe $0.005 per call.
    paid: { label: "Perplexity", inPerM: num("PERPLEXITY_PRICE_IN", 0.25), outPerM: num("PERPLEXITY_PRICE_OUT", 2.5), perCall: num("PERPLEXITY_PRICE_CALL", 0.005), priceDate: "2026-10-29" },
  },
  {
    id: "gemini_paid",
    baseUrl: env("GEMINI_BASE_URL", "https://generativelanguage.googleapis.com/v1beta/openai"),
    keyEnv: "GEMINI_PAID_API_KEY",
    models: { quick: env("GEMINI_PAID_MODEL", "gemini-flash-lite-latest"), default: env("GEMINI_PAID_MODEL", "gemini-flash-lite-latest") },
    can: { tools: true, images: true, json: true },
    maxImages: 4,
    // Counted at a deliberately high estimate so the cap is never exceeded; set exact prices if you like.
    paid: { label: "Gemini (paid)", inPerM: num("GEMINI_PAID_PRICE_IN", 0.5), outPerM: num("GEMINI_PAID_PRICE_OUT", 3), priceDate: "2026-10-29 (safe estimate)" },
  },
  {
    id: "openai",
    baseUrl: env("OPENAI_BASE_URL", "https://api.openai.com/v1"),
    keyEnv: "OPENAI_API_KEY",
    models: { quick: env("OPENAI_MODEL", "gpt-5.4-mini"), default: env("OPENAI_MODEL", "gpt-5.4-mini") },
    can: { tools: true, images: true, json: true },
    maxImages: 4,
    maxTokensField: "max_completion_tokens",
    paid: { label: "ChatGPT", inPerM: num("OPENAI_PRICE_IN", 0.75), outPerM: num("OPENAI_PRICE_OUT", 4.5), priceDate: "2026-10-29" },
  },
];

// Paid order can be changed with FLUXY_PAID_ORDER, e.g. "anthropic,xai,openai,gemini_paid,perplexity".
const order = (process.env.FLUXY_PAID_ORDER || "").split(",").map((x) => x.trim()).filter(Boolean);
if (order.length) {
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? 99 : i; };
  const free = PROVIDERS.filter((p) => !p.paid), paid = PROVIDERS.filter((p) => p.paid).sort((a, b) => rank(a.id) - rank(b.id));
  PROVIDERS.splice(0, PROVIDERS.length, ...free, ...paid);
}

// Monthly cap for ALL paid AIs together, in USD. 0 turns paid AIs off.
export const PAID_CAP_USD = num("FLUXY_PAID_MONTHLY_CAP_USD", 0);
export const usd = (micros: number) => micros / 1_000_000;
export const micros = (dollars: number) => Math.ceil(dollars * 1_000_000);

// Cost of one call in micro-dollars, from token counts.
export function costMicros(p: Provider, inTok: number, outTok: number): number {
  if (!p.paid) return 0;
  return micros((inTok * p.paid.inPerM + outTok * p.paid.outPerM) / 1_000_000 + (p.paid.perCall || 0));
}

export const hasKey = (p: Provider) => !!process.env[p.keyEnv];

// Gemini's free tier may not be used for apps serving these places (Google's terms).
export const GEMINI_FREE_BLOCKED = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT","LV","LT","LU","MT",
  "NL","PL","PT","RO","SK","SI","ES","SE","IS","LI","NO","CH","GB",
]);

export const LIMITS = {
  perMinute: Number(env("FLUXY_PER_MINUTE", "20")),   // calls per visitor per minute
  maxToolSteps: 6,
  maxOutputTokens: { quick: 1200, default: 2400 } as Record<Tier, number>,
  maxBodyBytes: 6_000_000,                             // images arrive as data URLs
  requestTimeoutMs: 45_000,
};

// One fixed line so Fluxy sounds the same whichever AI answers.
export const FLUXY_SYSTEM =
  "You are Fluxy, the AI assistant inside the Fluxus marketing app. Never say which AI model or company you are; if asked, say you are Fluxy. Follow the instructions in the user's message exactly, including any requested format or JSON.";
