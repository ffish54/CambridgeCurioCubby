/* Notifications desk: customer offers and recorded sales.
   Visitors insert offers with the anon key. Only the admin session can read them. */

(function () {
  var deskEl = document.getElementById("notifications-desk");
  var listEl = document.getElementById("notifications-list");
  var messageEl = document.getElementById("notifications-message");
  var badgeEl = document.getElementById("notifications-badge");
  var tabEl = document.getElementById("tab-notifications");
  var totalsEl = document.getElementById("notifications-totals");
  var refreshButton = document.getElementById("notifications-refresh");
  var filterButtons = document.querySelectorAll("#notifications-desk [data-notice-filter]");
  var suggestEl = document.getElementById("sale-suggest");
  var suggestText = document.getElementById("sale-suggest-text");
  var saleDialog = document.getElementById("sale-dialog");
  var counterDialog = document.getElementById("counter-dialog");

  if (!deskEl || !listEl || !window.CurioShop) return;

  var offers = [];
  var sales = [];
  var productsById = {};
  var filter = "all";
  var loading = false;
  var pendingQuiet = null;
  var listened = false;
  var suggested = null;
  var saleContext = null;
  var counterOffer = null;
  var saleSaving = false;

  function whenAdminReady() {
    var app = document.getElementById("app");
    if (!app) return Promise.resolve(false);
    if (!app.classList.contains("is-hidden")) return Promise.resolve(true);
    return new Promise(function (resolve) {
      var observer = new MutationObserver(function () {
        if (!app.classList.contains("is-hidden")) {
          observer.disconnect();
          resolve(true);
        }
      });
      observer.observe(app, { attributes: true, attributeFilter: ["class"] });
    });
  }

  function setMessage(text, kind) {
    if (!messageEl) return;
    messageEl.textContent = text || "";
    messageEl.classList.toggle("is-error", kind === "error");
    messageEl.classList.toggle("is-ok", kind === "ok");
  }

  function setDialogMessage(id, text, kind) {
    var line = document.getElementById(id);
    if (!line) return;
    line.textContent = text || "";
    line.classList.toggle("is-error", kind === "error");
    line.classList.toggle("is-ok", kind === "ok");
  }

  function missingTable(error) {
    if (!error) return false;
    var code = String(error.code || "");
    var blob = String(error.message || "") + " " + String(error.details || "");
    if (code === "PGRST205" || code === "42P01") return true;
    return /schema cache|does not exist|could not find the table/i.test(blob);
  }

  function friendly(error) {
    if (!error) return "Something went wrong.";
    var code = String(error.code || "");
    var message = String(error.message || "Something went wrong.");
    if (missingTable(error)) {
      return "Offers and sales are not in Supabase yet. Run supabase/shop-notifications.sql in the SQL editor, then refresh.";
    }
    if (code === "23505") return "This offer already has a sale recorded.";
    if (code === "23514" || code === "23502") return "Check the amount, option, and contact details.";
    if (code === "42501" || /row-level security/i.test(message)) {
      return "Supabase refused that change. Sign in as the admin account.";
    }
    return message;
  }

  function priceInput(value) {
    if (value == null || value === "") return "";
    var number = Number(value);
    if (!Number.isFinite(number)) return "";
    return number.toFixed(2);
  }

  function nowLocalValue() {
    var date = new Date();
    var local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
  }

  function fromLocalValue(value) {
    if (!value) return null;
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toISOString();
  }

  function productFor(row) {
    if (!row || !row.product_id) return null;
    return productsById[row.product_id] || null;
  }

  function offerStatusLabel(status) {
    if (status === "new") return "New";
    if (status === "read") return "Read";
    if (status === "accepted") return "Accepted";
    if (status === "declined") return "Declined";
    if (status === "countered") return "Countered";
    if (status === "archived") return "Archived";
    return "";
  }

  function makePill(text, className) {
    var pill = document.createElement("span");
    pill.className = className;
    pill.textContent = text;
    return pill;
  }

  function makeMini(text, action) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "mini-button";
    button.dataset.offerAction = action;
    button.textContent = text;
    return button;
  }

  function shopHref(product) {
    if (!product || !product.slug || !CurioShop.isPublicProduct(product)) return "";
    return CurioShop.shopUrl({ item: product.slug });
  }

  function updateBadge() {
    var count = offers.filter(function (offer) { return offer.status === "new"; }).length;
    if (!badgeEl) return;
    if (!count) {
      badgeEl.hidden = true;
      badgeEl.textContent = "";
      if (tabEl) tabEl.setAttribute("aria-label", "Notifications");
      return;
    }
    badgeEl.hidden = false;
    badgeEl.textContent = String(count);
    if (tabEl) tabEl.setAttribute("aria-label", "Notifications, " + count + " unread");
  }

  function renderTotals() {
    if (!totalsEl) return;
    var count = 0;
    var pence = 0;
    var now = new Date();
    sales.forEach(function (sale) {
      if (!CurioShop.inLondonMonth(sale.sold_at || sale.created_at, now)) return;
      count += 1;
      var amount = Number(sale.amount);
      if (Number.isFinite(amount)) pence += Math.round(amount * 100);
    });
    if (!count) {
      totalsEl.textContent = "This month: no sales recorded.";
      return;
    }
    var label = count === 1 ? "1 sale" : count + " sales";
    totalsEl.textContent = "This month: " + label + ", " + CurioShop.formatPrice(pence / 100) + ".";
  }

  function emptyCopy() {
    if (filter === "unread") return "No unread offers.";
    if (filter === "offers") return "No offers yet. They appear here when someone uses Make an offer.";
    if (filter === "sales") return "No sales recorded.";
    return "No offers or sales yet.";
  }

  function syncFilters() {
    filterButtons.forEach(function (button) {
      var on = button.dataset.noticeFilter === filter;
      button.classList.toggle("is-active", on);
      button.setAttribute("aria-selected", on ? "true" : "false");
    });
  }

  function renderOfferCard(offer) {
    var product = productFor(offer);
    var title = (product && product.title) || offer.product_title || "Piece";
    var href = shopHref(product);
    var item = document.createElement("li");
    item.className = "post-card notice-card";
    item.dataset.offerId = offer.id;
    if (offer.status === "archived") item.classList.add("is-archived");

    var thumbUrl = product ? CurioShop.coverUrl(product) : "";
    if (thumbUrl) {
      item.classList.add("has-thumb");
      var thumb = href ? document.createElement("a") : document.createElement("div");
      thumb.className = "notice-thumb";
      if (href) {
        thumb.href = href;
        thumb.setAttribute("aria-label", title);
      }
      var image = document.createElement("img");
      image.src = thumbUrl;
      image.alt = "";
      image.decoding = "async";
      thumb.append(image);
      item.append(thumb);
    }

    var body = document.createElement("div");
    var meta = document.createElement("div");
    meta.className = "post-meta";
    meta.append(makePill("Offer", "pill"), makePill(offerStatusLabel(offer.status), "pill pill-" + (offer.status || "new")));
    var when = CurioShop.formatWhen(offer.created_at);
    if (when) {
      var time = document.createElement("time");
      time.dateTime = offer.created_at || "";
      time.textContent = when;
      meta.append(time);
    }
    body.append(meta);

    var heading = document.createElement("h3");
    if (href) {
      var titleLink = document.createElement("a");
      titleLink.href = href;
      titleLink.textContent = title;
      heading.append(titleLink);
    } else {
      heading.textContent = title;
    }
    body.append(heading);

    var asked = product ? CurioShop.askedAmount(product, offer.option) : null;
    var bits = [CurioShop.offerOptionLabel(offer.option) || "Offer"];
    bits.push("offer " + (CurioShop.formatPrice(offer.amount) || ""));
    if (asked != null) {
      bits.push("asked " + CurioShop.formatPrice(asked));
      var percent = CurioShop.offerPercent(offer.amount, asked);
      if (percent != null) bits.push(percent + "% of the asked price");
    }
    if (offer.status === "countered" && offer.counter_amount != null) {
      bits.push("counter " + CurioShop.formatPrice(offer.counter_amount));
    }
    var compare = document.createElement("p");
    compare.textContent = bits.filter(Boolean).join(" · ");
    body.append(compare);

    var contact = document.createElement("p");
    var mail = CurioShop.offerContactMailto(offer);
    if (mail) {
      var mailLink = document.createElement("a");
      mailLink.href = mail;
      mailLink.textContent = (offer.name || "Customer") + " · " + (offer.email || "");
      contact.append(mailLink);
    } else {
      contact.textContent = [offer.name, offer.email].filter(Boolean).join(" · ");
    }
    body.append(contact);

    if (offer.phone) {
      var phone = document.createElement("p");
      phone.textContent = offer.phone;
      body.append(phone);
    }
    if (offer.message) {
      var note = document.createElement("p");
      note.className = "notice-message";
      note.textContent = offer.message;
      body.append(note);
    }

    var actions = document.createElement("div");
    actions.className = "post-actions";
    if (offer.status === "new") actions.append(makeMini("Mark read", "read"));
    if (offer.status !== "accepted" && offer.status !== "archived") actions.append(makeMini("Accept", "accept"));
    if (offer.status !== "declined" && offer.status !== "accepted" && offer.status !== "archived") {
      actions.append(makeMini("Decline", "decline"));
    }
    if (offer.status !== "accepted" && offer.status !== "declined" && offer.status !== "archived") {
      actions.append(makeMini("Counter", "counter"));
    }
    if (offer.status !== "archived") actions.append(makeMini("Archive", "archive"));
    body.append(actions);
    item.append(body);
    return item;
  }

  function renderSale(sale) {
    var product = productFor(sale);
    var title = (product && product.title) || sale.product_title || "Piece";
    var item = document.createElement("li");
    item.className = "post-card notice-card is-sale";
    var body = document.createElement("div");
    var meta = document.createElement("div");
    meta.className = "post-meta";
    meta.append(makePill("Sale", "pill pill-accepted"));
    body.append(meta);

    var heading = document.createElement("h3");
    var href = shopHref(product);
    if (href) {
      var titleLink = document.createElement("a");
      titleLink.href = href;
      titleLink.textContent = title;
      heading.append(titleLink);
    } else {
      heading.textContent = title;
    }
    body.append(heading);

    var when = CurioShop.formatWhen(sale.sold_at || sale.created_at);
    var line = document.createElement("p");
    line.textContent = [
      CurioShop.formatPrice(sale.amount),
      CurioShop.channelLabel(sale.channel) || "Sale",
      CurioShop.offerOptionLabel(sale.option),
      when
    ].filter(Boolean).join(" · ");
    body.append(line);

    if (sale.buyer_name || sale.buyer_email) {
      var buyer = document.createElement("p");
      buyer.textContent = [sale.buyer_name, sale.buyer_email].filter(Boolean).join(" · ");
      body.append(buyer);
    }
    if (sale.notes) {
      var notes = document.createElement("p");
      notes.className = "notice-message";
      notes.textContent = sale.notes;
      body.append(notes);
    }
    if (sale.source === "stripe" || sale.source === "square" || sale.payment_ref) {
      var via = document.createElement("p");
      var sourceLabel = sale.source === "stripe" ? "Stripe" : sale.source === "square" ? "Square" : "";
      via.textContent = [sourceLabel, sale.payment_ref].filter(Boolean).join(" · ");
      body.append(via);
    }
    item.append(body);
    return item;
  }

  function render() {
    syncFilters();
    renderTotals();
    updateBadge();
    var rows = [];
    if (filter === "all" || filter === "offers" || filter === "unread") {
      offers.forEach(function (offer) {
        if (filter === "unread" && offer.status !== "new") return;
        rows.push({ kind: "offer", at: offer.created_at, row: offer });
      });
    }
    if (filter === "all" || filter === "sales") {
      sales.forEach(function (sale) {
        rows.push({ kind: "sale", at: sale.sold_at || sale.created_at, row: sale });
      });
    }
    rows.sort(function (a, b) {
      return (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0);
    });
    listEl.replaceChildren();
    if (!rows.length) {
      var empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = emptyCopy();
      listEl.append(empty);
      return;
    }
    rows.forEach(function (item) {
      listEl.append(item.kind === "sale" ? renderSale(item.row) : renderOfferCard(item.row));
    });
  }

  async function loadProducts(ids) {
    productsById = {};
    if (!ids.length) return;
    var columns = "id,slug,title,status,cover_image,images,price,price_delivered,price_item,price_collection";
    var result = await supabaseClient.from("products").select(columns).in("id", ids);
    if (result.error && CurioShop.missingPriceColumns(result.error)) {
      result = await supabaseClient.from("products").select("id,slug,title,status,cover_image,images,price").in("id", ids);
    }
    if (result.error) return;
    (result.data || []).forEach(function (product) {
      productsById[product.id] = product;
    });
  }

  async function load(options) {
    var settings = options || {};
    if (!settings.quiet) setMessage("Loading notifications…");
    try {
      var offersResult = await supabaseClient
        .from("offers")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      var salesResult = await supabaseClient
        .from("sales")
        .select("*")
        .order("sold_at", { ascending: false })
        .limit(200);
      if (offersResult.error || salesResult.error) {
        setMessage(friendly(offersResult.error || salesResult.error), "error");
        if (!settings.quiet) {
          offers = [];
          sales = [];
          render();
        }
        return;
      }
      offers = offersResult.data || [];
      sales = salesResult.data || [];
      var ids = [];
      offers.concat(sales).forEach(function (row) {
        if (row.product_id && ids.indexOf(row.product_id) === -1) ids.push(row.product_id);
      });
      await loadProducts(ids);
      if (!settings.quiet) setMessage("");
      render();
    } catch (error) {
      setMessage("Could not reach Supabase. Try again.", "error");
    }
  }

  function refresh(options) {
    var settings = options || {};
    if (loading) {
      if (pendingQuiet === null || !settings.quiet) pendingQuiet = Boolean(settings.quiet);
      return;
    }
    loading = true;
    load(settings).finally(function () {
      loading = false;
      if (pendingQuiet !== null) {
        var quiet = pendingQuiet;
        pendingQuiet = null;
        refresh({ quiet: quiet });
      }
    });
  }

  function listen() {
    if (listened || !supabaseClient || typeof supabaseClient.channel !== "function") return;
    listened = true;
    try {
      supabaseClient
        .channel("cabinet-notifications")
        .on("postgres_changes", { event: "*", schema: "public", table: "offers" }, function () {
          refresh({ quiet: true });
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "sales" }, function () {
          refresh({ quiet: true });
        })
        .subscribe();
    } catch (error) {
      listened = false;
    }
  }

  function openMailto(href) {
    if (!href) return;
    var link = document.createElement("a");
    link.href = href;
    document.body.append(link);
    link.click();
    link.remove();
  }

  function showDialog(dialog) {
    if (!dialog || typeof dialog.showModal !== "function") return;
    if (dialog.open) dialog.close();
    dialog.showModal();
  }

  function suggestSale(product) {
    if (!product || !suggestEl || !suggestText) return;
    suggested = product;
    suggestEl.hidden = false;
    suggestText.textContent = "“" + (product.title || "This piece") + "” is marked sold. Record the sale if you would like it in this month’s figures. Nothing is charged from this page.";
  }

  function openSale(settings) {
    var context = settings || {};
    if (!saleDialog) return;
    saleContext = context;
    var product = context.product || null;
    var offer = context.offer || null;
    var preferred = CurioShop.preferredSaleOption(product);
    var title = document.getElementById("sale-dialog-title");
    var intro = document.getElementById("sale-dialog-intro");
    var piece = document.getElementById("sale-piece-label");
    var statusFields = document.getElementById("sale-status-fields");
    var amount = document.getElementById("sale-amount");
    var option = document.getElementById("sale-option");
    var buyerName = document.getElementById("sale-buyer-name");
    var buyerEmail = document.getElementById("sale-buyer-email");
    var channel = document.getElementById("sale-channel");
    var soldAt = document.getElementById("sale-sold-at");
    var notes = document.getElementById("sale-notes");
    var save = document.getElementById("sale-save");
    if (title) title.textContent = offer ? "Accept this offer" : "Record this sale";
    if (intro) {
      intro.textContent = offer
        ? "This records the sale and updates the piece. Nothing is charged from this page."
        : "Recording the sale is optional. Nothing is charged from this page.";
    }
    if (piece) {
      piece.textContent = (product && product.title) || (offer && offer.product_title) || "";
    }
    if (amount) amount.value = priceInput(offer ? offer.amount : preferred.amount);
    if (option) option.value = (offer && offer.option) || preferred.key || "other";
    if (buyerName) buyerName.value = (offer && offer.name) || "";
    if (buyerEmail) buyerEmail.value = (offer && offer.email) || "";
    if (channel) channel.value = "website";
    if (soldAt) soldAt.value = nowLocalValue();
    if (notes) notes.value = offer ? "Accepted from an offer." : "";
    if (statusFields) statusFields.hidden = !(context.askStatus && product && product.id);
    var soldRadio = document.querySelector("#sale-status-fields input[value='sold']");
    if (soldRadio) soldRadio.checked = true;
    if (save) save.textContent = offer ? "Accept offer" : "Record sale";
    setDialogMessage("sale-dialog-message", "");
    showDialog(saleDialog);
    if (amount) amount.focus();
  }

  function openCounter(offer) {
    if (!counterDialog || !offer) return;
    counterOffer = offer;
    var intro = document.getElementById("counter-intro");
    var amount = document.getElementById("counter-amount");
    if (intro) {
      intro.textContent = (offer.name || "The customer") + " offered " + (CurioShop.formatPrice(offer.amount) || "an amount") + " for “" + (offer.product_title || "this piece") + "”.";
    }
    if (amount) amount.value = priceInput(offer.counter_amount || offer.amount);
    setDialogMessage("counter-message", "");
    showDialog(counterDialog);
    if (amount) amount.focus();
  }

  async function updateOffer(offer, payload, okText) {
    setMessage("Saving…");
    try {
      var result = await supabaseClient
        .from("offers")
        .update(Object.assign({ updated_at: new Date().toISOString() }, payload))
        .eq("id", offer.id);
      if (result.error) {
        setMessage(friendly(result.error), "error");
        return false;
      }
      await load({ quiet: true });
      setMessage(okText || "Offer updated.", "ok");
      return true;
    } catch (error) {
      setMessage("Could not reach Supabase. Try again.", "error");
      return false;
    }
  }

  function handleOffer(action, offer) {
    if (!offer || saleSaving) return;
    if (action === "read") {
      updateOffer(offer, { status: "read" }, "Marked as read.");
      return;
    }
    if (action === "decline") {
      var declineName = offer.name || "this customer";
      if (!window.confirm("Decline this offer from " + declineName + "? The piece is left as it is.")) return;
      updateOffer(offer, { status: "declined" }, "Offer declined.");
      return;
    }
    if (action === "archive") {
      var archiveName = offer.name || "this customer";
      if (!window.confirm("Archive this offer from " + archiveName + "?")) return;
      updateOffer(offer, { status: "archived" }, "Offer archived.");
      return;
    }
    if (action === "accept") {
      openSale({
        product: productFor(offer),
        offer: offer,
        source: "offer",
        askStatus: true
      });
      return;
    }
    if (action === "counter") openCounter(offer);
  }

  async function saveSale(event) {
    event.preventDefault();
    if (saleSaving || !saleContext) return;
    var amount = CurioShop.parsePrice(document.getElementById("sale-amount").value);
    var option = document.getElementById("sale-option").value;
    var buyerName = document.getElementById("sale-buyer-name").value.trim();
    var buyerEmail = document.getElementById("sale-buyer-email").value.trim();
    var channel = document.getElementById("sale-channel").value;
    var soldAt = fromLocalValue(document.getElementById("sale-sold-at").value);
    var notes = document.getElementById("sale-notes").value.trim();
    var product = saleContext.product || null;
    var offer = saleContext.offer || null;
    var allowedOptions = ["delivered", "item", "collection", "other"];
    var allowedChannels = CurioShop.SALE_CHANNELS.map(function (item) { return item.key; });

    if (amount == null) {
      setDialogMessage("sale-dialog-message", "Enter the sale price in pounds, such as 45 or 45.00.", "error");
      document.getElementById("sale-amount").focus();
      return;
    }
    if (allowedOptions.indexOf(option) === -1) {
      setDialogMessage("sale-dialog-message", "Choose an option.", "error");
      return;
    }
    if (allowedChannels.indexOf(channel) === -1) {
      setDialogMessage("sale-dialog-message", "Choose where the sale came from.", "error");
      return;
    }
    if (buyerName.length > 120) {
      setDialogMessage("sale-dialog-message", "The buyer name needs to be 120 characters or fewer.", "error");
      return;
    }
    if (buyerEmail && (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(buyerEmail) || buyerEmail.length > 200)) {
      setDialogMessage("sale-dialog-message", "That buyer email does not look right.", "error");
      document.getElementById("sale-buyer-email").focus();
      return;
    }
    if (!soldAt) {
      setDialogMessage("sale-dialog-message", "Choose the date of the sale.", "error");
      return;
    }
    if (notes.length > 2000) {
      setDialogMessage("sale-dialog-message", "Notes need to be 2,000 characters or fewer.", "error");
      return;
    }

    var title = (product && product.title) || (offer && offer.product_title) || "Piece";
    var payload = {
      product_id: (product && product.id) || (offer && offer.product_id) || null,
      product_title: String(title).trim().slice(0, 200),
      amount: amount,
      option: option,
      buyer_name: buyerName || null,
      buyer_email: buyerEmail || null,
      channel: channel,
      notes: notes || null,
      sold_at: soldAt,
      source: saleContext.source || "admin",
      offer_id: offer ? offer.id : null
    };

    saleSaving = true;
    var saveButton = document.getElementById("sale-save");
    if (saveButton) saveButton.disabled = true;
    setDialogMessage("sale-dialog-message", "Saving…");

    try {
      var inserted = await supabaseClient.from("sales").insert(payload);
      if (inserted.error) {
        setDialogMessage("sale-dialog-message", friendly(inserted.error), "error");
        return;
      }

      var warnings = [];
      var statusFields = document.getElementById("sale-status-fields");
      if (saleContext.askStatus && product && product.id && statusFields && !statusFields.hidden) {
        var selected = document.querySelector("#sale-status-fields input[name='sale-next-status']:checked");
        var nextStatus = selected && selected.value === "reserved" ? "reserved" : "sold";
        var updated = await supabaseClient
          .from("products")
          .update({ status: nextStatus, updated_at: new Date().toISOString() })
          .eq("id", product.id);
        if (updated.error) warnings.push("The sale is recorded, but the piece status did not change.");
        else window.dispatchEvent(new CustomEvent("curio-products-changed"));
      }
      if (offer) {
        var marked = await supabaseClient
          .from("offers")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("id", offer.id);
        if (marked.error) warnings.push("The sale is recorded, but the offer could not be marked accepted.");
      }

      if (saleDialog.open) saleDialog.close();
      await load({ quiet: true });
      setMessage(warnings.length ? warnings.join(" ") : "Sale recorded.", warnings.length ? "error" : "ok");
    } catch (error) {
      setDialogMessage("sale-dialog-message", "Could not reach Supabase. Try again.", "error");
    } finally {
      saleSaving = false;
      if (saveButton) saveButton.disabled = false;
    }
  }

  async function saveCounter(event) {
    event.preventDefault();
    if (saleSaving || !counterOffer) return;
    var parsed = CurioShop.parsePrice(document.getElementById("counter-amount").value);
    var amount = parsed == null ? null : Number(parsed);
    if (amount == null || amount <= 0) {
      setDialogMessage("counter-message", "Enter the counter amount in pounds, such as 40 or 40.00.", "error");
      document.getElementById("counter-amount").focus();
      return;
    }
    var offer = counterOffer;
    var href = CurioShop.counterMailto(offer, amount);
    saleSaving = true;
    var button = document.getElementById("counter-send");
    if (button) button.disabled = true;
    setDialogMessage("counter-message", "Saving…");
    try {
      var result = await supabaseClient
        .from("offers")
        .update({
          status: "countered",
          counter_amount: amount,
          updated_at: new Date().toISOString()
        })
        .eq("id", offer.id);
      if (result.error) {
        setDialogMessage("counter-message", friendly(result.error), "error");
        return;
      }
      if (counterDialog.open) counterDialog.close();
      openMailto(href);
      await load({ quiet: true });
      setMessage("Offer marked as countered.", "ok");
    } catch (error) {
      setDialogMessage("counter-message", "Could not reach Supabase. Try again.", "error");
    } finally {
      saleSaving = false;
      if (button) button.disabled = false;
    }
  }

  function bind() {
    if (refreshButton) {
      refreshButton.addEventListener("click", function () { refresh(); });
    }
    filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        filter = button.dataset.noticeFilter || "all";
        render();
      });
    });
    listEl.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-offer-action]");
      if (!button) return;
      var card = button.closest("[data-offer-id]");
      if (!card) return;
      var offer = offers.find(function (item) { return item.id === card.dataset.offerId; });
      if (offer) handleOffer(button.dataset.offerAction, offer);
    });
    var suggestRecord = document.getElementById("sale-suggest-record");
    var suggestDismiss = document.getElementById("sale-suggest-dismiss");
    if (suggestRecord) {
      suggestRecord.addEventListener("click", function () {
        if (!suggested) return;
        var product = suggested;
        if (suggestEl) suggestEl.hidden = true;
        openSale({ product: product, source: "admin" });
      });
    }
    if (suggestDismiss && suggestEl) {
      suggestDismiss.addEventListener("click", function () {
        suggestEl.hidden = true;
      });
    }
    var saleForm = document.getElementById("sale-form");
    if (saleForm) saleForm.addEventListener("submit", saveSale);
    var dismiss = document.getElementById("sale-dismiss");
    if (dismiss && saleDialog) {
      dismiss.addEventListener("click", function () {
        if (saleDialog.open) saleDialog.close();
      });
    }
    var counterForm = document.getElementById("counter-form");
    if (counterForm) counterForm.addEventListener("submit", saveCounter);
    var counterCancel = document.getElementById("counter-cancel");
    if (counterCancel && counterDialog) {
      counterCancel.addEventListener("click", function () {
        if (counterDialog.open) counterDialog.close();
      });
    }
    window.addEventListener("focus", function () { refresh({ quiet: true }); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh({ quiet: true });
    });
    window.setInterval(function () {
      if (!document.hidden) refresh({ quiet: true });
    }, 60000);
  }

  window.curioRefreshNotifications = function () {
    refresh({ quiet: true });
  };
  window.curioSuggestSale = suggestSale;
  window.curioPromptSale = openSale;

  bind();
  whenAdminReady().then(function (ready) {
    if (!ready) return;
    listen();
    refresh();
  }).catch(function () {
    setMessage("Notifications could not open. Reload the page.", "error");
  });
})();
