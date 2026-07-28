-- Hardening pass: anon/authenticated carry TRUNCATE/REFERENCES/TRIGGER on
-- every table in the public schema, platform-wide, via Supabase's default
-- project bootstrap grants -- not something any migration in this repo
-- issued. SELECT/INSERT/UPDATE/DELETE are deliberately left untouched:
-- this project's own convention is that Row Level Security is the actual
-- access boundary for those commands (see e.g.
-- 20260723054622_inventory_balances_and_movements.sql's own header: "No
-- insert/update/delete RLS policy exists... there is no supported write
-- path at all" -- relying on policy absence, not the underlying grant, to
-- block writes). TRUNCATE is not RLS-governed at all in Postgres, so a
-- broad grant of it is a real gap regardless of RLS; REFERENCES/TRIGGER
-- (create a constraint/trigger against a table) serve no purpose for an
-- API role that only ever reaches tables through PostgREST, which never
-- issues those three commands.
--
-- Scoped to the public schema only, matching what was actually audited.
-- Does not touch service_role (server-side only, never exposed to browser
-- code, and legitimately needs full access).
-- pg_class (relkind in ordinary table/view/materialized view), not
-- pg_tables -- pg_tables only lists physical tables, and this project has
-- views (card_browse, price_import_summary) carrying the same broad grant.
do $$
declare
  r record;
begin
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'v', 'm')
  loop
    execute format(
      'revoke truncate, references, trigger on table public.%I from anon, authenticated',
      r.relname
    );
  end loop;
end $$;

-- Best-effort for tables created after this migration, under whichever
-- role runs it. Supabase's own platform-level default-privilege rule
-- (owned by its bootstrap role, not this repo) may still re-grant these on
-- a table created by a different role, so this is not a complete
-- guarantee for the future -- a new table should still be checked against
-- this same audit query when it lands:
--
--   select table_name, string_agg(privilege_type, ',' order by privilege_type)
--   from information_schema.role_table_grants
--   where grantee = 'anon' and table_schema = 'public'
--   group by table_name
--   having string_agg(privilege_type, ',' order by privilege_type) <> 'SELECT';
alter default privileges in schema public
  revoke truncate, references, trigger on tables from anon, authenticated;
