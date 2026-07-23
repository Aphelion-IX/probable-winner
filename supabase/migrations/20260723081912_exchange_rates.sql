-- exchange_rates (blueprint §8.6/§15.3, backlog B-153). Immutable, same
-- convention as price_snapshots (20260723073024): a later observation of
-- the same currency pair is a new row, not an edit of an old one, so
-- staleness can always be judged from the most recent row rather than
-- worrying whether a row was silently refreshed in place.

create table exchange_rates (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  base_currency text not null,
  target_currency text not null,
  rate numeric(14, 6) not null check (rate > 0),
  observed_at timestamptz not null,
  created_at timestamptz not null default now(),
  unique (provider, base_currency, target_currency, observed_at)
);

-- Backs "latest rate for this pair" lookups, the access pattern currency
-- conversion (B-161) and stale-rate detection (B-162) both need.
create index exchange_rates_pair_latest_idx
  on exchange_rates (base_currency, target_currency, observed_at desc);

alter table exchange_rates enable row level security;

create policy exchange_rates_select on exchange_rates for select to authenticated using (true);
