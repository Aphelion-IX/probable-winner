-- Rebrand: the demo organisation created by supabase/seed.sql and
-- 20260725110000_seed_demo_catalogue.sql's fallback insert is named "Demo
-- Card Retailer" -- purely internal (organisations.name is never selected
-- or rendered anywhere in apps/web; the storefront's brand name is the
-- hardcoded UI text in SiteHeader/SiteFooter/login page, updated
-- separately to "Common Ground Co."). Renamed here via UPDATE, not by
-- editing the literal in those already-applied migrations -- both look up
-- this organisation by that exact name string as their fallback-lookup
-- key, and this migration runs after them either way.
update organisations set name = 'Common Ground Co.' where name = 'Demo Card Retailer';
