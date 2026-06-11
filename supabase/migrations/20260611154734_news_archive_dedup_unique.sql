-- news_archive accumulated duplicate rows: the writers sent
-- Prefer: resolution=ignore-duplicates, but that is a no-op without a unique
-- constraint and an on_conflict target, so every 45-min re-score re-inserted
-- the same headlines. Dedupe (keep the earliest archived copy), normalize the
-- nullable ticker to '' (MACRO rows) so the unique constraint actually covers
-- them (NULLs are distinct in Postgres), and add the constraint the writers'
-- on_conflict=ticker,headline now targets.
delete from public.news_archive a
using public.news_archive b
where a.id <> b.id
  and coalesce(a.ticker, '') = coalesce(b.ticker, '')
  and a.headline = b.headline
  and (b.archived_at < a.archived_at
       or (b.archived_at = a.archived_at and b.id < a.id));

update public.news_archive set ticker = '' where ticker is null;
alter table public.news_archive alter column ticker set default '';
alter table public.news_archive alter column ticker set not null;
alter table public.news_archive
  add constraint news_archive_ticker_headline_key unique (ticker, headline);
