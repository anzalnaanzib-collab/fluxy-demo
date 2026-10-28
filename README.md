# Fluxy demo

A separate copy of Fluxus Autopilot (by Dynexis) where **Ask Fluxy** runs on free AI tiers
(Gemini, then Groq, then OpenRouter) and switches automatically. No AI names are shown, and nothing is charged.
The original Fluxus artifact in Claude is not changed.

- Settings to fill in on Vercel: `.env.example`
- Optional database: `supabase/schema.sql`
- Owner status page: `/owner`
- Tests: `node tests/fake-ai.mjs` + `python3 tests/e2e.py` (see tests/)
