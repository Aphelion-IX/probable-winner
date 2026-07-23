-- Hourly exchange-rate refresh (blueprint §15.3/§17, backlog B-153).
-- Forex rates move faster than daily card prices, so this is scheduled
-- separately from daily-price-import (20260723073400) even though both
-- enqueue onto the same pricing_import queue -- the consumer dispatches on
-- the message's `task` field.

select cron.schedule(
  'hourly-exchange-rate-import',
  '0 * * * *',
  $$select pgmq.send('pricing_import', jsonb_build_object('task', 'exchange_rates'))$$
);
