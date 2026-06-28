-- Troll Runner — videos catalog
-- Run this once in the Supabase SQL editor for project tjsyhfplxjtakdfkpdtg.
-- Security note: this site has no real server auth. The "admin" gate is a
-- client-side password (see assets/js/admin-auth.js), so writes go through the
-- anon key — matching how site_updates already works on the other sites.
-- The policies below intentionally allow anon writes. Tighten later if you
-- move admin actions behind real Supabase auth.

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

-- Public can read every video.
drop policy if exists "videos public read" on public.videos;
create policy "videos public read" on public.videos
  for select using (true);

-- Anon can write (gated client-side by the admin password).
drop policy if exists "videos anon insert" on public.videos;
create policy "videos anon insert" on public.videos
  for insert with check (true);

drop policy if exists "videos anon update" on public.videos;
create policy "videos anon update" on public.videos
  for update using (true) with check (true);

drop policy if exists "videos anon delete" on public.videos;
create policy "videos anon delete" on public.videos
  for delete using (true);

-- Seed the first real drop (title pulled from Google Drive).
insert into public.videos (title, topic, source, url, external_id, tags, position)
values
  (
    'Shilling $TROLL to local businesses, Part 1',
    '$TROLL',
    'drive',
    'https://drive.google.com/file/d/1PtvtsNYdlVTyEu_J1EwDBuLxFbGUwDiB/view?usp=sharing',
    '1PtvtsNYdlVTyEu_J1EwDBuLxFbGUwDiB',
    array['shilling','local-business'],
    0
  )
on conflict do nothing;
