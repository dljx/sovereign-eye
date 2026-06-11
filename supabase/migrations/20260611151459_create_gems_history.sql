-- Hidden-gems discovery history — written by sovereign-dd's upload_kv.py each
-- scheduled run; read by the dashboard for all-time gems lookback. Mirrors the
-- scout_history conventions (uuid PK, created_at default, RLS deny-by-default —
-- only the secret/service key reads or writes).
create table if not exists public.gems_history (
  id            uuid primary key default gen_random_uuid(),
  ticker        text not null,
  score         numeric,
  grade         text,
  thesis        text,
  catalyst      text,
  fair_value    numeric,
  discovered_at timestamptz,
  created_at    timestamptz not null default now()
);

alter table public.gems_history enable row level security;

create index if not exists gems_history_ticker_idx on public.gems_history (ticker);
create index if not exists gems_history_created_at_idx on public.gems_history (created_at desc);
