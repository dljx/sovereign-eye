-- These policies were named "service-role full access" but were created TO public
-- with USING (true) WITH CHECK (true) — granting every role (including anon via the
-- publishable key) full read/write/delete on the tables. The service/secret key
-- bypasses RLS entirely, so no policy is needed for the system's own writers and
-- readers; dropping these restores deny-by-default for anon/authenticated.
drop policy if exists "service-role full access" on public.dd_history;
drop policy if exists "service-role full access" on public.news_archive;
drop policy if exists "service-role full access" on public.portfolio_snapshots;
drop policy if exists "service-role full access" on public.scout_history;
