# Shop setup

The public site cannot create the products table or the image bucket. Run this once in Supabase, then add pieces from the cabinet. Nothing in the GitHub repo needs to change when a piece is added, sold, or withdrawn.

Admin account (must match `ADMIN_USER_ID` in `assets/js/supabase-config.js`):

`222043d1-053b-45be-ab39-20216c84ee86`

## 1. Run the SQL

1. Open the Supabase dashboard for this project.
2. Go to **SQL Editor → New query**.
3. Paste the whole of `supabase/shop-products.sql`.
4. Choose **Run**.

The script is safe to run again. It creates `public.products` if it is missing, replaces the shop policies, and does not alter `storage.objects` (row level security on that table is already on, and the SQL editor user is not its owner).

What you should see:

- Table `products` under **Table Editor**, with statuses `available`, `reserved`, `sold`, and `draft`.
- Policies on `products`: visitors can read available, reserved, and sold rows. Only the admin user can insert, update, or delete. Drafts stay off the public shop.
- Four storage policies whose names start with “Public read product images” and “Admin … product images”.

## 2. Confirm the bucket

1. Open **Storage**.
2. Confirm a bucket named `product-images` exists.
3. Confirm it is **public** (photographs load without a login).
4. If the SQL notice said the bucket could not be created, choose **New bucket**:
   - Name: `product-images`
   - Public: on
   - File size limit: 5 MB
   - Allowed MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/gif`
5. Run `supabase/shop-products.sql` again so the four policies exist. An existing bucket is left as it is (`on conflict do nothing`). If you created the bucket earlier and it is private, switch it to public in the bucket settings. The script will not overwrite that setting.

## 3. Add pieces from the desk

1. Open `admin.html` on the site and sign in as the admin account (the same login as the journal).
2. Choose the **Shop** tab (or open `admin.html#shop`).
3. Choose **New piece**. The slug fills in from the title.
4. Set the category, price in pounds, and status. **Draft** stays off the shop. **Available**, **Reserved**, and **Sold** appear on the shelf. Sold pieces sit last and wear a Sold badge.
5. Choose photographs (JPEG, PNG, WebP, or GIF, up to 5 MB each, 12 per piece), then **Upload**. Reorder them, pick the cover, and remove any you do not want. Save the piece to keep the photographs.
6. If upload says the bucket is missing, go back to step 2. The page cannot create the bucket itself.

## 4. Look at the shelf

- Shop: `shop.html`
- One piece: `shop.html?item=your-slug`
- A category from the home page cards: `shop.html?category=Glass%20%26%20Crystal` (and the other five category names)
- Search: `shop.html?q=murano`
- Home “Recently Discovered” shows the latest pieces that are not drafts, once any exist.

Enquiries go to `curiocubbyhole@gmail.com` with the piece title and link filled in. There is no basket.
