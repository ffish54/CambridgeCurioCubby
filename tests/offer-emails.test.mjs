import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("..", import.meta.url);
const adminUid = "222043d1-053b-45be-ab39-20216c84ee86";

function read(relative) {
  return fs.readFileSync(new URL(relative, root), "utf8");
}

const sql = read("supabase/offer-emails.sql");
const code = sql.replace(/--.*$/gm, "");

assert.match(sql, /does not alter storage/i);
assert.doesNotMatch(code, /storage\.objects/i);
assert.doesNotMatch(code, /storage\.buckets/i);
assert.doesNotMatch(code, /alter table storage/i);
assert.doesNotMatch(code, /insert into public\.offers/i);
assert.doesNotMatch(code, /insert into public\.products/i);
assert.doesNotMatch(code, /insert into public\.sales/i);
assert.doesNotMatch(code, /vault\.create_secret/i);
assert.doesNotMatch(code, /xkeysib-/i);
assert.doesNotMatch(sql, /xkeysib-/i);

assert.match(sql, /brevo_api_key/);
assert.match(sql, /paste-the-brevo-api-key-here/);
assert.match(sql, /https:\/\/api\.brevo\.com\/v3\/smtp\/email/);
assert.match(sql, /vault\.decrypted_secrets/);
assert.match(sql, /pg_net/);
assert.match(sql, /net\.http_post/);
assert.doesNotMatch(code, /on net\._http_response/i);
assert.doesNotMatch(code, /on net\.http_request_queue/i);
assert.match(sql, /offer-email-collect-responses/);
assert.match(sql, /exception\s+when others/i);

assert.match(code, /sender_email text not null default 'hello@thecuriocubbyhole\.com'/);
assert.match(code, /account_url text not null default 'https:\/\/thecuriocubbyhole\.com\/account\.html'/);
const sendStart = code.indexOf("function public.offer_email_send");
const sendEnd = code.indexOf("function public.offer_email_remember_hold");
assert.ok(sendStart > 0 && sendEnd > sendStart);
const sendBody = code.slice(sendStart, sendEnd);
assert.match(sendBody, /from public\.offer_email_config/);
assert.doesNotMatch(sendBody, /hello@thecuriocubbyhole\.com/);
assert.doesNotMatch(sendBody, /api-key',\s*'/);

assert.match(sql, /We will be in touch/);
assert.match(sql, /We are not able to accept that offer this time/);
assert.match(sql, /We can do/);
assert.match(sql, /The hold on/);
assert.match(sql, /marked sold to you/);
assert.match(sql, /three days/);
assert.match(sql, /#0D1B2A/);
assert.match(sql, /#C5A15B/);
assert.match(sql, /#F5EFE2/);
assert.match(sql, /textContent/);
assert.match(sql, /htmlContent/);
assert.match(sql, /This note is about an offer you sent/);

assert.match(code, /old\.status is distinct from 'accepted'/);
assert.match(code, /old\.counter_amount is distinct from new\.counter_amount/);
assert.match(code, /auth\.uid\(\) is null or auth\.uid\(\) = admin_uid/);
assert.match(code, /removed\.invalid/);
assert.match(code, /offers_viewed_at/);
assert.match(code, /15 minutes/);
assert.match(sql, new RegExp(adminUid));

assert.match(code, /revoke all on function public\.offer_email_send\(uuid, uuid, text, text, text, text, text, numeric, numeric, boolean, text, text\) from public, anon, authenticated, service_role/i);
assert.doesNotMatch(code, /grant execute on function public\.offer_email_send\([\s\S]*?\) to (public|anon|authenticated|service_role)/i);

const policyBlocks = code.split(/create policy/i).slice(1);
assert.ok(policyBlocks.length >= 3);
policyBlocks.forEach((block) => {
  const head = block.slice(0, 500);
  assert.match(block, new RegExp(adminUid), "an offer email policy must require the admin user id");
  assert.doesNotMatch(head, /for all/i);
  assert.doesNotMatch(block, /using\s*\(\s*true\s*\)/i);
});

const account = read("assets/js/account.js");
assert.match(account, /offers_viewed_at/);
assert.match(account, /offerUnseen/);
assert.match(account, /One offer has changed since you last looked/);
assert.match(account, /Updated/);
assert.match(account, /touchedOfferIds/);

const accountPage = read("account.html");
assert.match(accountPage, /id="offer-updates"/);

const notes = read("assets/js/admin-notifications.js");
assert.match(notes, /The customer is emailed at the address on the offer/);
assert.doesNotMatch(notes, /openMailto/);

const cabinet = read("admin.html");
assert.match(cabinet, /Send counter-offer/);
assert.doesNotMatch(cabinet, /Open email/);

const privacy = read("privacy.html");
assert.match(privacy, /Those notes are about the offer/);
assert.match(privacy, /not shop news/);

console.log("offer email checks passed");
