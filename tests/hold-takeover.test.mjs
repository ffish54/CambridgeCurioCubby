import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const root = new URL("..", import.meta.url);

function read(relative) {
  return fs.readFileSync(new URL(relative, root), "utf8");
}

function tagged(sql, tag) {
  const marker = "$" + tag + "$";
  const start = sql.indexOf("as " + marker);
  const end = sql.indexOf(marker, start + marker.length);
  assert.ok(start >= 0 && end > start, tag + " body missing");
  return sql.slice(start, end + marker.length);
}

const accounts = read("supabase/customer-accounts.sql");
const emails = read("supabase/offer-emails.sql");
const fix = read("supabase/hold-takeover-fix.sql");
const offersBody = tagged(accounts, "offers");
const rememberBody = tagged(emails, "remember");

assert.equal(tagged(fix, "offers"), offersBody);
assert.equal(tagged(fix, "remember"), rememberBody);

const offersCode = offersBody.replace(/--.*$/gm, "");
const raised = offersCode.indexOf("raise exception 'Sorry, this piece is currently reserved for another buyer.'");
const accepted = offersCode.indexOf("if new.status = 'accepted' then");
const extended = offersCode.indexOf("reserved_until = now() + interval '3 days'");
assert.ok(accepted > 0 && raised > accepted && extended > raised);
assert.ok(offersCode.indexOf("piece_status = 'reserved'") < raised);
assert.ok(offersCode.indexOf("piece_until > now()") < raised);
assert.ok(offersCode.indexOf("held_offer is distinct from old.id") < raised);
assert.ok(offersCode.indexOf("to_regclass('public.offer_holds')") < raised);
assert.match(offersCode, /perform set_config\('ccc\.hold_takeover_blocked', 'no', true\)/);
assert.ok(offersCode.indexOf("ccc.hold_takeover_blocked") < extended);
assert.doesNotMatch(offersCode, /exception\s+when others/i);

const rememberCode = rememberBody.replace(/--.*$/gm, "");
assert.match(rememberCode, /existing\.offer_id is distinct from p_offer_id/);
assert.match(rememberCode, /held_piece\.reserved_until > pg_catalog\.now\(\)/);
assert.match(rememberCode, /current_setting\('ccc\.hold_takeover_blocked', true\) = 'no'/);
assert.match(rememberCode, /on conflict \(product_id\) do update/);
assert.match(rememberCode, /offer_holds\.offer_id is not distinct from excluded\.offer_id/);
assert.doesNotMatch(
  rememberCode,
  /on conflict \(product_id\) do update\s+set offer_id = excluded\.offer_id,\s+created_at = pg_catalog\.now\(\)\s*;/i
);

const fixCode = fix.replace(/--.*$/gm, "");
assert.match(fix, /create or replace function public\.offers_before_write/i);
assert.match(fix, /create or replace function public\.offer_email_remember_hold/i);
assert.match(fix, /drop trigger if exists offers_before_write/i);
assert.match(fix, /drop policy if exists "Admin reads offer holds"/i);
assert.match(fixCode, /for select/);
assert.match(fix, /222043d1-053b-45be-ab39-20216c84ee86/);
assert.doesNotMatch(fixCode, /storage\.objects/i);
assert.doesNotMatch(fixCode, /storage\.buckets/i);
assert.doesNotMatch(fix, /alter table storage/i);
assert.doesNotMatch(fixCode, /auth\.role\(\)\s*=\s*'authenticated'/i);
assert.doesNotMatch(fixCode, /to authenticated\s+using\s*\(\s*true\s*\)/i);

const emailsCode = emails.replace(/--.*$/gm, "");
assert.match(emailsCode, /grant select on table public\.offer_holds to authenticated/i);
assert.match(emailsCode, /Admin reads offer holds/);
assert.match(emailsCode, /using \(auth\.uid\(\) = '222043d1-053b-45be-ab39-20216c84ee86'::uuid\)/);

const shopJs = read("assets/js/shop.js");
assert.match(shopJs, /This piece is currently reserved\. You can still make an offer in case it becomes available again\./);
assert.doesNotMatch(shopJs, /whether it comes free/);
assert.doesNotMatch(shopJs, /You can still make an offer, or enquire/);

const account = read("assets/js/account.js");
const respond = account.slice(account.indexOf("async function respond"), account.indexOf("async function exportData"));
const friendly = respond.indexOf("Sorry, this piece is currently reserved for another buyer.");
const generic = respond.indexOf("We could not update that offer");
assert.ok(friendly > 0 && generic > friendly);
assert.ok(respond.indexOf("reserved for another buyer") < respond.indexOf("cannot be reserved"));

const notes = read("assets/js/admin-notifications.js");
assert.match(notes, /from\("offer_holds"\)/);
assert.match(notes, /heldForAnotherOffer/);
assert.match(notes, /This customer will not be able to accept until that hold ends\. You can still send the counter-offer\./);
const openCounter = notes.slice(notes.indexOf("function openCounter"), notes.indexOf("async function updateOffer"));
assert.match(openCounter, /counter-hold-warning/);
assert.doesNotMatch(openCounter, /\.disabled/);

const cabinet = read("admin.html");
assert.match(cabinet, /id="counter-hold-warning"/);
assert.match(cabinet, /id="counter-send"/);
assert.doesNotMatch(cabinet, /id="counter-send"[^>]*disabled/);

const catalogUrl = new URL("../assets/js/shop-catalog.js", import.meta.url);
const context = {
  console,
  URL,
  Intl,
  Date,
  encodeURIComponent,
  Number,
  String,
  Array,
  Boolean,
  Math,
  Object,
  JSON,
  RegExp
};
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(catalogUrl, "utf8"), context);
const shop = context.CurioShop;

const now = "2026-06-01T12:00:00Z";
const future = "2026-06-04T12:00:00Z";
const past = "2026-05-01T12:00:00Z";
const held = { status: "reserved", reserved_until: future };

assert.equal(shop.heldForAnotherOffer(held, "offer-a", "offer-b", now), true);
assert.equal(shop.heldForAnotherOffer(held, "offer-a", "offer-a", now), false);
assert.equal(shop.heldForAnotherOffer(held, "OFFER-A", "offer-a", now), false);
assert.equal(shop.heldForAnotherOffer({ status: "reserved", reserved_until: past }, "offer-a", "offer-b", now), false);
assert.equal(shop.heldForAnotherOffer({ status: "reserved" }, "offer-a", "offer-b", now), false);
assert.equal(shop.heldForAnotherOffer({ status: "available", reserved_until: future }, "offer-a", "offer-b", now), false);
assert.equal(shop.heldForAnotherOffer(held, null, "offer-b", now), false);
assert.equal(shop.heldForAnotherOffer(held, "offer-a", "", now), false);

console.log("hold takeover checks passed");
