import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const catalogUrl = new URL("../assets/js/shop-catalog.js", import.meta.url);
const sqlUrl = new URL("../supabase/shop-products.sql", import.meta.url);

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

assert.equal(shop.slugify("Vintage Murano Glass & Crystal"), "vintage-murano-glass-and-crystal");
assert.equal(shop.slugify("  Café Plate  "), "cafe-plate");
assert.equal(shop.normaliseCategory("glass & crystal"), "Glass & Crystal");
assert.equal(shop.normaliseCategory("brass-and-metalwork"), "Brass & Metalwork");
assert.equal(shop.normaliseCategory("not a shelf"), "");

assert.equal(shop.parsePrice("£1,250.50"), "1250.50");
assert.equal(shop.parsePrice("45"), "45.00");
assert.equal(shop.parsePrice("0"), "0.00");
assert.equal(shop.parsePrice("45.555"), null);
assert.equal(shop.parsePrice("-1"), null);
assert.equal(shop.parsePrice(""), null);
assert.equal(shop.parseSortOrder(""), 0);
assert.equal(shop.parseSortOrder("-2"), -2);
assert.equal(shop.parseSortOrder("1.5"), null);

const formatted = shop.formatPrice("45");
assert.match(formatted, /45\.00/);
assert.match(formatted, /£/);

assert.equal(shop.validateImageFile({ name: "cup.jpg", type: "image/jpeg", size: 1200 }).ok, true);
assert.equal(shop.validateImageFile({ name: "cup.heic", type: "image/heic", size: 1200 }).ok, false);
assert.match(shop.validateImageFile({ name: "big.png", type: "image/png", size: 6 * 1024 * 1024 }).message, /5 MB/);

const products = [
  { slug: "sold-bell", title: "Edinburgh Bell", category: "Glass & Crystal", status: "sold", created_at: "2026-10-03T00:00:00Z", price: "20.00", featured: false, sort_order: 0 },
  { slug: "draft-vase", title: "Hidden Vase", category: "Ceramics & Pottery", status: "draft", created_at: "2026-10-04T00:00:00Z", price: "10.00" },
  { slug: "reserved-mouse", title: "Boot Mouse", category: "Brass & Metalwork", status: "reserved", created_at: "2026-10-02T00:00:00Z", price: "15.00", description: "A small brass mouse" },
  { slug: "amber-vase", title: "Amber Cased Vase", category: "Glass & Crystal", status: "available", created_at: "2026-10-01T00:00:00Z", price: 42, featured: true, sort_order: 5, images: ["https://example.test/amber.jpg"], cover_image: "https://example.test/amber.jpg" }
];

const shelf = shop.sortForShelf(shop.filterShelf(products, {}));
assert.deepEqual(shelf.map((item) => item.slug), ["amber-vase", "reserved-mouse", "sold-bell"]);

const hiddenSold = shop.sortForShelf(shop.filterShelf(products, { hideSold: true }));
assert.deepEqual(hiddenSold.map((item) => item.slug), ["amber-vase", "reserved-mouse"]);

const brass = shop.filterShelf(products, { category: "Brass & Metalwork", query: "mouse" });
assert.deepEqual(brass.map((item) => item.slug), ["reserved-mouse"]);

assert.equal(shop.coverUrl(products[3]), "https://example.test/amber.jpg");
const gallery = shop.galleryUrls({
  images: ["https://example.test/b.jpg", "https://example.test/a.jpg"],
  cover_image: "https://example.test/a.jpg"
});
assert.deepEqual(Array.from(gallery), ["https://example.test/a.jpg", "https://example.test/b.jpg"]);
assert.equal(shop.safeImageUrl("javascript:alert(1)"), "");

assert.equal(shop.readOptionalPrice("").ok, true);
assert.equal(shop.readOptionalPrice("").value, null);
assert.equal(shop.readOptionalPrice("  ").value, null);
assert.equal(shop.readOptionalPrice("£45").value, "45.00");
assert.equal(shop.readOptionalPrice("0").value, "0.00");
assert.equal(shop.readOptionalPrice("45.555").ok, false);
assert.equal(shop.readOptionalPrice("-1").ok, false);
assert.equal(shop.storedPrice("48.00", "40.00", "35.00"), "48.00");
assert.equal(shop.storedPrice(null, "40.00", "35.00"), "35.00");
assert.equal(shop.storedPrice(null, null, "32.50"), "32.50");
assert.equal(shop.storedPrice(null, null, null), null);

const legacy = { price: "42.00" };
assert.equal(shop.offeredPrices(legacy).map((option) => option.key).join(","), "price");
assert.match(shop.headlinePrice(legacy), /£/);
assert.match(shop.headlinePrice(legacy), /42\.00/);
assert.doesNotMatch(shop.headlinePrice(legacy), /From|Delivered|Collection|Item only/);
assert.match(shop.priceSummary(legacy), /42\.00/);
assert.doesNotMatch(shop.priceSummary(legacy), /Delivered/);

const pending = { price: "42.00", price_delivered: null, price_item: null, price_collection: null };
assert.equal(shop.offeredPrices(pending)[0].key, "price");
assert.match(shop.headlinePrice(pending), /42\.00/);

const deliveredOnly = { price: "48.00", price_delivered: "48.00", price_item: null, price_collection: null };
assert.match(shop.headlinePrice(deliveredOnly), /^Delivered /);
assert.match(shop.headlinePrice(deliveredOnly), /48\.00/);
assert.equal(shop.offeredPrices(deliveredOnly)[0].label, "Delivered to your door");
assert.equal(shop.offeredPrices(deliveredOnly)[0].note, "");

const collectionOnly = { price: "25.00", price_delivered: null, price_item: null, price_collection: 0 };
assert.equal(shop.offeredPrices(collectionOnly).map((option) => option.key).join(","), "collection");
assert.match(shop.headlinePrice(collectionOnly), /^Collection /);
assert.match(shop.headlinePrice(collectionOnly), /0\.00/);
assert.equal(shop.offeredPrices(collectionOnly)[0].note, "Collection by arrangement");
assert.equal(shop.offeredPrices(collectionOnly)[0].label, "Collect from Wisbech");

const itemOnly = { price: "40.00", price_delivered: null, price_item: "40.00", price_collection: null };
assert.match(shop.headlinePrice(itemOnly), /^Item only /);
assert.equal(shop.offeredPrices(itemOnly)[0].note, "Contact us to arrange collection by your courier");
assert.equal(shop.offeredPrices(itemOnly)[0].label, "Item only, arrange your own courier");

const trio = {
  price: "48.00",
  price_delivered: "48.00",
  price_item: "40.00",
  price_collection: "35.50"
};
const trioOptions = shop.offeredPrices(trio);
assert.deepEqual(Array.from(trioOptions.map((option) => option.key)), ["delivered", "item", "collection"]);
assert.match(shop.headlinePrice(trio), /^From /);
assert.match(shop.headlinePrice(trio), /35\.50/);
assert.doesNotMatch(shop.headlinePrice(trio), /48\.00/);
const summary = shop.priceSummary(trio);
assert.match(summary, /Delivered/);
assert.match(summary, /Item only/);
assert.match(summary, /Collection/);
assert.match(summary, /35\.50/);

assert.equal(shop.columnsWithPrices("id,price"), "id,price,price_delivered,price_item,price_collection");
assert.equal(shop.missingPriceColumns(null), false);
assert.equal(shop.missingPriceColumns({ code: "42501", message: "permission denied for table products" }), false);
assert.equal(
  shop.missingPriceColumns({
    code: "PGRST204",
    message: "Could not find the 'price_delivered' column of 'products' in the schema cache"
  }),
  true
);
assert.equal(
  shop.missingPriceColumns({ code: "42703", message: "column products.price_item does not exist" }),
  true
);

const mailto = shop.enquireMailto({ title: "Amber Cased Vase", slug: "amber-vase" }, "https://thecuriocubbyhole.com/shop.html?item=amber-vase");
assert.match(mailto, /^mailto:curiocubbyhole@gmail\.com\?/);
assert.match(decodeURIComponent(mailto), /Amber Cased Vase/);
assert.match(decodeURIComponent(mailto), /shop\.html\?item=amber-vase/);

assert.equal(
  shop.shopUrl({ category: "Glass & Crystal", q: "amber", hideSold: true }),
  "shop.html?category=Glass%20%26%20Crystal&q=amber&sold=hidden"
);

const latest = shop.sortLatest(products.filter(shop.isPublicProduct)).slice(0, 8);
assert.deepEqual(latest.map((item) => item.slug), ["sold-bell", "reserved-mouse", "amber-vase"]);

const sql = fs.readFileSync(sqlUrl, "utf8");
const sqlCode = sql.replace(/--.*$/gm, "");
assert.doesNotMatch(sqlCode, /alter\s+table\s+storage\.objects/i);
assert.match(sql, /on conflict \(id\) do nothing/i);
assert.match(sql, /product-images/);
assert.match(sql, /222043d1-053b-45be-ab39-20216c84ee86/);
assert.match(sql, /'draft'/);
assert.match(sql, /available', 'reserved', 'sold'/);
assert.match(sql, /Public read listed products/);
assert.match(sql, /Admin manages products/);
assert.match(sql, /Public read product images/);
assert.match(sql, /touch_product_updated_at/);
assert.match(sql, /price_delivered numeric\(10, 2\)/);
assert.match(sql, /price_item numeric\(10, 2\)/);
assert.match(sql, /price_collection numeric\(10, 2\)/);
assert.match(sql, /products_price_delivered_check check \(price_delivered >= 0\)/);
assert.match(sql, /products_price_item_check check \(price_item >= 0\)/);
assert.match(sql, /products_price_collection_check check \(price_collection >= 0\)/);
assert.match(sql, /shop-prices\.sql/);

const pricesUrl = new URL("../supabase/shop-prices.sql", import.meta.url);
const pricesSql = fs.readFileSync(pricesUrl, "utf8");
const pricesCode = pricesSql.replace(/--.*$/gm, "");
assert.match(pricesSql, /add column if not exists price_delivered numeric\(10, 2\)/i);
assert.match(pricesSql, /check \(price_delivered >= 0\)/i);
assert.match(pricesSql, /add column if not exists price_item numeric\(10, 2\)/i);
assert.match(pricesSql, /check \(price_item >= 0\)/i);
assert.match(pricesSql, /add column if not exists price_collection numeric\(10, 2\)/i);
assert.match(pricesSql, /check \(price_collection >= 0\)/i);
assert.match(pricesCode, /set price_delivered = price/i);
assert.match(pricesCode, /price_delivered is null/i);
assert.match(pricesCode, /price_item is null/i);
assert.match(pricesCode, /price_collection is null/i);
assert.doesNotMatch(pricesCode, /alter\s+table\s+storage\.objects/i);
assert.doesNotMatch(pricesCode, /storage\.objects/i);
assert.doesNotMatch(pricesCode, /create\s+policy/i);
assert.doesNotMatch(pricesCode, /enable\s+row\s+level\s+security/i);
assert.doesNotMatch(pricesCode, /drop\s+policy/i);
assert.doesNotMatch(pricesSql, /not null/i);

const setup = fs.readFileSync(new URL("../supabase/SHOP-SETUP.md", import.meta.url), "utf8");
assert.match(setup, /Adding the three prices/);
assert.match(setup, /shop-prices\.sql/);
assert.match(setup, /Price with delivery/);
assert.match(setup, /Item only, own courier/);
assert.match(setup, /Collection price/);

const pages = ["index.html", "journal.html", "contact_us.html", "our_story.html", "shop.html", "admin.html"];
const root = new URL("..", import.meta.url);
for (const page of pages) {
  const html = fs.readFileSync(new URL(page, root), "utf8");
  assert.doesNotMatch(html, /header-icons/, page);
  assert.doesNotMatch(html, /href="#shop"/, page);
  assert.doesNotMatch(html, /hello@example\.com/, page);
  if (page !== "admin.html") {
    assert.match(html, /href="shop\.html/, page);
  }
}

const home = fs.readFileSync(new URL("index.html", root), "utf8");
assert.match(home, /action="shop\.html"/);
assert.match(home, /name="q"/);
assert.match(home, /shop\.html\?category=Glass%20%26%20Crystal/);
assert.match(home, /shop\.html\?category=Curious%20Things/);
assert.match(home, /id="home-shop-grid"/);
assert.doesNotMatch(home, /Vintage Murano Glass Basket/);
assert.match(home, /assets\/js\/home-shop\.js/);
assert.match(home, /assets\/js\/shop-catalog\.js/);

const shopPage = fs.readFileSync(new URL("shop.html", root), "utf8");
assert.match(shopPage, /assets\/js\/shop\.js/);
assert.match(shopPage, /data-category="Glass &amp; Crystal"/);
assert.match(shopPage, /id="piece-prices"/);
assert.match(shopPage, /id="piece-enquire"/);
assert.match(shopPage, /curiocubbyhole@gmail\.com/);
assert.doesNotMatch(shopPage, /src="\//);
assert.doesNotMatch(shopPage, /href="\//);

const admin = fs.readFileSync(new URL("admin.html", root), "utf8");
assert.match(admin, /id="shop-desk"/);
assert.match(admin, /id="tab-shop"/);
assert.match(admin, /assets\/js\/admin-shop\.js/);
assert.match(admin, /product-images|upload-images/);
assert.match(admin, /Price with delivery \(£\)/);
assert.match(admin, /Item only, own courier \(£\)/);
assert.match(admin, /Collection price \(£\)/);
assert.match(admin, /id="product-price-delivered"/);
assert.match(admin, /id="product-price-item"/);
assert.match(admin, /id="product-price-collection"/);
assert.doesNotMatch(admin, /id="product-price"/);
assert.match(admin, /including UK delivery by the shop/);
assert.match(admin, /arranges their own courier/);
assert.match(admin, /collect in person from Wisbech/);

const shopJs = fs.readFileSync(new URL("../assets/js/shop.js", import.meta.url), "utf8");
assert.match(shopJs, /headlinePrice/);
assert.match(shopJs, /offeredPrices/);
assert.match(shopJs, /missingPriceColumns/);
assert.match(shopJs, /columnsWithPrices/);
assert.match(shopJs, /Delivered to your door|option\.label/);
const homeJs = fs.readFileSync(new URL("../assets/js/home-shop.js", import.meta.url), "utf8");
assert.match(homeJs, /headlinePrice/);
assert.match(homeJs, /missingPriceColumns/);
assert.match(homeJs, /columnsWithPrices/);
const adminJs = fs.readFileSync(new URL("../assets/js/admin-shop.js", import.meta.url), "utf8");
assert.match(adminJs, /price_delivered/);
assert.match(adminJs, /price_item/);
assert.match(adminJs, /price_collection/);
assert.match(adminJs, /readOptionalPrice/);
assert.match(adminJs, /storedPrice/);
assert.match(adminJs, /priceSummary/);
assert.match(adminJs, /shop-prices\.sql/);
assert.match(adminJs, /curioSuggestSale/);
assert.match(adminJs, /tab-notifications/);
assert.match(adminJs, /#notifications/);

assert.deepEqual(
  Array.from(shop.offerChoices(trio).map((option) => option.key)),
  ["delivered", "item", "collection"]
);
assert.equal(shop.offerChoices(trio)[1].label, "Item only, own courier");
assert.equal(shop.offerChoices(legacy)[0].key, "delivered");
assert.equal(shop.offerChoices(legacy)[0].label, "Delivered");
assert.equal(shop.askedAmount(trio, "item"), 40);
assert.equal(shop.askedAmount(trio, "other"), null);
assert.equal(shop.preferredSaleOption(trio).key, "delivered");
assert.equal(shop.preferredSaleOption({}).key, "other");
assert.equal(shop.offerPercent(30, 48), 63);
assert.equal(shop.offerPercent(24, 48), 50);
assert.equal(shop.offerPercent(10, 0), null);
assert.equal(shop.channelLabel("in_person"), "In person");
assert.equal(shop.channelLabel("ebay"), "eBay");
assert.equal(shop.inLondonMonth("2026-04-30T23:30:00Z", "2026-05-02T12:00:00Z"), true);
assert.equal(shop.inLondonMonth("2026-04-30T22:30:00Z", "2026-05-02T12:00:00Z"), false);
assert.match(shop.formatWhen("2026-11-04T09:30:00Z"), /2026/);

const offer = {
  product_title: "Amber Cased Vase",
  name: "Ada Lovelace",
  email: "ada@example.com",
  amount: "30.00",
  option: "delivered"
};
const contactMail = shop.offerContactMailto(offer);
assert.match(contactMail, /^mailto:ada@example.com\?/);
assert.match(decodeURIComponent(contactMail), /Your offer on Amber Cased Vase/);
const counterMail = shop.counterMailto(offer, "36.00");
assert.match(counterMail, /^mailto:ada@example.com\?/);
assert.match(decodeURIComponent(counterMail), /We can do/);
assert.match(decodeURIComponent(counterMail), /36\.00/);
assert.equal(shop.offerContactMailto({ email: "bad email" }), "");

const notesUrl = new URL("../supabase/shop-notifications.sql", import.meta.url);
const notesSql = fs.readFileSync(notesUrl, "utf8");
const notesCode = notesSql.replace(/--.*$/gm, "");
assert.doesNotMatch(notesCode, /storage\.objects/i);
assert.doesNotMatch(notesCode, /storage\.buckets/i);
assert.doesNotMatch(notesCode, /create\s+policy[\s\S]*storage/i);
assert.match(notesSql, /does not alter storage/i);
assert.match(notesSql, /222043d1-053b-45be-ab39-20216c84ee86/);
assert.match(notesSql, /create table if not exists public\.offers/i);
assert.match(notesSql, /create table if not exists public\.sales/i);
assert.match(notesSql, /references public\.products \(id\) on delete set null/i);
assert.match(notesSql, /status in \('new', 'read', 'accepted', 'declined', 'countered', 'archived'\)/);
assert.match(notesSql, /amount > 0 and amount <= 99999999\.99/);
assert.match(notesSql, /option in \('delivered', 'item', 'collection'\)/);
assert.match(notesSql, /option in \('delivered', 'item', 'collection', 'other'\)/);
assert.match(notesSql, /channel in \('website', 'etsy', 'ebay', 'vinted', 'in_person', 'other'\)/);
assert.match(notesSql, /payment_ref text/);
assert.match(notesSql, /source text/);
assert.match(notesSql, /Public insert new offers/);
assert.match(notesSql, /status = 'new'/);
assert.match(notesSql, /grant insert on table public\.offers to anon, public/i);
assert.match(notesSql, /Admin manages offers/);
assert.match(notesSql, /Admin manages sales/);
assert.doesNotMatch(notesCode, /grant select on table public\.offers to anon/i);

assert.match(setup, /shop-notifications\.sql/);
assert.match(setup, /privacy\.html/);
assert.match(setup, /name, email address, phone number/);

assert.match(shopPage, /Make an offer/);
assert.match(shopPage, /I agree to be contacted about this offer/);
assert.match(shopPage, /href="privacy\.html"/);
assert.match(shopPage, /id="offer-company"/);
assert.match(shopPage, /id="piece-offer"/);
assert.match(shopJs, /ccc-offer-times/);
assert.match(shopJs, /from\("offers"\)\.insert/);
assert.match(shopJs, /status === "available" \|\| product\.status === "reserved"/);

assert.match(admin, /id="tab-notifications"/);
assert.match(admin, /id="notifications-badge"/);
assert.match(admin, /assets\/js\/admin-notifications\.js/);
assert.match(admin, /id="sale-dialog"/);
assert.match(admin, /data-notice-filter="unread"/);
const notesJs = fs.readFileSync(new URL("../assets/js/admin-notifications.js", import.meta.url), "utf8");
assert.match(notesJs, /postgres_changes/);
assert.match(notesJs, /notifications-refresh/);
assert.match(notesJs, /curioSuggestSale/);
assert.match(notesJs, /counterMailto/);
assert.match(notesJs, /status: "accepted"/);
assert.match(notesJs, /payment_ref|source/);

const privacy = fs.readFileSync(new URL("privacy.html", root), "utf8");
assert.match(privacy, /href="shop\.html"/);
assert.match(privacy, /curiocubbyhole@gmail\.com/);
assert.doesNotMatch(privacy, /header-icons/);
assert.doesNotMatch(privacy, /href="\//);

console.log("shop catalog tests passed");
