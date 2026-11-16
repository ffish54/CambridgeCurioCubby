import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = new URL("..", import.meta.url);
const adminUid = "222043d1-053b-45be-ab39-20216c84ee86";

function read(relative) {
  return fs.readFileSync(new URL(relative, root), "utf8");
}

const sql = read("supabase/customer-accounts.sql");
const sqlCode = sql.replace(/--.*$/gm, "");

assert.doesNotMatch(sqlCode, /storage\.objects/i);
assert.doesNotMatch(sqlCode, /storage\.buckets/i);
assert.doesNotMatch(sql, /alter table storage/i);
assert.match(sql, new RegExp(adminUid));
assert.match(sql, /create table if not exists public\.profiles/i);
assert.match(sql, /marketing_consent boolean not null default false/i);
assert.match(sql, /references auth\.users \(id\) on delete cascade/i);
assert.match(sql, /offers\.user_id|add column if not exists user_id/i);
assert.match(sql, /references auth\.users \(id\) on delete set null/i);
assert.match(sql, /reserved_until timestamptz/i);
assert.match(sql, /now\(\) \+ interval '3 days'/);
assert.match(sql, /coalesce\(u\.last_sign_in_at, u\.created_at\) < now\(\) - interval '1 year'/);
assert.match(sql, /release-expired-reservations/);
assert.match(sql, /delete-inactive-accounts/);
assert.match(sql, /0 \* \* \* \*/);
assert.match(sql, /function public\.delete_my_account/i);
assert.match(sql, /function public\.respond_to_counter/i);
assert.match(sql, /function public\.link_guest_offers/i);
assert.match(sql, /revoke all on function public\.delete_customer_account\(uuid\) from public, anon, authenticated/i);
assert.match(sql, /grant execute on function public\.delete_my_account\(\) to authenticated/i);
assert.doesNotMatch(sql, /grant execute on function public\.delete_customer_account/i);
assert.match(sql, /The shop account cannot be deleted this way/);
assert.match(sql, /Customers read own offers/);
assert.match(sql, /user_id = auth\.uid\(\)/);
assert.match(sql, /auth\.uid\(\) is null and user_id is null/);

const policyBlocks = sqlCode.split(/create policy/i).slice(1);
policyBlocks.forEach((block) => {
  const head = block.slice(0, 500);
  const forAll = /for all/i.test(head);
  if (!forAll) return;
  assert.match(block, new RegExp(adminUid), "an FOR ALL policy must require the admin user id");
  assert.doesNotMatch(block, /using\s*\(\s*true\s*\)/i);
});

assert.match(sql, /Admin manages offers/);
assert.match(sql, /Admin manages sales/);
assert.match(sql, /does not alter storage/i);

const pages = [
  "index.html",
  "shop.html",
  "journal.html",
  "our_story.html",
  "contact_us.html",
  "privacy.html",
  "sign-in.html",
  "sign-up.html",
  "account.html",
  "account-reset.html"
];
pages.forEach((page) => {
  const html = read(page);
  assert.match(html, /data-account-nav/, page + " needs an account link");
  assert.match(html, /href="privacy\.html"/, page + " needs a privacy link");
  assert.doesNotMatch(html, /github\.io/, page + " must not send people to github.io");
});

const privacy = read("privacy.html");
assert.match(privacy, /PECR|Privacy and Electronic Communications/);
assert.match(privacy, /one year|a year/i);
assert.match(privacy, /Export/);
assert.match(privacy, /delete/i);
assert.match(privacy, /consent/i);
assert.match(privacy, /off unless you/i);

const config = read("assets/js/supabase-config.js");
assert.match(config, /SHOP_ORIGIN = "https:\/\/thecuriocubbyhole\.com"/);
assert.match(config, /ACCOUNT_URL = SHOP_ORIGIN \+ "\/account\.html"/);
assert.match(config, /CUSTOMER_RESET_URL = SHOP_ORIGIN \+ "\/account-reset\.html"/);
assert.match(config, /ADMIN_RESET_URL = SHOP_ORIGIN \+ "\/reset-password\.html"/);
assert.match(config, /AUTH_CAPTCHA_SITE_KEY = ""/);
assert.doesNotMatch(config, /github\.io/);

const login = read("assets/js/admin-login.js");
assert.match(login, /ADMIN_RESET_URL/);
assert.doesNotMatch(login, /github\.io/);
assert.match(login, /account\.html/);

const admin = read("assets/js/admin.js");
assert.match(admin, /leaveCustomer/);
assert.match(admin, /account\.html/);
const requireAdmin = admin.slice(admin.indexOf("async function requireAdmin"), admin.indexOf("function bindEvents"));
assert.doesNotMatch(requireAdmin, /signOut/);

const shop = read("assets/js/shop.js");
assert.match(shop, /presentProduct/);
assert.match(shop, /user_id/);
assert.match(shop, /prefillOfferFromAccount/);

const desk = read("assets/js/admin-shop.js");
assert.match(desk, /Extend hold/);
assert.match(desk, /Release/);
assert.match(desk, /Mark sold/);
assert.match(desk, /reserved_until/);

const signUp = read("sign-up.html");
assert.doesNotMatch(signUp, /marketing-consent"[^>]*checked/);
assert.match(signUp, /id="marketing-consent"/);

const account = read("account.html");
assert.match(account, /Export my data/);
assert.match(account, /Delete my account/);
assert.match(account, /Type DELETE to confirm/);
assert.match(account, /id="marketing-consent"/);
assert.doesNotMatch(account, /id="marketing-consent"[^>]*checked/);

const signIn = read("assets/js/sign-in.js");
assert.match(signIn, /signInWithOtp/);
assert.match(signIn, /shouldCreateUser: false/);
assert.match(signIn, /CUSTOMER_RESET_URL/);
assert.doesNotMatch(signIn, /signInWithOAuth|google/i);

for (const file of fs.readdirSync(new URL("supabase", root))) {
  if (!file.endsWith(".sql")) continue;
  const text = read(path.posix.join("supabase", file));
  const code = text.replace(/--.*$/gm, "");
  const blocks = code.split(/create policy/i).slice(1);
  blocks.forEach((block) => {
    if (!/for all/i.test(block.slice(0, 400))) return;
    assert.match(block, new RegExp(adminUid), file + " has an admin policy without the admin user id");
    assert.doesNotMatch(block, /using\s*\(\s*true\s*\)/i);
  });
  assert.doesNotMatch(code, /to authenticated\s+using\s*\(\s*true\s*\)/i);
  assert.doesNotMatch(code, /auth\.role\(\)\s*=\s*'authenticated'/i);
}

console.log("customer account checks passed");
