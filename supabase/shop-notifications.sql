-- Offers and sales for the Curio Cabinet (admin.html → Notifications)
-- and the public piece page (shop.html → Make an offer).
--
-- The site only has the publishable key in assets/js/supabase-config.js.
-- It cannot create these tables. Run this script once in the Supabase SQL
-- editor (Dashboard → SQL Editor → New query → paste → Run).
--
-- Keep the admin uuid below identical to ADMIN_USER_ID in
-- assets/js/supabase-config.js. Client checks are not the security boundary.
-- These policies are. Do not put the service_role key in the website.
--
-- What this sets up
--   * public.offers — one row per customer offer. Visitors may insert a
--     new offer only. They cannot read offers back. The row stores the
--     customer's name, email, and optional phone so the shop can reply.
--   * public.sales — one row per sale, recorded by the admin. A future
--     Stripe or Square webhook can insert rows with the service role
--     (that role bypasses these policies). payment_ref and source are
--     there for that webhook. Visitors cannot read or write sales.
--   * updated_at maintained by triggers.
--   * Offers on a piece that is not available or reserved are refused.
--
-- This script does not alter storage.objects, storage.buckets, or storage
-- policies. Re-running it is safe: tables are created only if missing,
-- columns are added only if missing, and policies are replaced.

create table if not exists public.offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid,
  product_title text not null,
  name text not null,
  email text not null,
  phone text,
  amount numeric(10, 2) not null,
  option text not null,
  message text,
  status text not null default 'new',
  counter_amount numeric(10, 2),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.offers
  add column if not exists product_id uuid,
  add column if not exists product_title text,
  add column if not exists name text,
  add column if not exists email text,
  add column if not exists phone text,
  add column if not exists amount numeric(10, 2),
  add column if not exists option text,
  add column if not exists message text,
  add column if not exists status text default 'new',
  add column if not exists counter_amount numeric(10, 2),
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.offers drop constraint if exists offers_product_id_fkey;
alter table public.offers
  add constraint offers_product_id_fkey
  foreign key (product_id) references public.products (id) on delete set null;

alter table public.offers drop constraint if exists offers_amount_check;
alter table public.offers
  add constraint offers_amount_check
  check (amount > 0 and amount <= 99999999.99);

alter table public.offers drop constraint if exists offers_counter_amount_check;
alter table public.offers
  add constraint offers_counter_amount_check
  check (counter_amount is null or (counter_amount > 0 and counter_amount <= 99999999.99));

alter table public.offers drop constraint if exists offers_status_check;
alter table public.offers
  add constraint offers_status_check
  check (status in ('new', 'read', 'accepted', 'declined', 'countered', 'archived'));

alter table public.offers drop constraint if exists offers_counter_status_check;
alter table public.offers
  add constraint offers_counter_status_check
  check (status <> 'countered' or counter_amount is not null);

alter table public.offers drop constraint if exists offers_option_check;
alter table public.offers
  add constraint offers_option_check
  check (option in ('delivered', 'item', 'collection'));

alter table public.offers drop constraint if exists offers_name_length;
alter table public.offers
  add constraint offers_name_length
  check (char_length(btrim(name)) between 1 and 120);

alter table public.offers drop constraint if exists offers_email_length;
alter table public.offers
  add constraint offers_email_length
  check (
    char_length(btrim(email)) between 3 and 200
    and btrim(email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

alter table public.offers drop constraint if exists offers_phone_length;
alter table public.offers
  add constraint offers_phone_length
  check (phone is null or char_length(btrim(phone)) between 1 and 40);

alter table public.offers drop constraint if exists offers_title_length;
alter table public.offers
  add constraint offers_title_length
  check (char_length(btrim(product_title)) between 1 and 200);

alter table public.offers drop constraint if exists offers_message_length;
alter table public.offers
  add constraint offers_message_length
  check (message is null or char_length(message) <= 2000);

create index if not exists offers_created_idx
  on public.offers (created_at desc);

create index if not exists offers_status_idx
  on public.offers (status, created_at desc);

create index if not exists offers_product_idx
  on public.offers (product_id);

comment on table public.offers is
  'Customer offers from the shop. Stores name, email, and optional phone so the shop can reply. Visitors may insert a new offer only.';

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  product_id uuid,
  product_title text not null,
  amount numeric(10, 2) not null,
  option text not null,
  buyer_name text,
  buyer_email text,
  channel text not null,
  notes text,
  sold_at timestamptz not null default now(),
  payment_ref text,
  source text,
  offer_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.sales
  add column if not exists product_id uuid,
  add column if not exists product_title text,
  add column if not exists amount numeric(10, 2),
  add column if not exists option text,
  add column if not exists buyer_name text,
  add column if not exists buyer_email text,
  add column if not exists channel text,
  add column if not exists notes text,
  add column if not exists sold_at timestamptz default now(),
  add column if not exists payment_ref text,
  add column if not exists source text,
  add column if not exists offer_id uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now();

alter table public.sales drop constraint if exists sales_product_id_fkey;
alter table public.sales
  add constraint sales_product_id_fkey
  foreign key (product_id) references public.products (id) on delete set null;

alter table public.sales drop constraint if exists sales_offer_id_fkey;
alter table public.sales
  add constraint sales_offer_id_fkey
  foreign key (offer_id) references public.offers (id) on delete set null;

alter table public.sales drop constraint if exists sales_amount_check;
alter table public.sales
  add constraint sales_amount_check
  check (amount >= 0 and amount <= 99999999.99);

alter table public.sales drop constraint if exists sales_option_check;
alter table public.sales
  add constraint sales_option_check
  check (option in ('delivered', 'item', 'collection', 'other'));

alter table public.sales drop constraint if exists sales_channel_check;
alter table public.sales
  add constraint sales_channel_check
  check (channel in ('website', 'etsy', 'ebay', 'vinted', 'in_person', 'other'));

alter table public.sales drop constraint if exists sales_source_check;
alter table public.sales
  add constraint sales_source_check
  check (
    source is null
    or (char_length(source) between 1 and 40 and source ~ '^[a-z0-9_]+$')
  );

alter table public.sales drop constraint if exists sales_payment_ref_length;
alter table public.sales
  add constraint sales_payment_ref_length
  check (payment_ref is null or char_length(btrim(payment_ref)) between 1 and 200);

alter table public.sales drop constraint if exists sales_buyer_name_length;
alter table public.sales
  add constraint sales_buyer_name_length
  check (buyer_name is null or char_length(btrim(buyer_name)) between 1 and 120);

alter table public.sales drop constraint if exists sales_buyer_email_length;
alter table public.sales
  add constraint sales_buyer_email_length
  check (
    buyer_email is null
    or (
      char_length(btrim(buyer_email)) between 3 and 200
      and btrim(buyer_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    )
  );

alter table public.sales drop constraint if exists sales_notes_length;
alter table public.sales
  add constraint sales_notes_length
  check (notes is null or char_length(notes) <= 2000);

alter table public.sales drop constraint if exists sales_title_length;
alter table public.sales
  add constraint sales_title_length
  check (char_length(btrim(product_title)) between 1 and 200);

create index if not exists sales_sold_at_idx
  on public.sales (sold_at desc);

create index if not exists sales_product_idx
  on public.sales (product_id);

create unique index if not exists sales_offer_id_key
  on public.sales (offer_id)
  where offer_id is not null;

create unique index if not exists sales_payment_ref_key
  on public.sales (source, payment_ref)
  where payment_ref is not null and source is not null;

comment on table public.sales is
  'Sales recorded by the admin. payment_ref and source are for a future Stripe or Square webhook using the service role.';

comment on column public.sales.payment_ref is
  'Nullable reference from a payment provider, such as a Stripe or Square payment id.';

comment on column public.sales.source is
  'Nullable origin of the row: admin, offer, stripe, square, or a later provider. A webhook sets this.';

create or replace function public.offers_before_write()
returns trigger
language plpgsql
set search_path = public
as $offers$
declare
  piece_status text;
begin
  if tg_op = 'INSERT'
    and auth.uid() is distinct from '222043d1-053b-45be-ab39-20216c84ee86'::uuid then
    new.status := 'new';
    new.counter_amount := null;
    new.created_at := now();
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

  new.updated_at := now();
  return new;
end;
$offers$;

drop trigger if exists offers_before_write on public.offers;
create trigger offers_before_write
before insert or update on public.offers
for each row
execute function public.offers_before_write();

create or replace function public.sales_before_write()
returns trigger
language plpgsql
set search_path = public
as $sales$
begin
  if new.buyer_name is not null then
    new.buyer_name := nullif(btrim(new.buyer_name), '');
  end if;
  if new.buyer_email is not null then
    new.buyer_email := nullif(btrim(new.buyer_email), '');
  end if;
  if new.notes is not null then
    new.notes := nullif(btrim(new.notes), '');
  end if;
  if new.payment_ref is not null then
    new.payment_ref := nullif(btrim(new.payment_ref), '');
  end if;
  if new.product_title is not null then
    new.product_title := btrim(new.product_title);
  end if;
  new.updated_at := now();
  return new;
end;
$sales$;

drop trigger if exists sales_before_write on public.sales;
create trigger sales_before_write
before insert or update on public.sales
for each row
execute function public.sales_before_write();

alter table public.offers enable row level security;
alter table public.sales enable row level security;

revoke all on table public.offers from public, anon, authenticated;
grant insert on table public.offers to anon, public;
grant select, update, delete on table public.offers to authenticated;

revoke all on table public.sales from public, anon, authenticated;
grant select, insert, update, delete on table public.sales to authenticated;

drop policy if exists "Public insert new offers" on public.offers;
create policy "Public insert new offers"
on public.offers
for insert
to anon, public
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
);

drop policy if exists "Admin manages offers" on public.offers;
create policy "Admin manages offers"
on public.offers
for all
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid)
with check (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

drop policy if exists "Admin manages sales" on public.sales;
create policy "Admin manages sales"
on public.sales
for all
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid)
with check (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

-- Optional live updates for the cabinet. Failure here does not undo the tables.
do $publication$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'offers'
    ) then
      alter publication supabase_realtime add table public.offers;
    end if;
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'sales'
    ) then
      alter publication supabase_realtime add table public.sales;
    end if;
  end if;
exception
  when others then
    raise notice 'Offers and sales are ready. Realtime was not enabled (%). Use Refresh on the Notifications tab.', sqlerrm;
end
$publication$;
