/* Public shop. Drafts never render. Available and reserved lead; sold follows. */

(function () {
  var LIST_COLUMNS = "id,slug,title,category,price,condition,era,maker,dimensions,description,status,featured,sort_order,images,cover_image,created_at";

  var browse = document.getElementById("shop-browse");
  var heading = document.getElementById("shop-heading");
  var intro = document.getElementById("shop-intro");
  var statusLine = document.getElementById("shop-status");
  var retryButton = document.getElementById("shop-retry");
  var grid = document.getElementById("shop-grid");
  var searchForm = document.getElementById("shop-search");
  var searchInput = document.getElementById("shop-q");
  var entryStatus = document.getElementById("piece-status");
  var entry = document.getElementById("shop-piece");
  var missing = document.getElementById("shop-missing");
  var backLink = document.getElementById("shop-back");

  var route = readRoute();
  var publicClient = null;
  var gallery = [];
  var galleryIndex = 0;

  function readRoute() {
    var params = new URLSearchParams(window.location.search);
    var rawCategory = (params.get("category") || "").trim();
    var category = window.CurioShop ? CurioShop.normaliseCategory(rawCategory) : "";
    return {
      item: (params.get("item") || "").trim(),
      category: category,
      unknownCategory: Boolean(rawCategory) && !category,
      q: (params.get("q") || "").trim(),
      hideSold: (params.get("sold") || "") === "hidden"
    };
  }

  function clientReady() {
    try {
      if (!window.CurioShop || !window.supabase) return false;
      if (typeof SUPABASE_URL !== "string" || typeof SUPABASE_PUBLISHABLE_KEY !== "string") return false;
      if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
      publicClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "ccc-public-shop"
        }
      });
      return Boolean(publicClient && publicClient.from);
    } catch (error) {
      return false;
    }
  }

  function piecePageUrl(slug) {
    return new URL(CurioShop.shopUrl({ item: slug }), window.location.href).href;
  }

  function listBackUrl() {
    return CurioShop.shopUrl({
      category: route.category,
      q: route.q,
      hideSold: route.hideSold
    });
  }

  function syncFilters() {
    document.querySelectorAll("#shop-filters a[data-category]").forEach(function (link) {
      var value = link.dataset.category || "";
      link.href = CurioShop.shopUrl({
        category: value,
        q: route.q,
        hideSold: route.hideSold
      });
      var current = !route.item && !route.unknownCategory && value === (route.category || "");
      if (current) link.setAttribute("aria-current", "true");
      else link.removeAttribute("aria-current");
    });

    var toggle = document.getElementById("shop-sold-toggle");
    if (!toggle) return;
    toggle.href = CurioShop.shopUrl({
      category: route.unknownCategory ? "" : route.category,
      q: route.q,
      hideSold: !route.hideSold
    });
    toggle.textContent = route.hideSold ? "Show sold" : "Hide sold";
    toggle.setAttribute("aria-pressed", route.hideSold ? "true" : "false");
  }

  function setBrowseCopy() {
    if (route.unknownCategory) {
      heading.textContent = "That shelf";
      intro.textContent = "We don't keep a category by that name. Choose one of the shelves below.";
      return;
    }
    if (route.q && route.category) {
      heading.textContent = route.category;
      intro.textContent = "Pieces in this category matching “" + route.q + "”.";
      return;
    }
    if (route.q) {
      heading.textContent = "Search";
      intro.textContent = "Pieces matching “" + route.q + "”.";
      return;
    }
    if (route.category) {
      heading.textContent = route.category;
      intro.textContent = "What is out on this shelf, with sold pieces at the end.";
      return;
    }
    heading.textContent = "On the shelf";
    intro.textContent = route.hideSold
      ? "Available and reserved pieces. Sold pieces are hidden."
      : "Available and reserved pieces first, sold pieces after.";
  }

  function showBrowseMessage(text, showRetry) {
    statusLine.textContent = text || "";
    retryButton.hidden = !showRetry;
    if (text) grid.replaceChildren();
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
    link.href = CurioShop.shopUrl({
      item: product.slug,
      category: route.category,
      q: route.q,
      hideSold: route.hideSold
    });
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

    var headline = CurioShop.headlinePrice(product);
    if (headline) {
      var price = document.createElement("p");
      price.className = "price";
      price.textContent = headline;
      info.append(price);
    }

    link.append(frame, info);
    item.append(link);
    return item;
  }

  function emptyCopy(listed) {
    if (route.unknownCategory) return "Choose a shelf from the list above.";
    if (route.q) return "Nothing on the shelf matches that search.";
    if (route.hideSold && listed.some(function (product) { return product.status === "sold"; })) {
      return "Sold pieces are hidden. Show sold to look back through them.";
    }
    if (route.category) return "Nothing has been set out under " + route.category + " yet.";
    return "The shelf is quiet just now. New pieces will appear here once they are added.";
  }

  function renderPrices(product) {
    var list = document.getElementById("piece-prices");
    if (!list) return;
    list.replaceChildren();
    CurioShop.offeredPrices(product).forEach(function (option) {
      var item = document.createElement("li");
      var line = document.createElement("p");
      line.className = "piece-price-line";
      line.textContent = option.label + " " + CurioShop.formatPrice(option.amount);
      item.append(line);
      if (option.note) {
        var note = document.createElement("p");
        note.className = "piece-price-note";
        note.textContent = option.note;
        item.append(note);
      }
      list.append(item);
    });
  }

  async function selectColumns(build) {
    var result = await build(CurioShop.columnsWithPrices(LIST_COLUMNS));
    if (result && result.error && CurioShop.missingPriceColumns(result.error)) {
      result = await build(LIST_COLUMNS);
    }
    return result;
  }

  async function loadList() {
    setBrowseCopy();
    if (searchInput) searchInput.value = route.q;
    document.title = (route.category || "Shop") + " | Cambridge Curio Cubbyhole";
    showBrowseMessage("Opening the shelf…", false);

    if (route.unknownCategory) {
      showBrowseMessage(emptyCopy([], []), false);
      return;
    }

    try {
      var result = await selectColumns(function (columns) {
        return publicClient
          .from("products")
          .select(columns)
          .in("status", CurioShop.PUBLIC_STATUSES)
          .order("created_at", { ascending: false });
      });

      if (result.error) throw result.error;

      var listed = CurioShop.filterShelf(result.data || [], {
        category: route.category,
        query: route.q,
        hideSold: false
      });
      var visible = CurioShop.sortForShelf(route.hideSold
        ? listed.filter(function (product) { return product.status !== "sold"; })
        : listed);

      retryButton.hidden = true;
      grid.replaceChildren();
      if (!visible.length) {
        statusLine.textContent = emptyCopy(listed);
        return;
      }
      statusLine.textContent = "";
      visible.forEach(function (product) {
        grid.append(renderCard(product));
      });
    } catch (error) {
      showBrowseMessage("The shelf could not be reached. Please try again.", true);
    }
  }

  function showReadingShell() {
    document.documentElement.classList.add("shop-reading");
    if (browse) browse.hidden = true;
  }

  function showMissing() {
    entry.hidden = true;
    missing.hidden = false;
    entryStatus.textContent = "";
    readingProduct = null;
    var prices = document.getElementById("piece-prices");
    if (prices) prices.replaceChildren();
    var open = document.getElementById("piece-offer-open");
    var form = document.getElementById("piece-offer");
    var thanks = document.getElementById("piece-offer-thanks");
    if (open) open.hidden = true;
    if (form) form.hidden = true;
    if (thanks) thanks.hidden = true;
    document.title = "Piece not found | Shop | Cambridge Curio Cubbyhole";
  }

  function addFact(list, label, value) {
    var text = String(value || "").trim();
    if (!text) return;
    var row = document.createElement("div");
    var term = document.createElement("dt");
    term.textContent = label;
    var detail = document.createElement("dd");
    detail.textContent = text;
    row.append(term, detail);
    list.append(row);
  }

  function fillStory(container, text) {
    container.replaceChildren();
    var blocks = String(text || "")
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map(function (block) { return block.trim(); })
      .filter(Boolean);

    if (!blocks.length) {
      var paragraph = document.createElement("p");
      paragraph.textContent = "The story of this piece has not been written out yet. Enquire and we will tell you what we know.";
      container.append(paragraph);
      return;
    }

    blocks.forEach(function (block) {
      var paragraph = document.createElement("p");
      var lines = block.split("\n");
      lines.forEach(function (line, index) {
        if (index) paragraph.append(document.createElement("br"));
        paragraph.append(document.createTextNode(line));
      });
      container.append(paragraph);
    });
  }

  function showPhotograph(index) {
    var image = document.getElementById("piece-photo");
    if (!image || !gallery.length) return;
    galleryIndex = (index + gallery.length) % gallery.length;
    var caption = document.getElementById("piece-photo-caption");
    var title = document.getElementById("piece-title").textContent || "This piece";
    var label = gallery.length > 1
      ? title + ", photograph " + (galleryIndex + 1) + " of " + gallery.length
      : title;
    image.src = gallery[galleryIndex];
    image.alt = label;
    if (caption) caption.textContent = gallery.length > 1 ? "Photograph " + (galleryIndex + 1) + " of " + gallery.length : "";
    document.querySelectorAll("#piece-thumbs button").forEach(function (button, buttonIndex) {
      var current = buttonIndex === galleryIndex;
      if (current) button.setAttribute("aria-current", "true");
      else button.removeAttribute("aria-current");
    });
  }

  function renderGallery(product) {
    var frame = document.getElementById("piece-frame");
    var thumbs = document.getElementById("piece-thumbs");
    gallery = CurioShop.galleryUrls(product);
    galleryIndex = 0;
    frame.replaceChildren();
    thumbs.replaceChildren();

    if (!gallery.length) {
      frame.append(fallback());
      thumbs.hidden = true;
      return;
    }

    var image = document.createElement("img");
    image.id = "piece-photo";
    image.className = "piece-photo";
    image.alt = product.title || "Curiosity";
    image.decoding = "async";
    image.addEventListener("error", function () {
      image.alt = (product.title || "This piece") + ". This photograph could not be loaded.";
    });
    frame.append(image);

    var caption = document.createElement("p");
    caption.id = "piece-photo-caption";
    caption.className = "piece-photo-caption";
    frame.append(caption);

    if (gallery.length < 2) {
      thumbs.hidden = true;
      showPhotograph(0);
      return;
    }

    thumbs.hidden = false;
    gallery.forEach(function (url, index) {
      var item = document.createElement("li");
      var button = document.createElement("button");
      button.type = "button";
      button.setAttribute("aria-label", "Show photograph " + (index + 1) + " of " + gallery.length);
      var thumb = document.createElement("img");
      thumb.src = url;
      thumb.alt = "";
      thumb.loading = "lazy";
      thumb.decoding = "async";
      button.append(thumb);
      button.addEventListener("click", function () {
        showPhotograph(index);
      });
      item.append(button);
      thumbs.append(item);
    });
    showPhotograph(0);
  }

  function renderEntry(product) {
    missing.hidden = true;
    entry.hidden = false;
    entryStatus.textContent = "";
    retryButton.hidden = true;

    var title = product.title || "Untitled piece";
    document.getElementById("piece-title").textContent = title;
    document.title = title + " | Shop | Cambridge Curio Cubbyhole";

    var bits = [];
    if (product.featured === true) bits.push("Featured");
    if (product.category) bits.push(product.category);
    document.getElementById("piece-kicker").textContent = bits.join(" · ");

    renderPrices(product);

    var facts = document.getElementById("piece-facts");
    facts.replaceChildren();
    addFact(facts, "Status", CurioShop.statusLabel(product.status));
    addFact(facts, "Category", product.category);
    addFact(facts, "Condition", product.condition);
    addFact(facts, "Era", product.era);
    addFact(facts, "Maker", product.maker);
    addFact(facts, "Dimensions", product.dimensions);

    var note = document.getElementById("piece-note");
    if (product.status === "reserved") {
      note.hidden = false;
      note.textContent = "Reserved. This piece is being held. You can still make an offer, or enquire if you would like to know whether it comes free.";
    } else if (product.status === "sold") {
      note.hidden = false;
      note.textContent = "Sold. This piece has found a home. You are welcome to ask if something similar turns up.";
    } else {
      note.hidden = false;
      note.textContent = "One of a kind. Enquire to reserve it, make an offer, or ask a question.";
    }

    var enquire = document.getElementById("piece-enquire");
    enquire.href = CurioShop.enquireMailto(product, piecePageUrl(product.slug));
    renderOffer(product);

    fillStory(document.getElementById("piece-story"), product.description);
    renderGallery(product);
  }

  var readingProduct = null;
  var offerSending = false;
  var OFFER_GAP_MS = 45000;
  var OFFER_HOUR_MS = 60 * 60 * 1000;
  var OFFER_HOUR_LIMIT = 5;
  var OFFER_TIMES_KEY = "ccc-offer-times";

  function recentOfferTimes() {
    try {
      var raw = JSON.parse(window.localStorage.getItem(OFFER_TIMES_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      var now = Date.now();
      return raw.filter(function (stamp) {
        return typeof stamp === "number" && now - stamp < OFFER_HOUR_MS;
      });
    } catch (error) {
      return [];
    }
  }

  function rememberOfferTime() {
    try {
      var times = recentOfferTimes();
      times.push(Date.now());
      window.localStorage.setItem(OFFER_TIMES_KEY, JSON.stringify(times.slice(-OFFER_HOUR_LIMIT)));
    } catch (error) {
      /* A private browser can still send this one offer. */
    }
  }

  function throttleMessage() {
    var times = recentOfferTimes();
    var now = Date.now();
    if (times.some(function (stamp) { return now - stamp < OFFER_GAP_MS; })) {
      return "Please wait a moment before sending another offer.";
    }
    if (times.length >= OFFER_HOUR_LIMIT) {
      return "You have sent several offers recently. Please wait a while, or enquire by email.";
    }
    return "";
  }

  function setOfferStatus(text, kind) {
    var line = document.getElementById("offer-message-status");
    if (!line) return;
    line.textContent = text || "";
    line.classList.toggle("is-error", kind === "error");
  }

  function showOfferThanks() {
    var form = document.getElementById("piece-offer");
    var open = document.getElementById("piece-offer-open");
    var thanks = document.getElementById("piece-offer-thanks");
    if (form) form.hidden = true;
    if (open) open.hidden = true;
    if (thanks) {
      thanks.hidden = false;
      thanks.textContent = "Thank you. We have your offer and will be in touch by email if we can accept it.";
    }
  }

  function resetOfferForm() {
    var form = document.getElementById("piece-offer");
    var thanks = document.getElementById("piece-offer-thanks");
    if (form) {
      form.reset();
      form.hidden = true;
    }
    if (thanks) {
      thanks.hidden = true;
      thanks.textContent = "";
    }
    setOfferStatus("");
  }

  function renderOffer(product) {
    readingProduct = product;
    var open = document.getElementById("piece-offer-open");
    var options = document.getElementById("offer-options");
    if (!open || !options) return;
    resetOfferForm();
    options.replaceChildren();
    var choices = CurioShop.offerChoices(product);
    var canOffer = (product.status === "available" || product.status === "reserved") && choices.length > 0;
    open.hidden = !canOffer;
    choices.forEach(function (choice, index) {
      var item = document.createElement("li");
      var label = document.createElement("label");
      var input = document.createElement("input");
      input.type = "radio";
      input.name = "offer-option";
      input.value = choice.key;
      input.required = true;
      if (index === 0) input.checked = true;
      var text = document.createElement("span");
      text.textContent = choice.label + " (" + CurioShop.formatPrice(choice.amount) + ")";
      label.append(input, text);
      item.append(label);
      options.append(item);
    });
  }

  function chosenOfferOption() {
    var selected = document.querySelector("#offer-options input[name='offer-option']:checked");
    return selected ? selected.value : "";
  }

  function friendlyOfferError(error) {
    var code = String((error && error.code) || "");
    var message = String((error && error.message) || "");
    if (/available or reserved/i.test(message)) {
      return "Offers are closed on this piece. Please enquire by email instead.";
    }
    if (code === "PGRST205" || code === "42P01" || /schema cache|does not exist|could not find the table/i.test(message)) {
      return "Offers are not open just now. Please enquire by email instead.";
    }
    if (code === "23514" || code === "22001") {
      return "Please check the name, email, amount, and message, then try again.";
    }
    return "We could not send that offer. Please try again, or enquire by email.";
  }

  async function submitOffer() {
    if (offerSending || !readingProduct || !publicClient) return;
    var name = document.getElementById("offer-name").value.trim();
    var email = document.getElementById("offer-email").value.trim();
    var phone = document.getElementById("offer-phone").value.trim();
    var amountText = document.getElementById("offer-amount").value;
    var message = document.getElementById("offer-message").value.trim();
    var consent = document.getElementById("offer-consent").checked;
    var honeypot = document.getElementById("offer-company").value.trim();
    var option = chosenOfferOption();
    var parsed = CurioShop.parsePrice(amountText);
    var amount = parsed == null ? null : Number(parsed);

    if (!name || name.length > 120) {
      setOfferStatus("Add your name.", "error");
      document.getElementById("offer-name").focus();
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
      setOfferStatus("Add an email address we can reply to.", "error");
      document.getElementById("offer-email").focus();
      return;
    }
    if (phone.length > 40) {
      setOfferStatus("That phone number is too long.", "error");
      document.getElementById("offer-phone").focus();
      return;
    }
    if (amount == null || amount <= 0) {
      setOfferStatus("Enter your offer in pounds, such as 30 or 30.00.", "error");
      document.getElementById("offer-amount").focus();
      return;
    }
    if (option !== "delivered" && option !== "item" && option !== "collection") {
      setOfferStatus("Choose how you would like the piece.", "error");
      return;
    }
    if (message.length > 2000) {
      setOfferStatus("The message needs to be 2,000 characters or fewer.", "error");
      document.getElementById("offer-message").focus();
      return;
    }
    if (!consent) {
      setOfferStatus("Tick the box to agree that we may contact you about this offer.", "error");
      document.getElementById("offer-consent").focus();
      return;
    }

    var wait = throttleMessage();
    if (wait) {
      setOfferStatus(wait, "error");
      return;
    }

    if (honeypot) {
      rememberOfferTime();
      showOfferThanks();
      return;
    }

    offerSending = true;
    var send = document.getElementById("offer-send");
    if (send) send.disabled = true;
    setOfferStatus("Sending your offer…");

    try {
      var result = await publicClient.from("offers").insert({
        product_id: readingProduct.id,
        product_title: String(readingProduct.title || "Untitled piece").trim().slice(0, 200),
        name: name,
        email: email,
        phone: phone || null,
        amount: amount,
        option: option,
        message: message || null,
        status: "new"
      });
      if (result.error) {
        setOfferStatus(friendlyOfferError(result.error), "error");
        return;
      }
      rememberOfferTime();
      showOfferThanks();
    } catch (error) {
      setOfferStatus("We could not send that offer. Please try again, or enquire by email.", "error");
    } finally {
      offerSending = false;
      if (send) send.disabled = false;
    }
  }

  function bindOfferForm() {
    var open = document.getElementById("piece-offer-open");
    var form = document.getElementById("piece-offer");
    var close = document.getElementById("offer-close");
    if (!open || !form || form.dataset.bound === "true") return;
    form.dataset.bound = "true";
    open.addEventListener("click", function () {
      form.hidden = false;
      open.hidden = true;
      setOfferStatus("");
      var name = document.getElementById("offer-name");
      if (name) name.focus();
    });
    if (close) {
      close.addEventListener("click", function () {
        form.hidden = true;
        if (readingProduct && (readingProduct.status === "available" || readingProduct.status === "reserved")) {
          open.hidden = false;
        }
      });
    }
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      submitOffer();
    });
  }

  async function loadEntry(slug) {
    showReadingShell();
    entry.hidden = true;
    missing.hidden = true;
    entryStatus.textContent = "Opening this piece…";
    backLink.href = listBackUrl();
    backLink.textContent = route.category ? "← " + route.category : "← Back to the shelf";

    if (slug.length > 80) {
      showMissing();
      return;
    }

    try {
      var result = await selectColumns(function (columns) {
        return publicClient
          .from("products")
          .select(columns)
          .eq("slug", slug)
          .in("status", CurioShop.PUBLIC_STATUSES)
          .maybeSingle();
      });

      if (result.error) throw result.error;
      if (!CurioShop.isPublicProduct(result.data) || result.data.slug !== slug) {
        showMissing();
        return;
      }
      renderEntry(result.data);
    } catch (error) {
      document.documentElement.classList.remove("shop-reading");
      if (browse) browse.hidden = false;
      entry.hidden = true;
      missing.hidden = true;
      entryStatus.textContent = "";
      showBrowseMessage("The shelf could not be reached. Please try again.", true);
    }
  }

  function init() {
    if (!browse || !window.CurioShop) return;
    syncFilters();
    setBrowseCopy();
    if (searchInput) searchInput.value = route.q;

    if (searchForm) {
      searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        window.location.href = CurioShop.shopUrl({
          category: route.unknownCategory ? "" : route.category,
          q: searchInput.value.trim(),
          hideSold: route.hideSold
        });
      });
    }

    bindOfferForm();

    if (!clientReady()) {
      if (route.item) {
        showReadingShell();
        entryStatus.textContent = "The shelf could not open. Please reload the page.";
      } else {
        showBrowseMessage("The shelf could not open. Please reload the page.", false);
      }
      return;
    }

    if (retryButton) {
      retryButton.addEventListener("click", function () {
        if (route.item) loadEntry(route.item);
        else loadList();
      });
    }

    if (route.item) loadEntry(route.item);
    else loadList();
  }

  init();
})();
