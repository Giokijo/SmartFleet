-- SmartFleet · Supabase setup. Run once in: Supabase Dashboard → SQL Editor → New query → Run.

-- 1) Storage: every CSV row is kept as JSON, so the dashboard logic needs no changes.
create table if not exists public.feed_rows (
  id        bigint generated always as identity primary key,
  feed      text   not null check (feed in ('sos','amt','lube','fault')),
  data      jsonb  not null,
  synced_at timestamptz not null default now()
);
create index if not exists feed_rows_feed_id_idx on public.feed_rows (feed, id);

create table if not exists public.feed_meta (
  feed      text primary key,
  synced_at timestamptz not null default now(),
  row_count int  not null default 0
);

-- 2) Security: only logged-in users can READ. Nobody can write from the browser.
alter table public.feed_rows enable row level security;
alter table public.feed_meta enable row level security;
drop policy if exists "authenticated read rows" on public.feed_rows;
drop policy if exists "authenticated read meta" on public.feed_meta;
create policy "authenticated read rows" on public.feed_rows for select to authenticated using (true);
create policy "authenticated read meta" on public.feed_meta for select to authenticated using (true);

-- 3) Loader used by the GitHub Action (service key only). p_reset=true clears the feed first.
create or replace function public.load_feed(p_feed text, p_rows jsonb, p_reset boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_reset then delete from public.feed_rows where feed = p_feed; end if;
  insert into public.feed_rows (feed, data)
    select p_feed, r from jsonb_array_elements(p_rows) as r;
  get diagnostics n = row_count;
  insert into public.feed_meta (feed, synced_at, row_count) values (p_feed, now(), n)
    on conflict (feed) do update
      set synced_at = now(),
          row_count = case when p_reset then n else public.feed_meta.row_count + n end;
  return n;
end $$;

revoke all on function public.load_feed(text, jsonb, boolean) from public, anon, authenticated;
grant execute on function public.load_feed(text, jsonb, boolean) to service_role;
