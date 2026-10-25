-- BESPAARSLIM: veilige gegevensopslag voor twee afzonderlijke online gebruikers.
-- Voer dit eenmaal uit in Supabase > SQL Editor.
-- Geen persoonlijke e-mailadressen of privésleutels in deze SQL zetten.
create table if not exists public.bespaarslim_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  document jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bespaarslim_data enable row level security;
revoke all on table public.bespaarslim_data from anon, authenticated;
grant select, insert, update on table public.bespaarslim_data to authenticated;

drop policy if exists "bespaarslim_read_self" on public.bespaarslim_data;
create policy "bespaarslim_read_self" on public.bespaarslim_data
for select to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "bespaarslim_create_self" on public.bespaarslim_data;
create policy "bespaarslim_create_self" on public.bespaarslim_data
for insert to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "bespaarslim_update_self" on public.bespaarslim_data;
create policy "bespaarslim_update_self" on public.bespaarslim_data
for update to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

-- BEPERKEN TOT TWEE ACCOUNTS: ga in het Supabase-dashboard naar
-- Authentication > Providers > Email; zet publieke self-signup UIT,
-- en nodig ALLEEN jouw twee e-mailadressen uit via Authentication > Users.
-- Houd RLS aan. Nooit een service_role- of secret-key in de website plaatsen.
