-- Run once in the Supabase SQL editor of the project chosen for PrimeTV.
-- This creates only PrimeTV tables. Authentication is provided by Supabase Auth.
begin;
create table public.primetv_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  color text not null default 'violet' check (color in ('violet','peach','sage','blue','rose')),
  slot smallint not null check (slot between 1 and 5),
  created_at timestamptz not null default now(),
  unique (user_id, slot),
  unique (id, user_id)
);
create table public.primetv_activity (
  profile_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie','tv')),
  media_id bigint not null check (media_id > 0),
  item jsonb not null check (jsonb_typeof(item) = 'object' and octet_length(item::text) <= 100000),
  position double precision not null default 0 check (position >= 0 and position <= 604800),
  duration double precision not null default 0 check (duration >= 0 and duration <= 604800),
  season integer not null default 1 check (season between 1 and 10000),
  episode integer not null default 1 check (episode between 1 and 100000),
  rating smallint not null default 0 check (rating in (-1,0,1)),
  in_list boolean not null default false,
  completed boolean not null default false,
  started_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (profile_id, media_type, media_id),
  foreign key (profile_id, user_id) references public.primetv_profiles(id, user_id) on delete cascade,
  check (duration = 0 or position <= duration)
);
create index primetv_activity_user_idx on public.primetv_activity(user_id);
alter table public.primetv_profiles enable row level security;
alter table public.primetv_activity enable row level security;
revoke all on public.primetv_profiles, public.primetv_activity from anon;
grant select, insert, update, delete on public.primetv_profiles, public.primetv_activity to authenticated;
create policy "Owners read their profiles" on public.primetv_profiles for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create their profiles" on public.primetv_profiles for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners edit their profiles" on public.primetv_profiles for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners delete their profiles" on public.primetv_profiles for delete to authenticated using ((select auth.uid()) = user_id);
create policy "Owners read their activity" on public.primetv_activity for select to authenticated using ((select auth.uid()) = user_id);
create policy "Owners create their activity" on public.primetv_activity for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Owners edit their activity" on public.primetv_activity for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Owners delete their activity" on public.primetv_activity for delete to authenticated using ((select auth.uid()) = user_id);
commit;
