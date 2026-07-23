-- pgTAP tests for exchange_rates (backlog B-153). Core AC: rates are
-- stored with observation timestamps, immutable (a later observation is a
-- new row, not an edit).
--
-- Run via `supabase test db` once the local Supabase CLI/Docker stack is
-- available. Verified directly against the remote project (wrapped in
-- BEGIN/ROLLBACK so no fixture data was left behind).
begin;

select plan(8);

insert into exchange_rates (provider, base_currency, target_currency, rate, observed_at)
values ('test_exchangerate_host', 'USD', 'AUD', 1.55, '2026-07-23T00:00:00Z');

select ok(
  (
    select rate = 1.55 and base_currency = 'USD' and target_currency = 'AUD'
    from exchange_rates
    where provider = 'test_exchangerate_host' and observed_at = '2026-07-23T00:00:00Z'
  ),
  'a rate is stored with its base/target currency and observation timestamp'
);

-- A later observation is a new row, not an update of the earlier one.
insert into exchange_rates (provider, base_currency, target_currency, rate, observed_at)
values ('test_exchangerate_host', 'USD', 'AUD', 1.60, '2026-07-24T00:00:00Z');

select ok(
  (select count(*) = 2 from exchange_rates where provider = 'test_exchangerate_host' and base_currency = 'USD' and target_currency = 'AUD'),
  'a later observation of the same pair is a new row -- both are kept (immutable ledger, B-153 core AC)'
);

select ok(
  (
    select rate = 1.60
    from exchange_rates
    where provider = 'test_exchangerate_host' and base_currency = 'USD' and target_currency = 'AUD'
    order by observed_at desc limit 1
  ),
  'the most recent observation is retrievable via observed_at desc'
);

select throws_ok(
  $$insert into exchange_rates (provider, base_currency, target_currency, rate, observed_at) values ('t', 'USD', 'AUD', 0, now())$$,
  null, null,
  'a zero rate is rejected by the check constraint'
);

select throws_ok(
  $$insert into exchange_rates (provider, base_currency, target_currency, rate, observed_at) values ('t', 'USD', 'AUD', -1, now())$$,
  null, null,
  'a negative rate is rejected by the check constraint'
);

select throws_ok(
  $$insert into exchange_rates (provider, base_currency, target_currency, rate, observed_at) values ('test_exchangerate_host', 'USD', 'AUD', 1.55, '2026-07-23T00:00:00Z')$$,
  null, null,
  'a duplicate (provider, base, target, observed_at) is rejected'
);

-- Scheduling (backlog B-153): an hourly cron job enqueues onto the same
-- pricing_import queue the daily card-price job uses, with a `task`
-- discriminator the worker consumer dispatches on.
select ok(
  exists(select 1 from cron.job where jobname = 'hourly-exchange-rate-import' and active),
  'the hourly-exchange-rate-import cron job exists and is active'
);

select lives_ok(
  $$select pgmq.send('pricing_import', jsonb_build_object('task', 'exchange_rates'))$$,
  'enqueueing an exchange_rates task message onto pricing_import succeeds'
);

select finish();

rollback;
