-- Run this once in Supabase SQL Editor after this account exists in Authentication > Users.
-- Only Vominhthanh996@gmail.com will be kept as admin.

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'owner',
  created_at timestamptz not null default now()
);

alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.admin_users
     where user_id = auth.uid()
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

drop policy if exists "Admins can read admin users" on public.admin_users;
create policy "Admins can read admin users"
  on public.admin_users
  for select
  to authenticated
  using (public.is_admin());

create unique index if not exists vip_entitlements_user_plan_idx
  on public.vip_entitlements (user_id, plan_id);

drop policy if exists "Admins can manage stories" on public.stories;
create policy "Admins can manage stories"
  on public.stories
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage story chapters" on public.story_chapters;
create policy "Admins can manage story chapters"
  on public.story_chapters
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage story chapter bodies" on public.story_chapter_bodies;
create policy "Admins can manage story chapter bodies"
  on public.story_chapter_bodies
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage comments" on public.comments;
create policy "Admins can manage comments"
  on public.comments
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read profiles" on public.profiles;
create policy "Admins can read profiles"
  on public.profiles
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can update profiles" on public.profiles;
create policy "Admins can update profiles"
  on public.profiles
  for update
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage wallets" on public.account_wallets;
create policy "Admins can manage wallets"
  on public.account_wallets
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can manage VIP entitlements" on public.vip_entitlements;
create policy "Admins can manage VIP entitlements"
  on public.vip_entitlements
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read reading progress" on public.reading_progress;
create policy "Admins can read reading progress"
  on public.reading_progress
  for select
  to authenticated
  using (public.is_admin());

drop policy if exists "Admins can manage unlocked chapters" on public.unlocked_chapters;
create policy "Admins can manage unlocked chapters"
  on public.unlocked_chapters
  for all
  to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can read coin transactions" on public.coin_transactions;
create policy "Admins can read coin transactions"
  on public.coin_transactions
  for select
  to authenticated
  using (public.is_admin());

do $$
declare
  owner_id uuid;
begin
  select id
    into owner_id
    from auth.users
   where lower(email) = lower('Vominhthanh996@gmail.com')
   limit 1;

  if owner_id is null then
    raise exception 'Admin account Vominhthanh996@gmail.com does not exist yet. Create it in Authentication > Users first.';
  end if;

  delete from public.admin_users
   where user_id <> owner_id;

  insert into public.admin_users (user_id, role)
  values (owner_id, 'owner')
  on conflict (user_id) do update
    set role = excluded.role;
end $$;
