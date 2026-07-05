-- Troll Runner — videos catalog
-- Run this once in the Supabase SQL editor for project tjsyhfplxjtakdfkpdtg.
--
-- Writes require a real admin session, enforced via troll_is_admin() --
-- the same helper function created by the main site's
-- assets/supabase/troll_admin_lockdown.sql (same Supabase project). Run
-- that migration FIRST if you haven't already; this one depends on it.

create extension if not exists "pgcrypto";

create table if not exists public.videos (
  id          uuid primary key default gen_random_uuid(),
  title       text not null default 'Untitled',
  topic       text not null default 'Uncategorized',
  source      text not null default 'drive',   -- 'drive' | 'x' | 'tiktok'
  url         text not null,
  external_id text,                              -- drive file id / tweet id / tiktok video id
  tags        text[] not null default '{}',
  position    integer not null default 0,        -- manual ordering within a topic
  created_at  timestamptz not null default now()
);

create index if not exists videos_topic_idx on public.videos (topic);

alter table public.videos enable row level security;

do $$
declare pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'videos'
  loop
    execute format('drop policy if exists %I on public.videos', pol.policyname);
  end loop;
end $$;

-- Public can read every video.
create policy "videos public read" on public.videos
  for select to anon, authenticated using (true);

-- Only a real admin session can write.
create policy "videos admin insert" on public.videos
  for insert to authenticated with check (public.troll_is_admin());

create policy "videos admin update" on public.videos
  for update to authenticated using (public.troll_is_admin()) with check (public.troll_is_admin());

create policy "videos admin delete" on public.videos
  for delete to authenticated using (public.troll_is_admin());

revoke insert, update, delete on public.videos from anon, authenticated;
grant select on public.videos to anon, authenticated;
grant insert, update, delete on public.videos to authenticated;
