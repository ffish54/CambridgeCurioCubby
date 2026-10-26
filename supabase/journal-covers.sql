-- Journal cover images for the Curio Cabinet desk (admin.html).
--
-- The site only has the publishable key in assets/js/supabase-config.js.
-- It cannot create this bucket. Run this script once in the Supabase SQL editor
-- (Dashboard → SQL Editor → New query → paste → Run).
--
-- Keep the admin uuid below identical to ADMIN_USER_ID in
-- assets/js/supabase-config.js. Client checks are not the security boundary.
-- These storage policies are. Do not put the service_role key in the website.
--
-- What this sets up
--   * Bucket journal-covers, public, so cover images load on the public journal
--     at /storage/v1/object/public/journal-covers/...
--   * 5 MB file size limit and JPEG, PNG, WebP, GIF only (server-side).
--   * SELECT for the public role (anonymous visitors included).
--   * INSERT, UPDATE, and DELETE only for the one admin user.
--
-- Re-running the script is safe: the bucket row is updated, and the four
-- policies are replaced.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'journal-covers',
  'journal-covers',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table storage.objects enable row level security;

drop policy if exists "Public read journal covers" on storage.objects;
create policy "Public read journal covers"
on storage.objects
for select
to public
using (bucket_id = 'journal-covers');

drop policy if exists "Admin insert journal covers" on storage.objects;
create policy "Admin insert journal covers"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'journal-covers'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Admin update journal covers" on storage.objects;
create policy "Admin update journal covers"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'journal-covers'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
)
with check (
  bucket_id = 'journal-covers'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);

drop policy if exists "Admin delete journal covers" on storage.objects;
create policy "Admin delete journal covers"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'journal-covers'
  and auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid
);
