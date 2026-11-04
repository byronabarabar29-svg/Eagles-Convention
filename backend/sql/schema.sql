-- ═══════════════════════════════════════════════════════════
--  3rd Mindanao Convention — Supabase schema
--  Run this once in the Supabase SQL Editor.
--
--  The Express server connects with SUPABASE_SECRET_KEY, which
--  bypasses RLS. Never ship that key to the browser.
-- ═══════════════════════════════════════════════════════════

create table if not exists public.users (
    id              uuid primary key default gen_random_uuid(),
    full_name       text not null,
    username        text,          -- used for login, unique when present
    contact_number  text not null,
    club_region     text not null,
    reference       text not null unique
                    check (reference ~ '^EMC-[0-9A-Z]+-[0-9A-Z]{4}$'),
    password_hash   text,          -- null = passwordless (name + reference login)
    created_at      timestamptz not null default now()
);

-- Safe upgrades if an earlier version of this file was already run.
alter table public.users add column if not exists username text;
alter table public.users alter column password_hash drop not null;

create table if not exists public.shirts (
    id          uuid primary key default gen_random_uuid(),
    user_id     uuid not null references public.users (id) on delete cascade,
    size        text not null
                check (size in ('XS', 'S', 'M', 'L', 'XL', '2XL', '3XL')),
    qty         integer not null default 1
                check (qty between 1 and 10),
    created_at  timestamptz not null default now()
);

create index if not exists shirts_user_id_idx
    on public.shirts (user_id);

-- Usernames are unique regardless of capitalization.
create unique index if not exists users_username_lower_idx
    on public.users (lower(username))
    where username is not null;

-- RLS is enabled so the tables are not readable with the public key.
-- The backend's secret/service-role key bypasses these policies.
alter table public.users enable row level security;
alter table public.shirts enable row level security;

-- Ask PostgREST to refresh its schema cache so the new tables are visible.
notify pgrst, 'reload schema';
