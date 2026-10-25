-- Run in Supabase > SQL Editor. Safe to re-run; upgrades an existing table in place.
create table if not exists public.registrations (
  id          uuid primary key default gen_random_uuid(),
  full_name   text not null check (char_length(btrim(full_name)) between 2 and 100),
  batch       text not null check (batch in ('2024', '2025', '2026')),
  student_id  text not null check (student_id ~ '^[0-9]{4,10}$'),
  created_at  timestamptz not null default now(),
  constraint registrations_student_id_key unique (student_id)
);

-- Keep batch options in sync with the registration form (including existing installations).
alter table public.registrations drop constraint if exists registrations_batch_check;
alter table public.registrations add constraint registrations_batch_check
  check (batch in ('2024', '2025', '2026'));

-- status: 'pending' until you check the screenshot against your UPI history, then change it to 'paid' in the Table Editor.
alter table public.registrations add column if not exists status     text not null default 'pending' check (status in ('pending', 'paid'));
alter table public.registrations add column if not exists proof_path text;

alter table public.registrations enable row level security;
drop policy if exists "Public can register" on public.registrations;
revoke all on public.registrations from anon, authenticated;
-- RLS on with no policies: the anon key cannot read or write. Only the Express server (service_role) can.

-- Private bucket for payment screenshots (2 MB, images only). No storage policies = no public access.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('payment-proofs', 'payment-proofs', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 2097152, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];
