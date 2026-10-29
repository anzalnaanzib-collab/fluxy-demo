// Which free AIs Fluxy may use, in order, and what each can do.
// Model IDs are settings: change them in Vercel's environment variables
// without touching code (see .env.example). Verify each on the provider's
// own model page before a demo; free models change often.

export type ProviderId = "gemini" | "groq" | "openrouter";
export type Tier = "quick" | "default";

export type Provider = {
  id: ProviderId;
  baseUrl: string;          // OpenAI-compatible endpoint
  keyEnv: string;           // name of the env var holding the API key
  models: Record<Tier, string>;
  can: { tools: boolean; images: boolean; json: boolean };
  maxImages: number;
  extraHeaders?: Record<string, string>;
};

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
];

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
