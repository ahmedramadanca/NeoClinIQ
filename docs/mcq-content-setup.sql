-- Run in Supabase SQL Editor before deploying website-mcq-library.
-- Upload only licensed/owned MCQ content to the PRIVATE mcq-content bucket.
insert into storage.buckets (id,name,public,file_size_limit)
values ('mcq-content','mcq-content',false,104857600)
on conflict (id) do update set public=false;
create table if not exists public.mcq_resources (
 id uuid primary key default gen_random_uuid(),
 title text not null,
 module text not null,
 type text not null check (type in ('video','pdf','infographic')),
 storage_path text not null unique,
 published boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.mcq_resources enable row level security;
-- No direct browser SELECT or storage read policies are granted.
-- The Edge Function validates the signed-in user and current MCQ entitlement,
-- then uses the service role to issue 60-second signed URLs.
-- Payment checkout stays disabled until Stripe webhook, entitlement creation,
-- expiration and renewal have been tested end-to-end.
