#!/bin/bash
# Runs the paid-backup tests in three server setups. Needs a production build first.
cd "$(dirname "$0")/.."
stop(){ for p in $(ps -eo pid,args | grep -E "fake-ai|next-server|next start" | grep -v grep | awk '{print $1}'); do kill $p; done; sleep 1; }
start(){ (node tests/fake-ai.mjs > /tmp/fake.log 2>&1 &); (env $(grep -v '^#' .env.test | xargs) $1 npx next start -p 3100 > /tmp/next.log 2>&1 &); sleep 5; }
PAID="XAI_API_KEY=k ANTHROPIC_API_KEY=k OPENAI_API_KEY=k PERPLEXITY_API_KEY=k GEMINI_PAID_API_KEY=k XAI_BASE_URL=http://127.0.0.1:4010/xai ANTHROPIC_BASE_URL=http://127.0.0.1:4010/anthropic OPENAI_BASE_URL=http://127.0.0.1:4010/openai PERPLEXITY_BASE_URL=http://127.0.0.1:4010/perplexity FLUXY_ALLOW_PAID_WITHOUT_DB=1"
rc=0
stop; start "$PAID FLUXY_PAID_MONTHLY_CAP_USD=5"; python3 tests/paid.py on || rc=1
stop; start "$PAID FLUXY_PAID_MONTHLY_CAP_USD=0.003"; python3 tests/paid.py cap || rc=1
stop; start "$PAID"; python3 tests/paid.py off || rc=1
stop; exit $rc
