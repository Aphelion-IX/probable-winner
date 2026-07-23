-- Background worker queues (blueprint §17), backed by Supabase Queues (pgmq).
-- Queue names use underscores (pgmq requires valid identifier characters);
-- the blueprint's hyphenated labels map 1:1 onto these.
create extension if not exists pgmq;

select pgmq.create('catalogue_import');
select pgmq.create('pricing_import');
select pgmq.create('search_index');
select pgmq.create('email');
select pgmq.create('restock_alerts');
select pgmq.create('order_processing');
select pgmq.create('reservation_cleanup');
select pgmq.create('stock_reconciliation');
select pgmq.create('report_generation');
