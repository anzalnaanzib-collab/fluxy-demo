-- Paid AI backups: spending ledger with a hard monthly cap.
-- Run once in Supabase > SQL Editor (safe to run again). Needs schema.sql first.

alter table usage_events drop constraint if exists usage_events_provider_check;
alter table usage_events add constraint usage_events_provider_check
  check (provider in ('gemini','groq','openrouter','xai','anthropic','perplexity','gemini_paid','openai'));
alter table usage_events drop constraint if exists usage_events_status_check;
alter table usage_events add constraint usage_events_status_check
  check (status in ('ok','failed','fell_through','reserved','released'));
alter table usage_events add column if not exists reserved_micros bigint check (reserved_micros >= 0);
alter table usage_events add column if not exists cost_micros bigint check (cost_micros >= 0);   -- USD x 1,000,000
alter table usage_events add column if not exists currency text not null default 'USD';
alter table usage_events add column if not exists paid boolean not null default false;
create index if not exists usage_events_paid_time on usage_events (paid, created_at);

-- Spent (settled) + held (reserved) this calendar month (UTC), in micro-dollars.
create or replace function paid_month_micros() returns bigint language sql stable as $$
  select coalesce(sum(coalesce(cost_micros, 0) + case when status = 'reserved' then coalesce(reserved_micros, 0) else 0 end), 0)::bigint
  from usage_events
  where paid and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
$$;

-- Hold the worst-case cost before calling a paid AI. One at a time (advisory lock),
-- so two answers can't both slip under the cap. Returns false if it would go over.
create or replace function paid_reserve(req text, prov text, mdl text, lbl text, tr text, est bigint, cap bigint)
returns boolean language plpgsql as $$
begin
  perform pg_advisory_xact_lock(424242);
  if exists (select 1 from usage_events where request_id = req and provider = prov) then return true; end if;
  if paid_month_micros() + est > cap then return false; end if;
  insert into usage_events (request_id, code_label, provider, model, tier, status, reserved_micros, paid)
  values (req, lbl, prov, mdl, tr, 'reserved', est, true);
  return true;
end $$;

create or replace function paid_settle(req text, prov text, cost bigint, inp integer, outp integer) returns void language sql as $$
  update usage_events set cost_micros = cost, input_tokens = inp, output_tokens = outp, status = 'ok'
  where request_id = req and provider = prov
$$;

create or replace function paid_release(req text, prov text) returns void language sql as $$
  update usage_events set status = 'released' where request_id = req and provider = prov and status = 'reserved'
$$;

create or replace function paid_by_provider() returns table(provider text, spent_micros bigint, answers integer) language sql stable as $$
  select provider, coalesce(sum(coalesce(cost_micros,0) + case when status='reserved' then coalesce(reserved_micros,0) else 0 end),0)::bigint,
         count(*) filter (where status = 'ok')::int
  from usage_events where paid and created_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc'
  group by provider
$$;

-- Housekeeping also settles reservations stuck for 15+ minutes at their full held amount (never under-counts).
create or replace function cleanup_old() returns void language sql as $$
  update usage_events set status = 'failed', cost_micros = reserved_micros
   where status = 'reserved' and created_at < now() - interval '15 minutes';
  delete from rate_limits where window_start < now() - interval '1 day';
  delete from usage_events where created_at < now() - interval '90 days';
$$;

revoke all on function paid_month_micros(), paid_reserve(text,text,text,text,text,bigint,bigint),
  paid_settle(text,text,bigint,integer,integer), paid_release(text,text), paid_by_provider() from anon, authenticated;
