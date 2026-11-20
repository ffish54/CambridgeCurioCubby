-- Customer accounts for Cambridge Curio Cubbyhole.
--
-- Run this in the Supabase SQL editor after supabase/shop-products.sql and
-- supabase/shop-notifications.sql (Dashboard → SQL Editor → New query →
-- paste → Run). It is safe to run again.
--
-- The website only has the publishable key in assets/js/supabase-config.js.
-- It cannot create these tables or jobs. Do not put the service_role key
-- in the website.
--
-- Keep the admin uuid below identical to ADMIN_USER_ID in
-- assets/js/supabase-config.js. Client checks are not the security boundary.
-- These policies are. A signed-in customer is the `authenticated` role and
-- must not gain the cabinet. Every admin policy still requires that exact
-- user id. Nothing in this file treats `authenticated` on its own as admin.
--
-- What this sets up
--   * public.profiles — one row per account. id is auth.users.id.
--     A trigger creates the row when someone signs up. marketing_consent
--     defaults to false. A customer can read and update only their own row.
--     The admin user can read every row. Customers cannot delete a profile
--     directly; deletion goes through delete_my_account().
--   * public.offers.user_id — nullable, references auth.users, on delete
--     set null. Guest offers leave it empty and keep working. A signed-in
--     customer's insert is stamped with their own id. They can read their
--     own offers. They cannot update or delete offers directly.
--   * respond_to_counter(offer_id, decision) — the signed-in customer
--     accepts or declines a counter-offer on their own offer. Accepting
--     sets that piece to reserved and reserved_until to now() + 3 days,
--     unless the piece is already reserved for a different offer and that
--     hold has not run out. A second customer cannot take that hold.
--   * link_guest_offers() — attaches earlier guest offers whose email
--     matches this customer's confirmed email. The email is read from
--     auth.users, not from the browser.
--   * delete_my_account() — the signed-in customer deletes their profile,
--     anonymises and detaches their offers, and deletes the auth user.
--     It refuses the admin user id. delete_customer_account(uuid) does the
--     work and is not granted to the website roles, so a customer cannot
--     pass someone else's id.
--   * public.products.reserved_until — when a reserved piece returns to
--     available. Null means a hold with no automatic release (the cabinet
--     can still reserve a piece by hand). status already allows 'reserved'.
--   * release_expired_reservations() — hourly, once pg_cron is enabled.
--     The shop also treats an expired hold as available when it reads a
--     piece, without writing.
--   * delete_inactive_accounts() — monthly. Deletes accounts with no
--     sign-in for a year, using coalesce(last_sign_in_at, created_at).
--     Never deletes the admin user.
--
-- This script does not alter storage.objects, storage.buckets, or storage
-- policies. It does not grant customers access to sales, drafts, journal
-- posts, or product photographs.
--
-- If you run supabase/shop-notifications.sql again afterwards, run this
-- file again too. That script replaces the offer trigger and the public
-- insert policy; this file puts the account behaviour back.
--
-- A database that already ran an earlier copy of this file should also run
-- supabase/hold-takeover-fix.sql (or run this updated file again). That
-- stops a second customer accepting a counter-offer while another buyer's
-- hold is still active.
--
-- pg_cron
--   The tables and policies work without it. The hourly release and the
--   monthly inactive-account deletion do not, until the extension is on.
--   1. Dashboard → Database → Extensions.
--   2. Find pg_cron and enable it.
--   3. Run this script again. The schedule block notices if the extension
--      is still missing, and the rest of the script still applies.

-- ---------------------------------------------------------------------------
-- Pieces: hold expiry. 'reserved' is already allowed by shop-products.sql.
-- ---------------------------------------------------------------------------

alter table public.products
  add column if not exists reserved_until timestamptz;

comment on column public.products.reserved_until is
  'When a reserved piece should return to available. Null means the hold has no automatic release.';

do $status$
begin
  if to_regclass('public.products') is null then
    raise exception 'public.products is missing. Run supabase/shop-products.sql first.';
  end if;

  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.products'::regclass
      and conname = 'products_status_check'
  ) then
    if not exists (
      select 1
      from pg_constraint
      where conrelid = 'public.products'::regclass
        and conname = 'products_status_check'
        and pg_get_constraintdef(oid) ilike '%reserved%'
    ) then
      alter table public.products drop constraint products_status_check;
      alter table public.products
        add constraint products_status_check
        check (status in ('available', 'reserved', 'sold', 'draft'));
    end if;
  else
    alter table public.products
      add constraint products_status_check
      check (status in ('available', 'reserved', 'sold', 'draft'));
  end if;
end
$status$;

-- ---------------------------------------------------------------------------
-- Offers: who sent it, when they have an account.
-- ---------------------------------------------------------------------------

alter table public.offers
  add column if not exists user_id uuid;

alter table public.offers drop constraint if exists offers_user_id_fkey;
alter table public.offers
  add constraint offers_user_id_fkey
  foreign key (user_id) references auth.users (id) on delete set null;

create index if not exists offers_user_idx
  on public.offers (user_id);

create index if not exists offers_email_unlinked_idx
  on public.offers (lower(btrim(email)))
  where user_id is null;

comment on column public.offers.user_id is
  'Account that sent the offer. Null for a guest offer. Set from auth.uid() on insert; never taken on trust from the browser.';

-- ---------------------------------------------------------------------------
-- Profiles.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  phone text,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles
  add column if not exists display_name text,
  add column if not exists phone text,
  add column if not exists marketing_consent boolean default false,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

update public.profiles
set marketing_consent = false
where marketing_consent is null;

alter table public.profiles
  alter column marketing_consent set default false;

alter table public.profiles
  alter column marketing_consent set not null;

alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length
  check (display_name is null or char_length(btrim(display_name)) between 1 and 120);

alter table public.profiles drop constraint if exists profiles_phone_length;
alter table public.profiles
  add constraint profiles_phone_length
  check (phone is null or char_length(btrim(phone)) between 1 and 40);

comment on table public.profiles is
  'Customer account details. marketing_consent defaults to false and is opt-in only.';

comment on column public.profiles.marketing_consent is
  'True only when the customer opted in to occasional shop emails. Defaults to false. PECR: do not send marketing without this.';

create or replace function public.profiles_before_write()
returns trigger
language plpgsql
set search_path = public
as $profiles$
begin
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  end if;

  if new.display_name is not null then
    new.display_name := nullif(btrim(new.display_name), '');
  end if;
  if new.phone is not null then
    new.phone := nullif(btrim(new.phone), '');
  end if;
  if new.marketing_consent is null then
    new.marketing_consent := false;
  end if;
  new.updated_at := now();
  return new;
end;
$profiles$;

drop trigger if exists profiles_before_write on public.profiles;
create trigger profiles_before_write
before insert or update on public.profiles
for each row
execute function public.profiles_before_write();

-- Creates the profile from the sign-up. Copies an optional display name and
-- the marketing choice from raw_user_meta_data. Consent stays false unless
-- the sign-up explicitly sent true. Also links guest offers when the email
-- is already confirmed (confirmations switched off).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $new_user$
declare
  chosen_name text;
  consent boolean := false;
  consent_text text;
begin
  chosen_name := nullif(btrim(coalesce(new.raw_user_meta_data->>'display_name', '')), '');
  if chosen_name is not null and char_length(chosen_name) > 120 then
    chosen_name := left(chosen_name, 120);
  end if;

  consent_text := lower(btrim(coalesce(new.raw_user_meta_data->>'marketing_consent', '')));
  consent := consent_text in ('true', 't', '1', 'yes');

  insert into public.profiles (id, display_name, marketing_consent)
  values (new.id, chosen_name, consent)
  on conflict (id) do nothing;

  if new.email_confirmed_at is not null
     and new.id is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
     and nullif(btrim(coalesce(new.email, '')), '') is not null then
    update public.offers
    set user_id = new.id
    where user_id is null
      and lower(btrim(email)) = lower(btrim(new.email));
  end if;

  return new;
end;
$new_user$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- After the customer confirms their email, or confirms a new email address,
-- attach guest offers that used that same confirmed address.
create or replace function public.link_guest_offers_on_confirm()
returns trigger
language plpgsql
security definer
set search_path = public
as $confirm$
begin
  if new.id is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
     and new.email_confirmed_at is not null
     and nullif(btrim(coalesce(new.email, '')), '') is not null
     and (
       old.email_confirmed_at is null
       or lower(btrim(coalesce(old.email, ''))) is distinct from lower(btrim(new.email))
     ) then
    update public.offers
    set user_id = new.id
    where user_id is null
      and lower(btrim(email)) = lower(btrim(new.email));
  end if;
  return new;
end;
$confirm$;

drop trigger if exists on_auth_user_confirmed on auth.users;
create trigger on_auth_user_confirmed
after update of email_confirmed_at, email on auth.users
for each row
execute function public.link_guest_offers_on_confirm();

-- Called from the account page as a fallback. Uses auth.uid() and the
-- confirmed email on auth.users. The browser cannot pass an email.
create or replace function public.link_guest_offers()
returns integer
language plpgsql
security definer
set search_path = public
as $link$
declare
  uid uuid := auth.uid();
  verified_email text;
  confirmed timestamptz;
  linked integer := 0;
begin
  if uid is null then
    return 0;
  end if;

  if uid = '222043d1-053b-45be-ab39-20216c84ee86'::uuid then
    return 0;
  end if;

  select lower(btrim(u.email)), u.email_confirmed_at
    into verified_email, confirmed
  from auth.users as u
  where u.id = uid;

  if confirmed is null or verified_email is null or verified_email = '' then
    return 0;
  end if;

  update public.offers
  set user_id = uid
  where user_id is null
    and lower(btrim(email)) = verified_email;

  get diagnostics linked = row_count;
  return linked;
end;
$link$;

-- ---------------------------------------------------------------------------
-- Offer trigger. Guests and customers cannot set status, a counter, or
-- somebody else's user id. Accepting a counter reserves the piece, unless
-- another buyer's hold is still running. The admin user is unchanged: the
-- cabinet can still edit any column.
-- ---------------------------------------------------------------------------

create or replace function public.offers_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $offers$
declare
  piece_status text;
  piece_until timestamptz;
  held_offer uuid;
  admin_uid uuid := '222043d1-053b-45be-ab39-20216c84ee86'::uuid;
begin
  if tg_op = 'INSERT'
    and auth.uid() is distinct from admin_uid then
    new.status := 'new';
    new.counter_amount := null;
    new.created_at := now();
    if auth.uid() is null then
      new.user_id := null;
    else
      new.user_id := auth.uid();
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.product_id is null then
      raise exception 'An offer needs a piece' using errcode = '23514';
    end if;

    select p.status into piece_status
    from public.products as p
    where p.id = new.product_id;

    if piece_status is null or piece_status not in ('available', 'reserved') then
      raise exception 'Offers are only open on available or reserved pieces'
        using errcode = '23514';
    end if;

    new.name := btrim(new.name);
    new.email := btrim(new.email);
    new.product_title := btrim(new.product_title);
    if new.phone is not null then
      new.phone := nullif(btrim(new.phone), '');
    end if;
    if new.message is not null then
      new.message := nullif(btrim(new.message), '');
    end if;
  end if;

  -- Account deletion sets ccc.account_maintenance for this transaction so it
  -- can anonymise offers. Customers cannot set that through the website API.
  -- A missing JWT (the monthly job) is also allowed through: there is no
  -- customer to impersonate. A signed-in customer who is not the admin can
  -- only accept or decline their own counter-offer. Accepting reserves the
  -- piece, unless it is already reserved for a different offer until a time
  -- that has not yet passed. The admin cabinet is not limited here.
  if tg_op = 'UPDATE'
    and current_setting('ccc.account_maintenance', true) is distinct from 'on'
    and auth.uid() is not null
    and auth.uid() is distinct from admin_uid then
    if old.user_id is distinct from auth.uid() then
      raise exception 'You cannot change this offer' using errcode = '42501';
    end if;

    new.id := old.id;
    new.user_id := old.user_id;
    new.product_id := old.product_id;
    new.product_title := old.product_title;
    new.name := old.name;
    new.email := old.email;
    new.phone := old.phone;
    new.amount := old.amount;
    new.option := old.option;
    new.message := old.message;
    new.counter_amount := old.counter_amount;
    new.created_at := old.created_at;

    if old.status is distinct from 'countered'
       or new.status not in ('accepted', 'declined') then
      raise exception 'You cannot change this offer' using errcode = '42501';
    end if;

    if new.status = 'accepted' then
      if old.product_id is null then
        raise exception 'This piece cannot be reserved just now' using errcode = '23514';
      end if;

      select p.status, p.reserved_until
      into piece_status, piece_until
      from public.products as p
      where p.id = old.product_id
      for update;

      if piece_status is null or piece_status not in ('available', 'reserved') then
        raise exception 'This piece cannot be reserved just now' using errcode = '23514';
      end if;

      -- A live hold is reserved, still in the future, and recorded against
      -- another offer. An expired or empty reserved_until, a piece that is
      -- available again, or the same offer, can still be accepted. Raising
      -- here rolls the update back, so the existing hold row is not replaced
      -- and the first customer is not emailed about a lost hold.
      held_offer := null;
      if piece_status = 'reserved'
         and piece_until > now()
         and to_regclass('public.offer_holds') is not null then
        select h.offer_id into held_offer
        from public.offer_holds as h
        where h.product_id = old.product_id
        for update;

        if held_offer is not null and held_offer is distinct from old.id then
          raise exception 'Sorry, this piece is currently reserved for another buyer.'
            using errcode = '23514';
        end if;
      end if;

      -- 'no' means this accept may take the hold. offer_email_remember_hold
      -- runs after reserved_until has moved, so it cannot tell an expired
      -- hold from the three days just written here. The flag is local to
      -- this transaction. A refusal above never reaches this line.
      perform set_config('ccc.hold_takeover_blocked', 'no', true);

      update public.products
      set status = 'reserved',
          reserved_until = now() + interval '3 days',
          updated_at = now()
      where id = old.product_id;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$offers$;

drop trigger if exists offers_before_write on public.offers;
create trigger offers_before_write
before insert or update on public.offers
for each row
execute function public.offers_before_write();

-- The account page calls this. It checks the caller, then updates the offer.
-- The trigger above is what reserves the piece, and it only does that for
-- the customer who owns a countered offer. It refuses when another buyer's
-- hold is still running. The admin cabinet does not use this function; its
-- own updates are left alone because auth.uid() is the admin id.
create or replace function public.respond_to_counter(offer_id uuid, decision text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $respond$
declare
  uid uuid := auth.uid();
  row public.offers;
  held timestamptz;
begin
  if uid is null then
    raise exception 'Sign in to reply to this offer' using errcode = '42501';
  end if;

  if uid = '222043d1-053b-45be-ab39-20216c84ee86'::uuid then
    raise exception 'Use the cabinet to manage offers' using errcode = '42501';
  end if;

  if offer_id is null or decision not in ('accept', 'decline') then
    raise exception 'Choose accept or decline' using errcode = '22023';
  end if;

  select * into row
  from public.offers
  where id = offer_id
  for update;

  if not found or row.user_id is distinct from uid then
    raise exception 'That offer is not on your account' using errcode = '42501';
  end if;

  if row.status is distinct from 'countered' or row.counter_amount is null then
    raise exception 'There is no counter-offer to answer' using errcode = '22023';
  end if;

  update public.offers
  set status = case when decision = 'accept' then 'accepted' else 'declined' end
  where id = row.id
  returning * into row;

  held := null;
  if decision = 'accept' and row.product_id is not null then
    select p.reserved_until into held
    from public.products as p
    where p.id = row.product_id;
  end if;

  return jsonb_build_object(
    'id', row.id,
    'status', row.status,
    'product_id', row.product_id,
    'product_title', row.product_title,
    'counter_amount', row.counter_amount,
    'reserved_until', held
  );
end;
$respond$;

-- ---------------------------------------------------------------------------
-- Deletion. One internal function, used by the customer RPC and by the
-- monthly job. The website role cannot call the internal function.
-- ---------------------------------------------------------------------------

create or replace function public.delete_customer_account(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $delete_account$
declare
  verified_email text;
  removed_email text;
begin
  if target is null then
    raise exception 'No account to delete' using errcode = '22023';
  end if;

  if target = '222043d1-053b-45be-ab39-20216c84ee86'::uuid then
    raise exception 'The shop account cannot be deleted this way' using errcode = '42501';
  end if;

  -- security definer runs as the function owner, so current_user is not
  -- the caller. The JWT still is. A customer may only delete themselves.
  -- The monthly job has no JWT and is allowed through.
  if coalesce(auth.role(), '') in ('anon', 'authenticated')
     and auth.uid() is distinct from target then
    raise exception 'You can only delete your own account' using errcode = '42501';
  end if;

  -- Lets the offer trigger allow this anonymising update. Local to this
  -- transaction, and only set inside this function.
  perform set_config('ccc.account_maintenance', 'on', true);

  select lower(btrim(u.email)) into verified_email
  from auth.users as u
  where u.id = target;

  removed_email := 'removed+' || replace(target::text, '-', '') || '@removed.invalid';

  update public.offers
  set
    user_id = null,
    name = 'Former customer',
    email = removed_email,
    phone = null,
    message = null
  where user_id = target
     or (
       user_id is null
       and verified_email is not null
       and verified_email <> ''
       and lower(btrim(email)) = verified_email
     );

  delete from public.profiles where id = target;
  delete from auth.users where id = target;
end;
$delete_account$;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $delete_mine$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in before deleting your account' using errcode = '42501';
  end if;

  if uid = '222043d1-053b-45be-ab39-20216c84ee86'::uuid then
    raise exception 'The shop account cannot be deleted this way' using errcode = '42501';
  end if;

  perform public.delete_customer_account(uid);
end;
$delete_mine$;

create or replace function public.delete_inactive_accounts()
returns integer
language plpgsql
security definer
set search_path = public
as $inactive$
declare
  gone integer := 0;
  victim uuid;
begin
  -- No customer JWT is allowed to run this, even if a grant is added later.
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'This job is not available to customer accounts' using errcode = '42501';
  end if;

  for victim in
    select u.id
    from auth.users as u
    where u.id is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
      and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '1 year'
  loop
    perform public.delete_customer_account(victim);
    gone := gone + 1;
  end loop;

  return gone;
end;
$inactive$;

create or replace function public.release_expired_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $release$
declare
  released integer := 0;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'This job is not available to customer accounts' using errcode = '42501';
  end if;

  update public.products
  set status = 'available',
      reserved_until = null,
      updated_at = now()
  where status = 'reserved'
    and reserved_until is not null
    and reserved_until <= now();

  get diagnostics released = row_count;
  return released;
end;
$release$;

-- ---------------------------------------------------------------------------
-- Row level security.
-- Customers read and update only their own profile, and only read their
-- own offers. Accept and decline go through respond_to_counter, which
-- checks user_id. There is no customer update or delete policy on offers,
-- products, or sales. The admin policies still require the admin uuid.
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.offers enable row level security;
alter table public.sales enable row level security;

revoke all on table public.profiles from public, anon, authenticated;
grant select, insert, update on table public.profiles to authenticated;

drop policy if exists "Customers read own profile" on public.profiles;
create policy "Customers read own profile"
on public.profiles
for select
to authenticated
using (
  id = auth.uid()
  or auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Customers insert own profile" on public.profiles;
create policy "Customers insert own profile"
on public.profiles
for insert
to authenticated
with check (
  id = auth.uid()
  and auth.uid() is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Customers update own profile" on public.profiles;
create policy "Customers update own profile"
on public.profiles
for update
to authenticated
using (
  id = auth.uid()
  and auth.uid() is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
)
with check (
  id = auth.uid()
  and auth.uid() is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

revoke all on table public.offers from public, anon, authenticated;
grant insert on table public.offers to anon, public;
grant insert on table public.offers to authenticated;
grant select, update, delete on table public.offers to authenticated;

-- Same guest checks as shop-notifications.sql, plus user_id. The trigger
-- stamps user_id before this check runs. A guest cannot claim an account.
-- A customer cannot claim someone else's.
drop policy if exists "Public insert new offers" on public.offers;
create policy "Public insert new offers"
on public.offers
for insert
to anon, authenticated, public
with check (
  status = 'new'
  and counter_amount is null
  and product_id is not null
  and amount > 0
  and amount <= 99999999.99
  and option in ('delivered', 'item', 'collection')
  and char_length(btrim(name)) between 1 and 120
  and char_length(btrim(email)) between 3 and 200
  and btrim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and (phone is null or char_length(btrim(phone)) between 1 and 40)
  and char_length(btrim(product_title)) between 1 and 200
  and (message is null or char_length(message) <= 2000)
  and (
    (auth.uid() is null and user_id is null)
    or (
      auth.uid() is not null
      and auth.uid() is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
      and user_id = auth.uid()
    )
    or auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
  )
);

drop policy if exists "Customers read own offers" on public.offers;
create policy "Customers read own offers"
on public.offers
for select
to authenticated
using (
  user_id = auth.uid()
  and auth.uid() is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Admin manages offers" on public.offers;
create policy "Admin manages offers"
on public.offers
for all
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid)
with check (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

revoke all on table public.sales from public, anon, authenticated;
grant select, insert, update, delete on table public.sales to authenticated;

drop policy if exists "Admin manages sales" on public.sales;
create policy "Admin manages sales"
on public.sales
for all
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid)
with check (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

-- Product policies are left as shop-products.sql set them: visitors read
-- available, reserved, and sold; only the admin uuid can write. This file
-- only adds reserved_until, which those policies already cover.
-- No customer policy is added on public.products.

-- ---------------------------------------------------------------------------
-- Function privileges. Trigger helpers and the internal delete / job
-- functions are not callable from the website. Three RPCs are.
-- ---------------------------------------------------------------------------

revoke all on function public.handle_new_user() from public, anon, authenticated;
revoke all on function public.link_guest_offers_on_confirm() from public, anon, authenticated;
revoke all on function public.profiles_before_write() from public, anon, authenticated;
revoke all on function public.offers_before_write() from public, anon, authenticated;
revoke all on function public.delete_customer_account(uuid) from public, anon, authenticated;
revoke all on function public.delete_inactive_accounts() from public, anon, authenticated;
revoke all on function public.release_expired_reservations() from public, anon, authenticated;

revoke all on function public.link_guest_offers() from public, anon;
grant execute on function public.link_guest_offers() to authenticated;

revoke all on function public.respond_to_counter(uuid, text) from public, anon;
grant execute on function public.respond_to_counter(uuid, text) to authenticated;

revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ---------------------------------------------------------------------------
-- Schedules. Failure here does not undo the tables. Enable pg_cron first
-- (see the header) and run this script again if you see the notice.
-- Times are UTC. Hourly at minute 0. Monthly at 03:00 on the 1st.
-- ---------------------------------------------------------------------------

do $cron$
declare
  existing bigint;
begin
  begin
    create extension if not exists pg_cron;
  exception
    when others then
      raise notice 'pg_cron is not enabled yet (%). Dashboard → Database → Extensions → pg_cron → Enable, then run supabase/customer-accounts.sql again. Accounts still work; expired holds are hidden by the shop until the job exists.', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  select jobid into existing from cron.job where jobname = 'release-expired-reservations';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;

  perform cron.schedule(
    'release-expired-reservations',
    '0 * * * *',
    'select public.release_expired_reservations()'
  );

  existing := null;
  select jobid into existing from cron.job where jobname = 'delete-inactive-accounts';
  if existing is not null then
    perform cron.unschedule(existing);
  end if;

  perform cron.schedule(
    'delete-inactive-accounts',
    '0 3 1 * *',
    'select public.delete_inactive_accounts()'
  );
exception
  when others then
    raise notice 'Accounts are ready. The pg_cron jobs were not scheduled (%). Enable pg_cron, then run this script again.', sqlerrm;
end
$cron$;
