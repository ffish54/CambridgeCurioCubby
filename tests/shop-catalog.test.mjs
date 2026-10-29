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
assert.match(shopPage, /id="piece-enquire"/);
assert.match(shopPage, /curiocubbyhole@gmail\.com/);
assert.doesNotMatch(shopPage, /src="\//);
assert.doesNotMatch(shopPage, /href="\//);

const admin = fs.readFileSync(new URL("admin.html", root), "utf8");
assert.match(admin, /id="shop-desk"/);
assert.match(admin, /id="tab-shop"/);
assert.match(admin, /assets\/js\/admin-shop\.js/);
assert.match(admin, /product-images|upload-images/);

console.log("shop catalog tests passed");
