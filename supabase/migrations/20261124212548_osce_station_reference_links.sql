create table public.osce_station_reference_links (
  case_key text not null references public.osce_generated_cases(case_key) on delete cascade,
  profile_version timestamptz not null,
  url text not null check (char_length(url) between 9 and 1500 and url like 'https://%'),
  title text not null check (char_length(btrim(title)) between 1 and 250),
  locator text not null check (char_length(btrim(locator)) between 1 and 300),
  reviewed_at timestamptz not null default now(),
  primary key (case_key, profile_version, url)
);

alter table public.osce_station_reference_links enable row level security;
revoke all on public.osce_station_reference_links from public, anon, authenticated;
grant select on public.osce_station_reference_links to service_role;
