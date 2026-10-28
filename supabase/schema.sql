-- Fluxy demo database (Supabase free tier). Optional: without it the server
-- keeps this state in memory. Run once in Supabase > SQL Editor.
-- No money, no prompts, no answers are stored: only counts and cooldowns.
-- RLS is on with no policies, so only the server's service-role key can use it.

create table if not exists provider_cooldowns (
  provider       text primary key check (provider in ('gemini','groq','openrouter')),
  cooldown_until timestamptz not null,
  reason         text not null default 'rate_limited',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists usage_events (
  id            uuid primary key default gen_random_uuid(),
  request_id    text not null,
  code_label    text not null,                       -- which demo code (label, not the code)
  provider      text not null check (provider in ('gemini','groq','openrouter')),
  model         text not null,
  tier          text not null check (tier in ('quick','default')),
  status        text not null check (status in ('ok','failed','fell_through')),
  input_tokens  integer check (input_tokens >= 0),
  output_tokens integer check (output_tokens >= 0),
  error_code    text,
  created_at    timestamptz not null default now(),
  unique (request_id, provider)                      -- a retried request isn't counted twice
);
create index if not exists usage_events_label_time on usage_events (code_label, created_at);
create index if not exists usage_events_time on usage_events (created_at);

create table if not exists rate_limits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);
create index if not exists rate_limits_time on rate_limits (window_start);

alter table provider_cooldowns enable row level security;
alter table usage_events       enable row level security;
alter table rate_limits        enable row level security;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists t_pc on provider_cooldowns;
create trigger t_pc before update on provider_cooldowns for each row execute function touch_updated_at();

create or replace function hit_rate_limit(b text) returns integer language sql as $$
  insert into rate_limits (bucket, window_start, hits) values (b, date_trunc('minute', now()), 1)
  on conflict (bucket, window_start) do update set hits = rate_limits.hits + 1
  returning hits
$$;

create or replace function answers_today(lbl text) returns integer language sql stable as $$
  select count(*)::int from usage_events
  where code_label = lbl and status = 'ok' and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
$$;

create or replace function cool_down(prov text, until_ts timestamptz, why text) returns void language sql as $$
  insert into provider_cooldowns (provider, cooldown_until, reason) values (prov, until_ts, why)
  on conflict (provider) do update set cooldown_until = excluded.cooldown_until, reason = excluded.reason
$$;

create or replace function usage_today() returns table(label text, provider text, status text, n integer) language sql stable as $$
  select code_label, provider, status, count(*)::int from usage_events
  where created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc'
  group by 1,2,3
$$;

-- Housekeeping: old rate-limit rows (called daily by the server's cron route).
create or replace function cleanup_old() returns void language sql as $$
  delete from rate_limits where window_start < now() - interval '1 day';
  delete from usage_events where created_at < now() - interval '90 days';
$$;

revoke all on function hit_rate_limit(text), answers_today(text), cool_down(text,timestamptz,text), usage_today(), cleanup_old() from anon, authenticated;
