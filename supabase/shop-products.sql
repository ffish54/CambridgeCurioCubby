-- Shop products for the Curio Cabinet desk (admin.html → Shop)
-- and the public shelf (shop.html).
--
-- The site only has the publishable key in assets/js/supabase-config.js.
-- It cannot create this table or the product-images bucket. Run this script
-- once in the Supabase SQL editor (Dashboard → SQL Editor → New query →
-- paste → Run).
--
-- Keep the admin uuid below identical to ADMIN_USER_ID in
-- assets/js/supabase-config.js. Client checks are not the security boundary.
-- These policies are. Do not put the service_role key in the website.
--
-- What this sets up
--   * public.products — one row per piece. status draft is hidden.
--     available, reserved, and sold are readable by anyone.
--   * Insert, update, and delete only for the one admin user.
--   * updated_at maintained by a trigger.
--   * Bucket product-images, public, so photographs load at
--     /storage/v1/object/public/product-images/...
--   * 5 MB file size limit and JPEG, PNG, WebP, GIF only (server-side),
--     when the bucket row is created by this script.
--   * SELECT on product-images for the public role.
--   * INSERT, UPDATE, and DELETE on product-images only for the admin user.
--
-- Storage notes (learned from journal-covers)
--   * Do not alter table storage.objects. In the SQL editor this user is
--     not the owner of that table, and RLS is already enabled on it.
--   * The bucket insert uses on conflict do nothing. If it does nothing,
--     or if it is refused, create the bucket in Dashboard → Storage:
--     name product-images, public, 5 MB, MIME types image/jpeg, image/png,
--     image/webp, image/gif. Then run this script again so the policies exist.
--
-- Re-running the script is safe: the table is created only if missing,
-- policies are replaced, and the bucket insert does not overwrite an
-- existing bucket.

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  category text not null,
  price numeric(10, 2) not null,
  condition text,
  era text,
  maker text,
  dimensions text,
  description text,
  status text not null default 'draft',
  featured boolean not null default false,
  sort_order integer not null default 0,
  images text[] not null default '{}',
  cover_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_slug_key unique (slug),
  constraint products_slug_format check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 80),
  constraint products_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint products_category_check check (
    category in (
      'Glass & Crystal',
      'Ceramics & Pottery',
      'Brass & Metalwork',
      'Collectables',
      'Decorative',
      'Curious Things'
    )
  ),
  constraint products_status_check check (status in ('available', 'reserved', 'sold', 'draft')),
  constraint products_price_check check (price >= 0 and price <= 99999999.99),
  constraint products_images_limit check (cardinality(images) <= 12)
);

comment on table public.products is
  'Curio Cubbyhole shop pieces. Drafts are private to the admin user.';

create index if not exists products_shelf_idx
  on public.products (status, sort_order, created_at desc);

create index if not exists products_category_idx
  on public.products (category);

create or replace function public.touch_product_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at
before update on public.products
for each row
execute function public.touch_product_updated_at();

alter table public.products enable row level security;

revoke all on table public.products from public, anon, authenticated;
grant select on table public.products to anon, authenticated;
grant insert, update, delete on table public.products to authenticated;

drop policy if exists "Public read listed products" on public.products;
create policy "Public read listed products"
on public.products
for select
to anon, authenticated
using (status in ('available', 'reserved', 'sold'));

drop policy if exists "Admin manages products" on public.products;
create policy "Admin manages products"
on public.products
for all
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid)
with check (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

-- Bucket. on conflict do nothing so a bucket created in the dashboard is left
-- as the owner set it. This block does not alter storage.objects.
do $bucket$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values (
    'product-images',
    'product-images',
    true,
    5242880,
    array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
  )
  on conflict (id) do nothing;
exception
  when insufficient_privilege then
    raise notice 'Could not insert product-images into storage.buckets. Create a public bucket named product-images in Dashboard → Storage (5 MB, JPEG/PNG/WebP/GIF), then run this script again for the policies.';
end
$bucket$;

-- Policies only. RLS is already enabled on storage.objects; do not alter that table.
drop policy if exists "Public read product images" on storage.objects;
create policy "Public read product images"
on storage.objects
for select
to public
using (bucket_id = 'product-images');

drop policy if exists "Admin insert product images" on storage.objects;
create policy "Admin insert product images"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'product-images'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Admin update product images" on storage.objects;
create policy "Admin update product images"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'product-images'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
)
with check (
  bucket_id = 'product-images'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Admin delete product images" on storage.objects;
create policy "Admin delete product images"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'product-images'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);
