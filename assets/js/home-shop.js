/* Latest non-draft pieces for the home "Recently Discovered" grid.
   Public read, same shape as the shop: drafts stay off the shelf. */

(function () {
  var LIST_COLUMNS = "id,slug,title,category,price,status,featured,images,cover_image,created_at";
  var LIMIT = 8;

  var grid = document.getElementById("home-shop-grid");
  var statusLine = document.getElementById("home-shop-status");
  var retryButton = document.getElementById("home-shop-retry");

  if (!grid || !statusLine || !window.CurioShop) return;

  function setStatus(text) {
    statusLine.textContent = text || "";
  }

  function showRetry(show) {
    if (!retryButton) return;
    retryButton.hidden = !show;
  }

  function publicClient() {
    try {
      if (!window.supabase || typeof SUPABASE_URL !== "string" || typeof SUPABASE_PUBLISHABLE_KEY !== "string") {
        return null;
      }
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "ccc-public-home-shop"
        }
      });
    } catch (error) {
      return null;
    }
  }

  function fallback() {
    var placeholder = document.createElement("div");
    placeholder.className = "product-fallback";
    placeholder.setAttribute("aria-hidden", "true");
    placeholder.textContent = "◆  ✦  ◆";
    return placeholder;
  }

  function renderCard(product) {
    var item = document.createElement("li");
    var link = document.createElement("a");
    link.className = "product-card";
    link.href = CurioShop.shopUrl({ item: product.slug });
    if (product.status === "sold") link.classList.add("is-sold");
    if (product.status === "reserved") link.classList.add("is-reserved");

    var frame = document.createElement("div");
    frame.className = "product-image";
    var imageUrl = CurioShop.coverUrl(product);
    if (imageUrl) {
      var image = document.createElement("img");
      image.src = imageUrl;
      image.alt = product.title || "Curiosity";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", function () {
        image.replaceWith(fallback());
      });
      frame.append(image);
    } else {
      frame.append(fallback());
    }

    if (product.status === "sold" || product.status === "reserved") {
      var badge = document.createElement("span");
      badge.className = "product-badge";
      badge.textContent = CurioShop.statusLabel(product.status);
      frame.append(badge);
    }

    var info = document.createElement("div");
    info.className = "product-info";

    var bits = [];
    if (product.featured === true) bits.push("Featured");
    if (product.category) bits.push(product.category);
    if (bits.length) {
      var type = document.createElement("p");
      type.className = "product-type";
      type.textContent = bits.join(" · ");
      info.append(type);
    }

    var title = document.createElement("h3");
    title.textContent = product.title || "Untitled piece";
    info.append(title);

    var price = document.createElement("p");
    price.className = "price";
    price.textContent = CurioShop.formatPrice(product.price);
    info.append(price);

    link.append(frame, info);
    item.append(link);
    return item;
  }

  function render(products) {
    showRetry(false);
    grid.replaceChildren();
    if (!products.length) {
      setStatus("Nothing has been set out yet.");
      return;
    }
    setStatus("");
    products.forEach(function (product) {
      grid.append(renderCard(product));
    });
  }

  async function loadShelf() {
    var client = publicClient();
    if (!client || !client.from) {
      grid.replaceChildren();
      showRetry(false);
      setStatus("The latest finds could not be opened just now.");
      return;
    }

    setStatus("Opening the latest finds…");
    showRetry(false);

    try {
      var result = await client
        .from("products")
        .select(LIST_COLUMNS)
        .in("status", CurioShop.PUBLIC_STATUSES)
        .order("created_at", { ascending: false })
        .limit(LIMIT);

      if (result.error) throw result.error;

      var products = CurioShop.sortLatest((result.data || []).filter(CurioShop.isPublicProduct)).slice(0, LIMIT);
      render(products);
    } catch (error) {
      grid.replaceChildren();
      showRetry(true);
      setStatus("The latest finds could not be reached just now.");
    }
  }

  if (retryButton) {
    retryButton.addEventListener("click", function () {
      loadShelf();
    });
  }

  loadShelf();
})();
