-- Stop a second customer taking a hold that already belongs to someone else.
--
-- Run this in the Supabase SQL editor after supabase/customer-accounts.sql
-- and supabase/offer-emails.sql (Dashboard → SQL Editor → New query →
-- paste → Run). It is safe to run again. Running it does not email anyone,
-- and it does not alter storage.objects, storage buckets, or storage policies.
--
-- What it changes
--   * offers_before_write refuses a customer accept when the piece is
--     reserved, reserved_until is still in the future, and offer_holds
--     belongs to a different offer. The message is:
--     Sorry, this piece is currently reserved for another buyer.
--     The offer update is rolled back, so the existing hold row and the
--     first customer's emails are left as they were. Once the piece is
--     available again, or reserved_until is empty or already past,
--     accepting works as before.
--   * offer_email_remember_hold will not overwrite offer_holds for a
--     different offer while that hold is still active.
--   * The admin cabinet can read offer_holds, so it can warn before sending
--     a counter-offer. Customers still cannot read the table. The cabinet
--     is not blocked from sending the counter-offer.
--
-- The function bodies match supabase/customer-accounts.sql and
-- supabase/offer-emails.sql. A fresh install that runs those files does
-- not need this one. Use this file on a database that already ran the
-- earlier copies.

do $hold_takeover_ready$
begin
  if to_regclass('public.offers') is null or to_regclass('public.products') is null then
    raise exception 'Offers are not installed yet. Run supabase/customer-accounts.sql first, then supabase/hold-takeover-fix.sql.';
  end if;
  if to_regclass('public.offer_holds') is null then
    raise exception 'public.offer_holds is missing. Run supabase/offer-emails.sql first, then supabase/hold-takeover-fix.sql.';
  end if;
end
$hold_takeover_ready$;

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

create or replace function public.offer_email_remember_hold(p_offer_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $remember$
begin
  -- ccc.hold_takeover_blocked is set to 'no' by offers_before_write only
  -- after a customer accept has been allowed to take the hold, including
  -- when the previous hold has already expired or been released. This runs
  -- after reserved_until has moved forward, so that flag is what tells an
  -- allowed replacement from a hold that was already active. When the flag
  -- is unset (the cabinet, or SQL), an active hold for a different offer
  -- is left as it is: the row, and the emails that follow it, stay with
  -- the first customer. A refused accept never reaches this function.
  if current_setting('ccc.hold_takeover_blocked', true) = 'yes' then
    return;
  end if;

  insert into public.offer_holds (product_id, offer_id)
  select p.id, p_offer_id
  from public.products as p
  where p.id = p_product_id
    and p.status = 'reserved'
    and (
      current_setting('ccc.hold_takeover_blocked', true) = 'no'
      or not exists (
        select 1
        from public.offer_holds as existing
        where existing.product_id = p.id
          and existing.offer_id is distinct from p_offer_id
          and p.status = 'reserved'
          and p.reserved_until > pg_catalog.now()
      )
    )
  on conflict (product_id) do update
  set offer_id = excluded.offer_id,
      created_at = pg_catalog.now()
  where current_setting('ccc.hold_takeover_blocked', true) = 'no'
     or offer_holds.offer_id is not distinct from excluded.offer_id
     or not exists (
       select 1
       from public.products as held_piece
       where held_piece.id = offer_holds.product_id
         and held_piece.status = 'reserved'
         and held_piece.reserved_until > pg_catalog.now()
     );
exception
  when others then
    null;
end;
$remember$;

alter table public.offer_holds enable row level security;

revoke all on table public.offer_holds from public, anon, authenticated;
grant select on table public.offer_holds to authenticated;

drop policy if exists "Admin reads offer holds" on public.offer_holds;
create policy "Admin reads offer holds"
on public.offer_holds
for select
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);
