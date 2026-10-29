# Paid backups: how they work

1. Fluxy always tries the free AIs first (Gemini free, Groq, OpenRouter).
2. Only when all of them are out does it try paid AIs, in this order: Grok, Claude, Perplexity, Gemini (paid), ChatGPT.
3. Before each paid answer, Fluxy holds the worst-case cost against the monthly cap
   (`FLUXY_PAID_MONTHLY_CAP_USD`). If the hold would pass the cap, that AI is skipped.
4. After the answer, the hold is replaced with the real cost from the tokens used.
   If an answer is cut off half-way, the full hold is counted, so spending is never under-counted.
5. The owner page (/owner) shows this month's paid spend, the cap, and spend per AI.
6. Visitors never see which AI answered.

Setup: run `supabase/paid.sql` once in Supabase > SQL Editor (after `schema.sql`), add the keys
and the cap in Vercel, then Redeploy. Also set a spending limit in each company's billing page.

## Prices used (USD per 1M tokens, read 2026-10-29; override in settings if they change)
| AI | model | in | out | source |
| --- | --- | --- | --- | --- |
| Grok | grok-4.3 | 1.25 | 2.50 | costbench.com xAI API page, verified 2026-10-10 |
| Claude | claude-haiku-5-5 | 0.10 | 0.50 | platform.claude.com pricing (prompts up to 100K tokens) |
| Perplexity | sonar | 0.25 | 2.50 + $0.005/call (safe estimate for search) | docs.perplexity.ai |
| Gemini (paid) | gemini-flash-lite-latest | 0.50 | 3.00 | deliberately high estimate; set exact prices |
| ChatGPT | gpt-5.4-mini | 0.75 | 4.50 | costbench.com OpenAI API page (confirm the model name with "Test each AI") |

Note: Perplexity retired its old chat endpoint on 27 Sep 2026; requests are being moved to its
new Agent API. "Test each AI" shows whether it works for your key; if not, leave it out.

## Tests
`tests/run_paid.sh`: free first, paid only after free is out, real-token costing, cut-off answers
counted in full, cap enforced, 8 simultaneous answers stay under the cap, paid off without a cap. 14/14 pass.
Database ledger tested on Postgres 16: 20 simultaneous requests, exactly the cap's worth accepted.
