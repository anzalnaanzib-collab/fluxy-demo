-- Fluxy gateway schema (Postgres, e.g. Supabase free tier). OPTIONAL:
-- without DATABASE_URL the gateway keeps this state in memory, which is fine
-- for a small demo. With it, limits and cooldowns survive restarts and are
-- shared across server instances.
--
-- No prompts or answers are stored: only counts. Demo codes live in the
-- FLUXY_CODES environment variable, not here; rows refer to a code by its label.
-- Row level security is ON with no policies: only the server's own connection
-- (the database owner) can read or write.

-- Which free AI is out of quota, and until when.
create table if not exists provider_cooldowns (
  provider       text primary key check (provider in ('gemini','groq','openrouter')),
  cooldown_until timestamptz not null,
  reason         text not null default 'rate_limited',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One row per AI call. Counts only.
create table if not exists usage_events (
  id            uuid primary key default gen_random_uuid(),
  request_id    text not null unique,                     -- idempotency key from the bridge
  code_label    text not null,                            -- which demo code (label, not the code)
  purpose       text not null check (purpose in ('answer','tool_step')),
  provider      text not null check (provider in ('gemini','groq','openrouter')),
  model         text not null,
  tier          text not null check (tier in ('quick','default')),
  status        text not null check (status in ('ok','failed')),
  input_tokens  integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  error_code    text,
  created_at    timestamptz not null default now()
);
create index if not exists usage_events_code_day on usage_events (code_label, created_at);
create index if not exists usage_events_provider_day on usage_events (provider, created_at);

-- Per-visitor rate limit (one row per key per minute). Old rows are deleted daily.
create table if not exists rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limits_window on rate_limits (window_start);

alter table provider_cooldowns enable row level security;
alter table usage_events       enable row level security;
alter table rate_limits        enable row level security;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists t_pc on provider_cooldowns;
create trigger t_pc before update on provider_cooldowns for each row execute function touch_updated_at();
