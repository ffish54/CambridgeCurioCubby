-- Offer emails for Cambridge Curio Cubbyhole.
--
-- Run this in the Supabase SQL editor after supabase/shop-notifications.sql
-- and supabase/customer-accounts.sql (Dashboard → SQL Editor → New query →
-- paste → Run). It is safe to run again. Running it again does not email
-- anyone, and it does not change the sender row if that row is already there.
--
-- What this sets up
--   * When the cabinet accepts, declines, or counters an offer, the address
--     on that offer is emailed. Guest offers and account offers both work.
--     A customer accepting or declining their own counter-offer is not
--     emailed about their own click.
--   * When a hold that came from an accepted counter-offer ends (the hourly
--     job, or Release in the cabinet), that customer is emailed.
--   * When that same held piece is marked sold, that customer is emailed.
--   * public.offer_email_config — the sender, reply-to, and links. This is
--     the only place those are set. The functions read the row.
--   * public.offer_email_log — one row per attempt. A failure is written
--     here and does not undo the cabinet's update.
--   * public.offer_holds — which offer a reserved piece is being held for.
--     Not readable by the shop.
--   * public.profiles.offers_viewed_at — so My offers can mark a status
--     that changed after the customer last looked.
--
-- The Brevo API key is not in this file and must not be added to the
-- website. It lives in Supabase Vault, secret name brevo_api_key.
-- The functions read it as the database owner. The website roles cannot
-- call those functions, and they cannot read Vault.
--
-- Do not add the vault or net schemas to the Data API exposed schemas.
--
-- This script does not alter storage.objects, storage.buckets, or storage
-- policies. It does not insert offers, products, or sales.
--
-- Before the first real offer is answered, do these once:
--
-- 1. Enable pg_net.
--    Dashboard → Database → Extensions → search pg_net → Enable.
--    Then you can run this file. If you run the file first, run it again
--    after pg_net is on so the tidy-up job is scheduled. Emails still queue
--    once the extension is on, even if you do not run the file twice.
--
-- 2. In Brevo, open SMTP & API → API keys, and create a key.
--    Brevo's IP blocking for API keys must stay deactivated. Supabase
--    sends from changing addresses, so an IP allow-list will block the mail.
--    Also confirm the sender hello@thecuriocubbyhole.com is a verified
--    sender in Brevo (Senders, domains & IPs). An unverified sender is
--    refused, and the refusal is written to offer_email_log.
--
-- 3. Put the key in Vault under the name brevo_api_key.
--    Dashboard → Integrations → Vault → Secrets → Add a new secret.
--    Name: brevo_api_key
--    Secret: the API key you just created.
--    Or run this in the SQL editor, with the real key in place of the
--    placeholder. Do not save the key into a file.
--
--    select vault.create_secret(
--      'paste-the-brevo-api-key-here',
--      'brevo_api_key',
--      'Brevo transactional API key for offer emails'
--    );
--
--    To replace a key later:
--
--    select vault.update_secret(
--      (select id from vault.secrets where name = 'brevo_api_key'),
--      'paste-the-new-key-here'
--    );
--
-- 4. Run this whole file.
--
-- 5. Change the sender, if you ever need to, by editing the single row in
--    public.offer_email_config (Table Editor, or SQL). Do not edit the
--    functions. The default sender is
--    Cambridge Curio Cubbyhole <hello@thecuriocubbyhole.com>.

-- ---------------------------------------------------------------------------
-- Required tables from the earlier scripts.
-- ---------------------------------------------------------------------------

do $need$
begin
  if to_regclass('public.offers') is null or to_regclass('public.products') is null then
    raise exception 'public.offers or public.products is missing. Run supabase/shop-notifications.sql first.';
  end if;
end
$need$;

do $profiles$
begin
  if to_regclass('public.profiles') is null then
    raise notice 'public.profiles is missing, so the My offers badge was not added. Run supabase/customer-accounts.sql, then run this file again. Emails still send.';
  else
    alter table public.profiles
      add column if not exists offers_viewed_at timestamptz;
    comment on column public.profiles.offers_viewed_at is
      'When this customer last opened My offers. The account page badges accepted, declined, and countered offers that changed after this.';
  end if;
end
$profiles$;

-- ---------------------------------------------------------------------------
-- Sender and links. One row. Re-running does not overwrite it.
-- ---------------------------------------------------------------------------

create table if not exists public.offer_email_config (
  id boolean primary key default true check (id),
  sender_name text not null default 'Cambridge Curio Cubbyhole',
  sender_email text not null default 'hello@thecuriocubbyhole.com',
  reply_to_name text not null default 'Cambridge Curio Cubbyhole',
  reply_to_email text not null default 'hello@thecuriocubbyhole.com',
  account_url text not null default 'https://thecuriocubbyhole.com/account.html',
  contact_url text not null default 'https://thecuriocubbyhole.com/contact_us.html',
  shop_url text not null default 'https://thecuriocubbyhole.com'
);

alter table public.offer_email_config
  add column if not exists sender_name text,
  add column if not exists sender_email text,
  add column if not exists reply_to_name text,
  add column if not exists reply_to_email text,
  add column if not exists account_url text,
  add column if not exists contact_url text,
  add column if not exists shop_url text;

update public.offer_email_config
set
  sender_name = coalesce(nullif(btrim(sender_name), ''), 'Cambridge Curio Cubbyhole'),
  sender_email = coalesce(nullif(btrim(sender_email), ''), 'hello@thecuriocubbyhole.com'),
  reply_to_name = coalesce(nullif(btrim(reply_to_name), ''), 'Cambridge Curio Cubbyhole'),
  reply_to_email = coalesce(nullif(btrim(reply_to_email), ''), 'hello@thecuriocubbyhole.com'),
  account_url = coalesce(nullif(btrim(account_url), ''), 'https://thecuriocubbyhole.com/account.html'),
  contact_url = coalesce(nullif(btrim(contact_url), ''), 'https://thecuriocubbyhole.com/contact_us.html'),
  shop_url = coalesce(nullif(btrim(shop_url), ''), 'https://thecuriocubbyhole.com')
where sender_name is null
   or sender_email is null
   or reply_to_name is null
   or reply_to_email is null
   or account_url is null
   or contact_url is null
   or shop_url is null
   or btrim(sender_name) = ''
   or btrim(sender_email) = ''
   or btrim(reply_to_name) = ''
   or btrim(reply_to_email) = ''
   or btrim(account_url) = ''
   or btrim(contact_url) = ''
   or btrim(shop_url) = '';

alter table public.offer_email_config
  alter column sender_name set default 'Cambridge Curio Cubbyhole',
  alter column sender_email set default 'hello@thecuriocubbyhole.com',
  alter column reply_to_name set default 'Cambridge Curio Cubbyhole',
  alter column reply_to_email set default 'hello@thecuriocubbyhole.com',
  alter column account_url set default 'https://thecuriocubbyhole.com/account.html',
  alter column contact_url set default 'https://thecuriocubbyhole.com/contact_us.html',
  alter column shop_url set default 'https://thecuriocubbyhole.com';

alter table public.offer_email_config
  alter column sender_name set not null,
  alter column sender_email set not null,
  alter column reply_to_name set not null,
  alter column reply_to_email set not null,
  alter column account_url set not null,
  alter column contact_url set not null,
  alter column shop_url set not null;

alter table public.offer_email_config drop constraint if exists offer_email_config_sender_name_length;
alter table public.offer_email_config
  add constraint offer_email_config_sender_name_length
  check (char_length(btrim(sender_name)) between 1 and 120);

alter table public.offer_email_config drop constraint if exists offer_email_config_reply_name_length;
alter table public.offer_email_config
  add constraint offer_email_config_reply_name_length
  check (char_length(btrim(reply_to_name)) between 1 and 120);

alter table public.offer_email_config drop constraint if exists offer_email_config_sender_email_check;
alter table public.offer_email_config
  add constraint offer_email_config_sender_email_check
  check (
    char_length(btrim(sender_email)) between 3 and 200
    and btrim(sender_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

alter table public.offer_email_config drop constraint if exists offer_email_config_reply_email_check;
alter table public.offer_email_config
  add constraint offer_email_config_reply_email_check
  check (
    char_length(btrim(reply_to_email)) between 3 and 200
    and btrim(reply_to_email) ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  );

alter table public.offer_email_config drop constraint if exists offer_email_config_account_url_check;
alter table public.offer_email_config
  add constraint offer_email_config_account_url_check
  check (account_url ~ '^https://' and char_length(account_url) <= 300);

alter table public.offer_email_config drop constraint if exists offer_email_config_contact_url_check;
alter table public.offer_email_config
  add constraint offer_email_config_contact_url_check
  check (contact_url ~ '^https://' and char_length(contact_url) <= 300);

alter table public.offer_email_config drop constraint if exists offer_email_config_shop_url_check;
alter table public.offer_email_config
  add constraint offer_email_config_shop_url_check
  check (shop_url ~ '^https://' and char_length(shop_url) <= 300);

comment on table public.offer_email_config is
  'The only sender and link settings for offer emails. Edit this row to change them. The functions do not keep their own copy.';

insert into public.offer_email_config (id)
values (true)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Attempt log. The API key is never written here.
-- ---------------------------------------------------------------------------

create table if not exists public.offer_email_log (
  id uuid primary key default gen_random_uuid(),
  offer_id uuid,
  product_id uuid,
  kind text not null,
  recipient text not null,
  subject text,
  status_from text,
  status_to text,
  counter_amount numeric(10, 2),
  request_id bigint,
  outcome text not null,
  http_status integer,
  detail text,
  created_at timestamptz not null default now()
);

alter table public.offer_email_log
  add column if not exists offer_id uuid,
  add column if not exists product_id uuid,
  add column if not exists kind text,
  add column if not exists recipient text,
  add column if not exists subject text,
  add column if not exists status_from text,
  add column if not exists status_to text,
  add column if not exists counter_amount numeric(10, 2),
  add column if not exists request_id bigint,
  add column if not exists outcome text,
  add column if not exists http_status integer,
  add column if not exists detail text,
  add column if not exists created_at timestamptz default now();

alter table public.offer_email_log drop constraint if exists offer_email_log_offer_id_fkey;
alter table public.offer_email_log
  add constraint offer_email_log_offer_id_fkey
  foreign key (offer_id) references public.offers (id) on delete set null;

alter table public.offer_email_log drop constraint if exists offer_email_log_product_id_fkey;
alter table public.offer_email_log
  add constraint offer_email_log_product_id_fkey
  foreign key (product_id) references public.products (id) on delete set null;

alter table public.offer_email_log drop constraint if exists offer_email_log_kind_check;
alter table public.offer_email_log
  add constraint offer_email_log_kind_check
  check (kind in ('accepted', 'declined', 'countered', 'hold_expired', 'sold', 'error'));

alter table public.offer_email_log drop constraint if exists offer_email_log_outcome_check;
alter table public.offer_email_log
  add constraint offer_email_log_outcome_check
  check (outcome in ('queued', 'sent', 'failed', 'skipped'));

alter table public.offer_email_log drop constraint if exists offer_email_log_recipient_length;
alter table public.offer_email_log
  add constraint offer_email_log_recipient_length
  check (char_length(recipient) <= 200);

alter table public.offer_email_log drop constraint if exists offer_email_log_subject_length;
alter table public.offer_email_log
  add constraint offer_email_log_subject_length
  check (subject is null or char_length(subject) <= 200);

alter table public.offer_email_log drop constraint if exists offer_email_log_detail_length;
alter table public.offer_email_log
  add constraint offer_email_log_detail_length
  check (detail is null or char_length(detail) <= 500);

create index if not exists offer_email_log_offer_kind_idx
  on public.offer_email_log (offer_id, kind, created_at desc);

create index if not exists offer_email_log_queued_idx
  on public.offer_email_log (request_id)
  where outcome = 'queued';

comment on table public.offer_email_log is
  'Attempts to email the address on an offer. A failed attempt is stored here and does not undo the offer update. The Brevo API key is not stored.';

-- Which accepted counter-offer a reserved piece is held for. Written when
-- a counter is accepted and the piece is reserved. Cleared when the piece
-- leaves reserved. The shop cannot read this.
create table if not exists public.offer_holds (
  product_id uuid primary key,
  offer_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.offer_holds
  add column if not exists offer_id uuid,
  add column if not exists created_at timestamptz default now();

alter table public.offer_holds drop constraint if exists offer_holds_product_id_fkey;
alter table public.offer_holds
  add constraint offer_holds_product_id_fkey
  foreign key (product_id) references public.products (id) on delete cascade;

alter table public.offer_holds drop constraint if exists offer_holds_offer_id_fkey;
alter table public.offer_holds
  add constraint offer_holds_offer_id_fkey
  foreign key (offer_id) references public.offers (id) on delete cascade;

comment on table public.offer_holds is
  'The offer a reserved piece is held for, after a counter-offer was accepted. Removed when the piece leaves reserved.';

-- ---------------------------------------------------------------------------
-- Wording. British English. HTML uses the shop colours. Plain text goes too.
-- ---------------------------------------------------------------------------

create or replace function public.offer_email_escape(value text)
returns text
language sql
immutable
set search_path = pg_catalog
as $escape$
  select replace(
    replace(
      replace(
        replace(coalesce(value, ''), '&', '&amp;'),
        '<', '&lt;'),
      '>', '&gt;'),
    '"', '&quot;');
$escape$;

create or replace function public.offer_email_money(amount numeric)
returns text
language sql
immutable
set search_path = pg_catalog
as $money$
  select case
    when amount is null then ''
    else '£' || replace(to_char(round(amount, 2), 'FM999999990.00'), ',', '.')
  end;
$money$;

create or replace function public.offer_email_content(
  p_kind text,
  p_name text,
  p_title text,
  p_option text,
  p_amount numeric,
  p_counter numeric,
  p_has_account boolean,
  p_status_from text,
  p_account_url text,
  p_contact_url text,
  p_shop_url text,
  p_sender_name text,
  out mail_subject text,
  out mail_html text,
  out mail_plain text
)
language plpgsql
stable
set search_path = pg_catalog, public
as $content$
declare
  clean_name text;
  clean_title text;
  html_name text;
  html_title text;
  option_phrase text;
  agreed numeric;
  agreed_text text;
  counter_text text;
  offer_text text;
  piece_plain text;
  piece_html text;
  greeting_plain text;
  greeting_html text;
  next_step text;
  body_plain text;
  body_html text;
  shop_label text;
  account_url text;
  contact_url text;
  shop_url text;
  sender_name text;
begin
  clean_name := btrim(regexp_replace(coalesce(p_name, ''), '[[:cntrl:]]', '', 'g'));
  clean_title := btrim(regexp_replace(coalesce(p_title, ''), '[[:cntrl:]]', '', 'g'));
  if clean_title = '' then
    clean_title := 'this piece';
  end if;
  html_name := public.offer_email_escape(clean_name);
  html_title := public.offer_email_escape(clean_title);

  option_phrase := case p_option
    when 'delivered' then 'delivered by us'
    when 'item' then 'item only, your own courier'
    when 'collection' then 'collection from Wisbech'
    else null
  end;

  agreed := case
    when p_kind in ('sold', 'hold_expired') and p_counter is not null then p_counter
    when p_kind = 'accepted' and p_status_from = 'countered' and p_counter is not null then p_counter
    else p_amount
  end;
  agreed_text := public.offer_email_money(agreed);
  counter_text := public.offer_email_money(p_counter);
  offer_text := public.offer_email_money(p_amount);

  piece_plain := '"' || clean_title || '"';
  piece_html := '&quot;' || html_title || '&quot;';
  if option_phrase is not null then
    piece_plain := piece_plain || ' (' || option_phrase || ')';
    piece_html := piece_html || ' (' || public.offer_email_escape(option_phrase) || ')';
  end if;

  if clean_name = '' then
    greeting_plain := 'Hello,';
    greeting_html := 'Hello,';
  else
    greeting_plain := 'Hello ' || clean_name || ',';
    greeting_html := 'Hello ' || html_name || ',';
  end if;

  next_step := case p_option
    when 'delivered' then
      'We will be in touch to arrange payment, and then delivery. The website does not take payment.'
    when 'item' then
      'We will be in touch to arrange payment. Once that is settled, you arrange your own courier. The website does not take payment.'
    when 'collection' then
      'We will be in touch to arrange payment and a time to collect from Wisbech. The website does not take payment.'
    else
      'We will be in touch to arrange payment and, if you are collecting, a time in Wisbech. The website does not take payment.'
  end;

  account_url := coalesce(p_account_url, '');
  contact_url := coalesce(p_contact_url, '');
  shop_url := coalesce(p_shop_url, '');
  sender_name := btrim(regexp_replace(coalesce(p_sender_name, ''), '[[:cntrl:]]', '', 'g'));
  if sender_name = '' then
    sender_name := 'Cambridge Curio Cubbyhole';
  end if;
  shop_label := regexp_replace(shop_url, '^https?://', '');

  if p_kind = 'accepted' then
    mail_subject := left('Your offer for ' || clean_title || ' is accepted', 200);
    body_plain := greeting_plain || E'\n\n'
      || 'We are happy to accept your offer of ' || agreed_text || ' for ' || piece_plain || '.' || E'\n\n'
      || next_step || E'\n\n'
      || 'You can reply to this email if you need us, or write through the contact page:' || E'\n'
      || contact_url;
    body_html :=
      '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || greeting_html || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">We are happy to accept your offer of <strong>' || public.offer_email_escape(agreed_text) || '</strong> for ' || piece_html || '.</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || public.offer_email_escape(next_step) || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">You can reply to this email if you need us, or write through the <a href="' || public.offer_email_escape(contact_url) || '" style="color:#0D1B2A;">contact page</a>.</p>';
  elsif p_kind = 'declined' then
    mail_subject := left('Your offer for ' || clean_title, 200);
    body_plain := greeting_plain || E'\n\n'
      || 'Thank you for offering ' || offer_text || ' for "' || clean_title || '". We are not able to accept that offer this time.' || E'\n\n'
      || 'The piece is left as it is. You are welcome to look at other pieces, or to write to us if you would like to talk it over.' || E'\n\n'
      || contact_url;
    body_html :=
      '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || greeting_html || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">Thank you for offering <strong>' || public.offer_email_escape(offer_text) || '</strong> for &quot;' || html_title || '&quot;. We are not able to accept that offer this time.</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">The piece is left as it is. You are welcome to look at other pieces, or to write to us if you would like to talk it over.</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;"><a href="' || public.offer_email_escape(contact_url) || '" style="color:#0D1B2A;">' || public.offer_email_escape(contact_url) || '</a></p>';
  elsif p_kind = 'countered' then
    mail_subject := left('A counter-offer for ' || clean_title, 200);
    body_plain := greeting_plain || E'\n\n'
      || 'Thank you for your offer of ' || offer_text || ' for ' || piece_plain || '. We can do ' || counter_text || ' for that option.';
    body_html :=
      '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || greeting_html || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">Thank you for your offer of ' || public.offer_email_escape(offer_text) || ' for ' || piece_html || '. We can do <strong>' || public.offer_email_escape(counter_text) || '</strong> for that option.</p>';
    if coalesce(p_has_account, false) then
      body_plain := body_plain || E'\n\n'
        || 'You can accept or decline this counter-offer on your account page:' || E'\n'
        || account_url || E'\n\n'
        || 'Accepting holds the piece for you for three days. If it is not settled in that time, it goes back on the shelf.' || E'\n\n'
        || 'You can also reply to this email.';
      body_html := body_html
        || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">You can accept or decline this counter-offer on your account page:<br><a href="' || public.offer_email_escape(account_url) || '" style="color:#0D1B2A;">' || public.offer_email_escape(account_url) || '</a></p>'
        || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">Accepting holds the piece for you for three days. If it is not settled in that time, it goes back on the shelf.</p>'
        || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">You can also reply to this email.</p>';
    else
      body_plain := body_plain || E'\n\n'
        || 'Reply to this email, or write through the contact page, to accept or decline:' || E'\n'
        || contact_url || E'\n\n'
        || 'If you open an account with this same email address, the offer appears under My offers and you can accept or decline there:' || E'\n'
        || account_url || E'\n\n'
        || 'Accepting holds the piece for you for three days.';
      body_html := body_html
        || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">Reply to this email, or write through the <a href="' || public.offer_email_escape(contact_url) || '" style="color:#0D1B2A;">contact page</a>, to accept or decline.</p>'
        || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">If you open an account with this same email address, the offer appears under My offers and you can accept or decline there:<br><a href="' || public.offer_email_escape(account_url) || '" style="color:#0D1B2A;">' || public.offer_email_escape(account_url) || '</a></p>'
        || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">Accepting holds the piece for you for three days.</p>';
    end if;
  elsif p_kind = 'hold_expired' then
    mail_subject := left('The hold on ' || clean_title || ' has ended', 200);
    body_plain := greeting_plain || E'\n\n'
      || 'The hold on "' || clean_title || '" has ended, so the piece is no longer set aside for you.';
    if counter_text <> '' then
      body_plain := body_plain || ' This follows the counter-offer of ' || counter_text || ' that you accepted.';
    end if;
    body_plain := body_plain || E'\n\n'
      || 'If you still want it, reply to this email or write through the contact page and we will see what we can do.' || E'\n'
      || contact_url;
    body_html :=
      '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || greeting_html || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">The hold on &quot;' || html_title || '&quot; has ended, so the piece is no longer set aside for you.'
      || case when counter_text <> '' then ' This follows the counter-offer of <strong>' || public.offer_email_escape(counter_text) || '</strong> that you accepted.' else '' end
      || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">If you still want it, reply to this email or write through the <a href="' || public.offer_email_escape(contact_url) || '" style="color:#0D1B2A;">contact page</a> and we will see what we can do.</p>';
  elsif p_kind = 'sold' then
    mail_subject := left(clean_title || ' is marked sold to you', 200);
    body_plain := greeting_plain || E'\n\n'
      || '"' || clean_title || '" is now marked sold to you';
    if agreed_text <> '' then
      body_plain := body_plain || ', at ' || agreed_text;
    end if;
    body_plain := body_plain || '.' || E'\n\n'
      || 'We will be in touch if payment or collection still needs to be arranged. If you have already settled this with us, there is nothing more you need to do. Collection is from Wisbech, by arrangement.' || E'\n\n'
      || 'You can reply to this email if you need us.' || E'\n'
      || contact_url;
    body_html :=
      '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || greeting_html || '</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">&quot;' || html_title || '&quot; is now marked sold to you'
      || case when agreed_text <> '' then ', at <strong>' || public.offer_email_escape(agreed_text) || '</strong>' else '' end
      || '.</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">We will be in touch if payment or collection still needs to be arranged. If you have already settled this with us, there is nothing more you need to do. Collection is from Wisbech, by arrangement.</p>'
      || '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">You can reply to this email if you need us.</p>';
  else
    mail_subject := left('Your offer for ' || clean_title, 200);
    body_plain := greeting_plain;
    body_html := '<p style="margin:0 0 16px;font-family:Georgia,Times New Roman,serif;font-size:16px;line-height:1.6;color:#0D1B2A;">' || greeting_html || '</p>';
  end if;

  mail_plain := body_plain || E'\n\n'
    || sender_name || E'\n'
    || 'Wisbech' || E'\n'
    || shop_url || E'\n\n'
    || 'This note is about an offer you sent. It is not a shop-news email.';

  mail_html :=
    '<!DOCTYPE html><html lang="en-GB"><body style="margin:0;padding:0;background:#F5EFE2;">'
    || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5EFE2;">'
    || '<tr><td align="center" style="padding:24px 12px;">'
    || '<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:560px;background:#F5EFE2;border:1px solid #C5A15B;">'
    || '<tr><td style="background:#0D1B2A;padding:22px 28px;">'
    || '<p style="margin:0;font-family:Georgia,Times New Roman,serif;font-size:22px;line-height:1.3;color:#F5EFE2;">' || public.offer_email_escape(sender_name) || '</p>'
    || '<p style="margin:8px 0 0;font-family:Georgia,Times New Roman,serif;font-size:12px;letter-spacing:2px;color:#C5A15B;">WISBECH</p>'
    || '</td></tr>'
    || '<tr><td style="padding:28px 28px 8px;">' || body_html || '</td></tr>'
    || '<tr><td style="padding:8px 28px 28px;font-family:Georgia,Times New Roman,serif;font-size:13px;line-height:1.5;color:#0D1B2A;">'
    || public.offer_email_escape(sender_name) || '<br>Wisbech<br>'
    || '<a href="' || public.offer_email_escape(shop_url) || '" style="color:#0D1B2A;">' || public.offer_email_escape(shop_label) || '</a>'
    || '<br>This note is about an offer you sent. It is not a shop-news email.'
    || '</td></tr></table></td></tr></table></body></html>';
end;
$content$;

create or replace function public.offer_email_log_write(
  p_offer_id uuid,
  p_product_id uuid,
  p_kind text,
  p_recipient text,
  p_subject text,
  p_status_from text,
  p_status_to text,
  p_counter numeric,
  p_request_id bigint,
  p_outcome text,
  p_detail text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $log_write$
begin
  insert into public.offer_email_log (
    offer_id,
    product_id,
    kind,
    recipient,
    subject,
    status_from,
    status_to,
    counter_amount,
    request_id,
    outcome,
    detail
  ) values (
    p_offer_id,
    p_product_id,
    case
      when p_kind in ('accepted', 'declined', 'countered', 'hold_expired', 'sold', 'error') then p_kind
      else 'error'
    end,
    left(coalesce(p_recipient, ''), 200),
    left(p_subject, 200),
    left(p_status_from, 40),
    left(p_status_to, 40),
    p_counter,
    p_request_id,
    case
      when p_outcome in ('queued', 'sent', 'failed', 'skipped') then p_outcome
      else 'failed'
    end,
    left(p_detail, 500)
  );
exception
  when others then
    null;
end;
$log_write$;

-- Queues one Brevo message. Never raises: a problem is written to the log
-- so the offer or piece update that called this still commits.
create or replace function public.offer_email_send(
  p_offer_id uuid,
  p_product_id uuid,
  p_kind text,
  p_name text,
  p_email text,
  p_title text,
  p_option text,
  p_amount numeric,
  p_counter numeric,
  p_has_account boolean,
  p_status_from text,
  p_status_to text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, net, vault
as $send$
declare
  recipient text;
  sender_name text;
  sender_email text;
  reply_to_name text;
  reply_to_email text;
  account_url text;
  contact_url text;
  shop_url text;
  mail_subject text;
  mail_html text;
  mail_plain text;
  api_key text;
  request_id bigint;
  payload jsonb;
  detail text;
begin
  recipient := btrim(coalesce(p_email, ''));

  if p_kind is null
     or p_kind not in ('accepted', 'declined', 'countered', 'hold_expired', 'sold') then
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, 'error', recipient, null,
      p_status_from, p_status_to, p_counter, null, 'failed',
      'This offer email had no recognised kind.'
    );
    return;
  end if;

  if recipient = ''
     or recipient !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or recipient ilike '%@removed.invalid' then
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, p_kind, recipient, null,
      p_status_from, p_status_to, p_counter, null, 'skipped',
      'The offer has no usable email address.'
    );
    return;
  end if;

  if p_kind = 'countered' and (p_counter is null or p_counter <= 0) then
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, p_kind, recipient, null,
      p_status_from, p_status_to, p_counter, null, 'failed',
      'A counter-offer needs an amount.'
    );
    return;
  end if;

  select
    c.sender_name,
    c.sender_email,
    c.reply_to_name,
    c.reply_to_email,
    c.account_url,
    c.contact_url,
    c.shop_url
  into
    sender_name,
    sender_email,
    reply_to_name,
    reply_to_email,
    account_url,
    contact_url,
    shop_url
  from public.offer_email_config as c
  where c.id;

  if sender_email is null or btrim(sender_email) = '' then
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, p_kind, recipient, null,
      p_status_from, p_status_to, p_counter, null, 'failed',
      'The sender row in offer_email_config is missing.'
    );
    return;
  end if;

  select composed.mail_subject, composed.mail_html, composed.mail_plain
  into mail_subject, mail_html, mail_plain
  from public.offer_email_content(
    p_kind,
    p_name,
    p_title,
    p_option,
    p_amount,
    p_counter,
    p_has_account,
    p_status_from,
    account_url,
    contact_url,
    shop_url,
    sender_name
  ) as composed;

  begin
    select ds.decrypted_secret
    into api_key
    from vault.decrypted_secrets as ds
    where ds.name = 'brevo_api_key'
    limit 1;
  exception
    when others then
      perform public.offer_email_log_write(
        p_offer_id, p_product_id, p_kind, recipient, mail_subject,
        p_status_from, p_status_to, p_counter, null, 'failed',
        left('Could not read brevo_api_key from Vault. ' || sqlerrm, 500)
      );
      return;
  end;

  if api_key is null or btrim(api_key) = '' then
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, p_kind, recipient, mail_subject,
      p_status_from, p_status_to, p_counter, null, 'failed',
      'Vault has no secret named brevo_api_key.'
    );
    return;
  end if;

  api_key := btrim(api_key);

  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, p_kind, recipient, mail_subject,
      p_status_from, p_status_to, p_counter, null, 'failed',
      'pg_net is not enabled. Dashboard, Database, Extensions, pg_net, Enable.'
    );
    return;
  end if;

  payload := jsonb_build_object(
    'sender', jsonb_build_object('name', sender_name, 'email', sender_email),
    'to', jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
      'email', recipient,
      'name', nullif(btrim(coalesce(p_name, '')), '')
    ))),
    'replyTo', jsonb_build_object('name', reply_to_name, 'email', reply_to_email),
    'subject', mail_subject,
    'htmlContent', mail_html,
    'textContent', mail_plain,
    'tags', jsonb_build_array('offer-' || p_kind)
  );

  begin
    request_id := net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      body := payload,
      headers := jsonb_build_object(
        'api-key', api_key,
        'Content-Type', 'application/json',
        'accept', 'application/json'
      ),
      timeout_milliseconds := 10000
    );
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, p_kind, recipient, mail_subject,
      p_status_from, p_status_to, p_counter, request_id, 'queued',
      null
    );
  exception
    when others then
      detail := left(sqlerrm, 500);
      if api_key <> '' then
        detail := left(replace(detail, api_key, '[redacted]'), 500);
      end if;
      perform public.offer_email_log_write(
        p_offer_id, p_product_id, p_kind, recipient, mail_subject,
        p_status_from, p_status_to, p_counter, null, 'failed',
        detail
      );
  end;
exception
  when others then
    detail := left(sqlerrm, 500);
    if api_key is not null and api_key <> '' then
      detail := left(replace(detail, api_key, '[redacted]'), 500);
    end if;
    perform public.offer_email_log_write(
      p_offer_id, p_product_id, coalesce(p_kind, 'error'), recipient, null,
      p_status_from, p_status_to, p_counter, null, 'failed',
      detail
    );
end;
$send$;

create or replace function public.offer_email_remember_hold(p_offer_id uuid, p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $remember$
begin
  insert into public.offer_holds (product_id, offer_id)
  select p.id, p_offer_id
  from public.products as p
  where p.id = p_product_id
    and p.status = 'reserved'
  on conflict (product_id) do update
  set offer_id = excluded.offer_id,
      created_at = now();
exception
  when others then
    null;
end;
$remember$;

-- Copies Brevo's reply onto the log once pg_net has it. There is no trigger
-- on the net tables: those can loop. A short job calls this instead.
create or replace function public.offer_email_collect_responses()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public, net
as $collect$
declare
  updated integer := 0;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'This job is not available to customer accounts' using errcode = '42501';
  end if;

  update public.offer_email_log as log
  set
    http_status = response.status_code,
    outcome = case
      when coalesce(response.status_code, 0) between 200 and 299
        and coalesce(response.timed_out, false) = false
        and coalesce(btrim(response.error_msg), '') = ''
      then 'sent'
      else 'failed'
    end,
    detail = left(
      coalesce(nullif(btrim(response.error_msg), ''), left(response.content, 500), ''),
      500
    )
  from net._http_response as response
  where log.outcome = 'queued'
    and log.request_id = response.id;

  get diagnostics updated = row_count;
  return updated;
exception
  when others then
    raise warning 'Offer email replies were not collected (%)', sqlerrm;
    return 0;
end;
$collect$;

-- ---------------------------------------------------------------------------
-- Offer status and counter amount. Only a real change is emailed.
-- A customer answering their own counter-offer is not emailed.
-- Account deletion scrubs the address out of the log.
-- ---------------------------------------------------------------------------

create or replace function public.offer_emails_after_offer()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $after_offer$
declare
  staff boolean;
  kind text;
  admin_uid uuid := '222043d1-053b-45be-ab39-20216c84ee86'::uuid;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if new.email is distinct from old.email
     and coalesce(new.email, '') ilike '%@removed.invalid' then
    update public.offer_email_log
    set
      recipient = left(new.email, 200),
      detail = 'Removed with the account'
    where offer_id = new.id
      and recipient is distinct from left(new.email, 200);
  end if;

  -- A missing JWT is the SQL editor, the hourly job, or the service role.
  -- Those are treated as the shop. A signed-in customer is not.
  staff := auth.uid() is null or auth.uid() = admin_uid;

  if new.status = 'accepted'
     and old.status is distinct from 'accepted'
     and new.counter_amount is not null
     and new.product_id is not null then
    perform public.offer_email_remember_hold(new.id, new.product_id);
  end if;

  kind := null;
  if new.status = 'accepted' and old.status is distinct from 'accepted' then
    kind := 'accepted';
  elsif new.status = 'declined' and old.status is distinct from 'declined' then
    kind := 'declined';
  elsif new.status = 'countered'
    and (
      old.status is distinct from 'countered'
      or old.counter_amount is distinct from new.counter_amount
    ) then
    kind := 'countered';
  end if;

  if kind is null or not staff then
    return new;
  end if;

  perform public.offer_email_send(
    new.id,
    new.product_id,
    kind,
    new.name,
    new.email,
    new.product_title,
    new.option,
    new.amount,
    new.counter_amount,
    new.user_id is not null,
    old.status,
    new.status
  );
  return new;
exception
  when others then
    perform public.offer_email_log_write(
      new.id, new.product_id, 'error', coalesce(new.email, ''), null,
      old.status, new.status, new.counter_amount, null, 'failed',
      left(sqlerrm, 500)
    );
    return new;
end;
$after_offer$;

drop trigger if exists offer_emails_after_offer on public.offers;
create trigger offer_emails_after_offer
after update on public.offers
for each row
execute function public.offer_emails_after_offer();

-- ---------------------------------------------------------------------------
-- A reserved piece leaving the shelf. The hold row says who it was for.
-- Sold to someone else, or a sale recorded in the last few minutes against
-- a different offer, tells the held customer that the hold has ended.
-- A sold email is skipped when an accept email was just queued or sent.
-- ---------------------------------------------------------------------------

create or replace function public.offer_emails_after_product()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $after_product$
declare
  held uuid;
  offer_row public.offers;
  recent boolean := false;
  sold_elsewhere boolean := false;
  kind text;
begin
  if tg_op <> 'UPDATE' then
    return new;
  end if;

  if old.status is distinct from 'reserved' or new.status = 'reserved' then
    return new;
  end if;

  select h.offer_id
  into held
  from public.offer_holds as h
  where h.product_id = new.id;

  delete from public.offer_holds
  where product_id = new.id;

  if held is null then
    return new;
  end if;

  select * into offer_row
  from public.offers
  where id = held;

  if not found or offer_row.status is distinct from 'accepted' then
    return new;
  end if;

  if new.status = 'sold' then
    -- A sale just recorded against a different offer means this piece was
    -- sold to someone else. The held customer is told the hold ended.
    if to_regclass('public.sales') is not null then
      select exists (
        select 1
        from public.sales as s
        where s.product_id = new.id
          and s.created_at > now() - interval '15 minutes'
          and s.offer_id is distinct from offer_row.id
      ) into sold_elsewhere;
    end if;

    if sold_elsewhere then
      kind := 'hold_expired';
    else
      select exists (
        select 1
        from public.offer_email_log as log
        where log.offer_id = offer_row.id
          and log.kind = 'accepted'
          and log.created_at > now() - interval '15 minutes'
          and log.outcome in ('queued', 'sent')
      ) into recent;
      if recent then
        return new;
      end if;
      kind := 'sold';
    end if;
  elsif new.status in ('available', 'draft') then
    kind := 'hold_expired';
  else
    return new;
  end if;

  perform public.offer_email_send(
    offer_row.id,
    new.id,
    kind,
    offer_row.name,
    offer_row.email,
    coalesce(nullif(btrim(offer_row.product_title), ''), new.title),
    offer_row.option,
    offer_row.amount,
    offer_row.counter_amount,
    offer_row.user_id is not null,
    offer_row.status,
    offer_row.status
  );
  return new;
exception
  when others then
    begin
      delete from public.offer_holds where product_id = new.id;
    exception
      when others then
        null;
    end;
    perform public.offer_email_log_write(
      held, new.id, 'error', '', null,
      old.status, new.status, null, null, 'failed',
      left(sqlerrm, 500)
    );
    return new;
end;
$after_product$;

drop trigger if exists offer_emails_after_product on public.products;
create trigger offer_emails_after_product
after update of status on public.products
for each row
execute function public.offer_emails_after_product();

-- ---------------------------------------------------------------------------
-- Row level security. Customers cannot read the log, the holds, or the
-- sender row. The admin user can read the log and can change the sender.
-- The trigger functions bypass these policies.
-- ---------------------------------------------------------------------------

alter table public.offer_email_config enable row level security;
alter table public.offer_email_log enable row level security;
alter table public.offer_holds enable row level security;

revoke all on table public.offer_email_config from public, anon, authenticated;
revoke all on table public.offer_email_log from public, anon, authenticated;
revoke all on table public.offer_holds from public, anon, authenticated;

grant select, update on table public.offer_email_config to authenticated;
grant select on table public.offer_email_log to authenticated;

drop policy if exists "Admin reads offer email settings" on public.offer_email_config;
create policy "Admin reads offer email settings"
on public.offer_email_config
for select
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

drop policy if exists "Admin updates offer email settings" on public.offer_email_config;
create policy "Admin updates offer email settings"
on public.offer_email_config
for update
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid)
with check (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

drop policy if exists "Admin reads offer email log" on public.offer_email_log;
create policy "Admin reads offer email log"
on public.offer_email_log
for select
to authenticated
using (auth.uid() = '222043d1-053b-45be-ab39-20216c84ee86'::uuid);

-- ---------------------------------------------------------------------------
-- The website must not call these. Triggers fire without a grant.
-- ---------------------------------------------------------------------------

revoke all on function public.offer_email_escape(text) from public, anon, authenticated, service_role;
revoke all on function public.offer_email_money(numeric) from public, anon, authenticated, service_role;
revoke all on function public.offer_email_content(text, text, text, text, numeric, numeric, boolean, text, text, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.offer_email_log_write(uuid, uuid, text, text, text, text, text, numeric, bigint, text, text) from public, anon, authenticated, service_role;
revoke all on function public.offer_email_send(uuid, uuid, text, text, text, text, text, numeric, numeric, boolean, text, text) from public, anon, authenticated, service_role;
revoke all on function public.offer_email_remember_hold(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.offer_email_collect_responses() from public, anon, authenticated, service_role;
revoke all on function public.offer_emails_after_offer() from public, anon, authenticated, service_role;
revoke all on function public.offer_emails_after_product() from public, anon, authenticated, service_role;

-- Revoking from public also removes the owner's grant, on a database where
-- the owner is not a superuser. The trigger functions run as their owner, so
-- the owner must still be able to call them. The website roles stay revoked.
do $owner_exec$
begin
  execute 'grant execute on function public.offer_email_escape(text) to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_email_money(numeric) to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_email_content(text, text, text, text, numeric, numeric, boolean, text, text, text, text, text) to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_email_log_write(uuid, uuid, text, text, text, text, text, numeric, bigint, text, text) to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_email_send(uuid, uuid, text, text, text, text, text, numeric, numeric, boolean, text, text) to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_email_remember_hold(uuid, uuid) to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_email_collect_responses() to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_emails_after_offer() to ' || quote_ident(current_user);
  execute 'grant execute on function public.offer_emails_after_product() to ' || quote_ident(current_user);
end
$owner_exec$;

-- ---------------------------------------------------------------------------
-- pg_net, then a small job that records Brevo's reply on the log.
-- Enabling the extension can fail when the dashboard switch is still off.
-- The tables and triggers above still apply.
-- ---------------------------------------------------------------------------

do $net$
begin
  begin
    create extension if not exists pg_net with schema extensions;
  exception
    when others then
      raise notice 'pg_net was not enabled (%). Dashboard → Database → Extensions → pg_net → Enable, then run supabase/offer-emails.sql again so the tidy-up job is scheduled.', sqlerrm;
  end;
end
$net$;

do $cron$
declare
  existing bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'Offer emails are installed. pg_net is still off, so nothing can be sent yet.';
    return;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'Offer emails are installed. pg_cron is off, so Brevo replies are not copied onto offer_email_log automatically. The send is still queued. Look in net._http_response if a row stays queued.';
    return;
  end if;

  select jobid into existing
  from cron.job
  where jobname = 'offer-email-collect-responses';

  if existing is not null then
    perform cron.unschedule(existing);
  end if;

  perform cron.schedule(
    'offer-email-collect-responses',
    '*/2 * * * *',
    'select public.offer_email_collect_responses()'
  );
exception
  when others then
    raise notice 'Offer emails are installed. The tidy-up job was not scheduled (%).', sqlerrm;
end
$cron$;

do $vault_notice$
begin
  if to_regclass('vault.secrets') is null then
    raise notice 'Offer emails are installed. Vault is not available yet, so brevo_api_key cannot be read.';
    return;
  end if;

  if exists (select 1 from vault.secrets where name = 'brevo_api_key') then
    raise notice 'Offer emails are installed, and Vault has a secret named brevo_api_key.';
  else
    raise notice 'Offer emails are installed. Vault has no secret named brevo_api_key yet. Add it before answering an offer.';
  end if;
exception
  when others then
    raise notice 'Offer emails are installed. Vault could not be checked (%).', sqlerrm;
end
$vault_notice$;
