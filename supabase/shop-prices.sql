-- Three prices for each piece in public.products.
--
-- Run this once in the Supabase SQL editor if the products table already
-- exists (Dashboard → SQL Editor → New query → paste → Run). A fresh
-- database gets the columns from shop-products.sql instead.
--
--   * price_delivered — full price, including UK delivery by the shop.
--   * price_item — the piece on its own, for a buyer who arranges their own courier.
--   * price_collection — collect in person from Wisbech.
--
-- Each column is optional. Null means that option is not offered.
-- The original price column stays, so anything still reading it keeps working.
-- On save, the cabinet sets price to price_delivered when that is filled in,
-- and otherwise to the lowest price offered.
--
-- Re-running is safe. Columns are added only when missing. The backfill copies
-- price into price_delivered only when all three new prices are still empty,
-- so a later run does not put a delivery price back onto a piece that offers
-- collection or an item-only price instead.
--
-- This script does not alter storage.objects, does not change storage
-- policies, and does not change row level security. The existing product
-- policies already cover new columns.

alter table public.products
  add column if not exists price_delivered numeric(10, 2)
    constraint products_price_delivered_check check (price_delivered >= 0),
  add column if not exists price_item numeric(10, 2)
    constraint products_price_item_check check (price_item >= 0),
  add column if not exists price_collection numeric(10, 2)
    constraint products_price_collection_check check (price_collection >= 0);

update public.products
set price_delivered = price
where price_delivered is null
  and price_item is null
  and price_collection is null;

comment on column public.products.price is
  'Headline price in pounds. The cabinet sets this to price_delivered when delivery is offered, otherwise to the lowest price offered.';

comment on column public.products.price_delivered is
  'Full price in pounds, including UK delivery by the shop. Null means delivery is not offered.';

comment on column public.products.price_item is
  'Item-only price in pounds, for a buyer who arranges their own courier. Null means this option is not offered.';

comment on column public.products.price_collection is
  'Price in pounds to collect in person from Wisbech. Null means collection is not offered.';
