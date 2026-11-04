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
    name_on_shirt text            -- name the member wants printed on the shirt
                check (name_on_shirt is null or char_length(name_on_shirt) between 1 and 40),
    qty         integer not null default 1
                check (qty between 1 and 10),
    created_at  timestamptz not null default now()
);

-- Safe upgrade if an earlier version of this file was already run.
alter table public.shirts add column if not exists name_on_shirt text;

create index if not exists shirts_user_id_idx
    on public.shirts (user_id);

-- One payment covers every order a member has. Re-submitting updates the
-- same row and puts it back in the secretariat's verification queue.
create table if not exists public.payments (
    id              uuid primary key default gen_random_uuid(),
    user_id         uuid not null unique references public.users (id) on delete cascade,
    method          text not null
                    check (method in ('GCash', 'Bank Transfer', 'Cash')),
    txn_ref         text,          -- null for cash payments
    txn_date        date not null,
    amount          numeric(10, 2) not null default 0,
    receipt_image   text,          -- base64 data URL of the uploaded receipt
    status          text not null default 'pending'
                    check (status in ('pending', 'verified', 'rejected')),
    note            text,          -- secretariat's verification note
    submitted_at    timestamptz not null default now(),
    verified_at     timestamptz,
    verified_by     text,
    updated_at      timestamptz not null default now()
);

create index if not exists payments_status_idx
    on public.payments (status);
create index if not exists payments_submitted_at_idx
    on public.payments (submitted_at desc);

-- Safe upgrades if an earlier version of this file was already run.
alter table public.payments add column if not exists note text;
alter table public.payments add column if not exists updated_at timestamptz not null default now();

-- Usernames are unique regardless of capitalization.
create unique index if not exists users_username_lower_idx
    on public.users (lower(username))
    where username is not null;

-- RLS is enabled so the tables are not readable with the public key.
-- The backend's secret/service-role key bypasses these policies.
alter table public.users enable row level security;
alter table public.shirts enable row level security;
alter table public.payments enable row level security;

-- Ask PostgREST to refresh its schema cache so the new tables are visible.
notify pgrst, 'reload schema';
