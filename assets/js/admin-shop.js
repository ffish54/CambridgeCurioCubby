/* Shop desk on the same cabinet login as the journal.
   Photographs go to the product-images bucket. Policies, not this page, decide who can write. */

(function () {
  var BUCKET = "product-images";
  var shopDesk = document.getElementById("shop-desk");
  var journalDesk = document.getElementById("journal-desk");
  var tabJournal = document.getElementById("tab-journal");
  var tabShop = document.getElementById("tab-shop");
  var subtitle = document.getElementById("desk-subtitle");
  var signOutButton = document.getElementById("sign-out");

  var newButton = document.getElementById("new-product");
  var productList = document.getElementById("product-list");
  var listMessage = document.getElementById("product-list-message");
  var filterButtons = document.querySelectorAll("#shop-desk .filter");
  var editorPanel = document.getElementById("product-editor-panel");
  var editorHeading = document.getElementById("product-editor-heading");
  var form = document.getElementById("product-form");
  var titleInput = document.getElementById("product-title");
  var slugInput = document.getElementById("product-slug");
  var slugFromTitle = document.getElementById("product-slug-from-title");
  var categoryInput = document.getElementById("product-category");
  var priceInput = document.getElementById("product-price");
  var conditionInput = document.getElementById("product-condition");
  var eraInput = document.getElementById("product-era");
  var makerInput = document.getElementById("product-maker");
  var dimensionsInput = document.getElementById("product-dimensions");
  var descriptionInput = document.getElementById("product-description");
  var sortInput = document.getElementById("product-sort");
  var featuredInput = document.getElementById("product-featured");
  var statusInput = document.getElementById("product-status");
  var fileInput = document.getElementById("product-files");
  var uploadButton = document.getElementById("upload-images");
  var clearFilesButton = document.getElementById("clear-product-files");
  var imageMessage = document.getElementById("image-message");
  var imageList = document.getElementById("image-list");
  var saveButton = document.getElementById("save-product");
  var deleteButton = document.getElementById("delete-product");
  var formMessage = document.getElementById("product-form-message");
  var viewLink = document.getElementById("product-view");

  if (!shopDesk || !window.CurioShop) return;

  var products = [];
  var activeFilter = "all";
  var editingId = null;
  var slugTouched = false;
  var savedState = "";
  var busy = false;
  var images = [];
  var cover = "";
  var desk = "journal";

  function isAdmin(user) {
    if (!user || !user.id) return false;
    return String(user.id).toLowerCase() === String(ADMIN_USER_ID).toLowerCase();
  }

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

  function showDesk(next, options) {
    var settings = options || {};
    if (busy) return;
    if (!settings.force && next !== desk) {
      var warning = "";
      if (next === "shop" && window.curioJournalIsDirty && window.curioJournalIsDirty()) {
        warning = "The journal desk has unsaved edits. Switch to the shop? Those edits stay until you leave this page.";
      }
      if (next === "journal" && isDirty()) {
        warning = "The shop desk has unsaved edits. Switch to the journal? Those edits stay until you leave this page.";
      }
      if (warning && !window.confirm(warning)) return;
    }

    desk = next === "shop" ? "shop" : "journal";
    var shopOpen = desk === "shop";
    journalDesk.classList.toggle("is-hidden", shopOpen);
    journalDesk.hidden = shopOpen;
    shopDesk.classList.toggle("is-hidden", !shopOpen);
    shopDesk.hidden = !shopOpen;
    tabJournal.classList.toggle("is-active", !shopOpen);
    tabShop.classList.toggle("is-active", shopOpen);
    tabJournal.setAttribute("aria-selected", shopOpen ? "false" : "true");
    tabShop.setAttribute("aria-selected", shopOpen ? "true" : "false");
    if (subtitle) subtitle.textContent = shopOpen ? "Shop desk" : "Journal desk";
    if (shopOpen && !settings.silent) {
      editorHeading.focus();
    }
    if (shopOpen && window.location.hash !== "#shop") {
      history.replaceState(null, "", "admin.html#shop");
    }
    if (!shopOpen && window.location.hash === "#shop") {
      history.replaceState(null, "", "admin.html");
    }
  }

  async function init() {
    bindEvents();
    var ready = await whenAdminReady();
    if (!ready) return;
    if (window.location.hash === "#shop") showDesk("shop", { force: true, silent: true });
    openNew({ force: true, silent: true });
    await loadProducts();
  }

  function bindEvents() {
    tabJournal.addEventListener("click", function () { showDesk("journal"); });
    tabShop.addEventListener("click", function () { showDesk("shop"); });
    newButton.addEventListener("click", function () {
      openNew();
      focusEditor();
    });
    slugFromTitle.addEventListener("click", function () {
      slugTouched = false;
      slugInput.value = CurioShop.slugify(titleInput.value);
      slugInput.focus();
    });
    titleInput.addEventListener("input", function () {
      if (slugTouched) return;
      slugInput.value = CurioShop.slugify(titleInput.value);
    });
    slugInput.addEventListener("input", function () {
      slugTouched = slugInput.value.trim() !== CurioShop.slugify(titleInput.value);
    });
    fileInput.addEventListener("change", function () {
      var files = selectedFiles();
      if (!files.length) {
        setImageMessage("");
        return;
      }
      var checked = files.map(CurioShop.validateImageFile);
      var bad = checked.filter(function (item) { return !item.ok; })[0];
      if (bad) {
        setImageMessage(bad.message, "error");
        return;
      }
      setImageMessage(files.length + (files.length === 1 ? " photograph is ready. " : " photographs are ready. ") + "Choose Upload to store them.");
    });
    uploadButton.addEventListener("click", function () { uploadImages(); });
    clearFilesButton.addEventListener("click", function () {
      fileInput.value = "";
      setImageMessage("");
    });
    imageList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-image-action]");
      if (!button || busy) return;
      var index = Number(button.dataset.index);
      if (!Number.isInteger(index)) return;
      var action = button.dataset.imageAction;
      if (action === "earlier") moveImage(index, -1);
      else if (action === "later") moveImage(index, 1);
      else if (action === "cover") setCover(index);
      else if (action === "remove") removeImage(index);
    });
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      saveProduct(statusInput.value);
    });
    saveButton.addEventListener("click", function () { saveProduct(statusInput.value); });
    deleteButton.addEventListener("click", function () {
      var product = currentProduct();
      if (product) deleteProduct(product);
    });
    productList.addEventListener("click", function (event) {
      var button = event.target.closest("button[data-action]");
      if (!button) return;
      var card = button.closest("[data-id]");
      if (!card) return;
      var product = products.find(function (item) { return item.id === card.dataset.id; });
      if (!product) return;
      handleListAction(button.dataset.action, product);
    });
    productList.addEventListener("change", function (event) {
      var select = event.target.closest("select[data-action='status']");
      if (!select) return;
      var card = select.closest("[data-id]");
      if (!card) return;
      var product = products.find(function (item) { return item.id === card.dataset.id; });
      if (!product) return;
      setStatus(product, select.value);
    });
    filterButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        activeFilter = button.dataset.productFilter;
        renderList();
      });
    });
    window.addEventListener("beforeunload", function (event) {
      if (!isDirty()) return;
      event.preventDefault();
      event.returnValue = "";
    });
  }

  async function loadProducts(options) {
    var settings = options || {};
    if (!settings.quiet) setListMessage("Loading pieces…");

    try {
      var result = await supabaseClient
        .from("products")
        .select("*")
        .order("updated_at", { ascending: false });

      if (result.error) {
        products = [];
        renderList();
        setListMessage(friendlyError(result.error), "error");
        return false;
      }

      products = result.data || [];
      renderList();
      if (!settings.quiet) setListMessage("");
      return true;
    } catch (error) {
      products = [];
      renderList();
      setListMessage("Could not reach Supabase. Try again.", "error");
      return false;
    }
  }

  function renderList() {
    var counts = {
      all: products.length,
      available: products.filter(function (item) { return item.status === "available"; }).length,
      reserved: products.filter(function (item) { return item.status === "reserved"; }).length,
      sold: products.filter(function (item) { return item.status === "sold"; }).length,
      draft: products.filter(function (item) { return item.status === "draft"; }).length
    };

    filterButtons.forEach(function (button) {
      var filter = button.dataset.productFilter;
      var labels = {
        all: "All",
        available: "Available",
        reserved: "Reserved",
        sold: "Sold",
        draft: "Drafts"
      };
      button.textContent = (labels[filter] || filter) + " (" + (counts[filter] || 0) + ")";
      var selected = filter === activeFilter;
      button.classList.toggle("is-active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
    });

    var visible = products.filter(function (item) {
      if (activeFilter === "all") return true;
      return item.status === activeFilter;
    });

    productList.replaceChildren();
    if (!visible.length) {
      var empty = document.createElement("li");
      empty.className = "empty-state";
      if (activeFilter === "all") empty.textContent = "No pieces yet.";
      else empty.textContent = "Nothing under " + (CurioShop.statusLabel(activeFilter) || activeFilter) + ".";
      productList.append(empty);
      return;
    }

    visible.forEach(function (product) {
      productList.append(renderCard(product));
    });
    if (busy) setBusy(true);
  }

  function renderCard(product) {
    var item = document.createElement("li");
    item.className = "post-card";
    item.dataset.id = product.id;
    if (product.id === editingId) item.classList.add("is-active");

    var meta = document.createElement("div");
    meta.className = "post-meta";
    meta.append(makePill(
      CurioShop.statusLabel(product.status) || "Draft",
      "pill pill-" + (product.status || "draft")
    ));
    if (product.featured) meta.append(makePill("Featured", "pill pill-featured"));
    item.append(meta);

    var heading = document.createElement("h3");
    heading.textContent = product.title || "Untitled";
    item.append(heading);

    var details = document.createElement("p");
    var bits = [product.category || "Uncategorised"];
    var price = CurioShop.formatPrice(product.price);
    if (price) bits.push(price);
    var when = formatWhen(product.updated_at || product.created_at);
    if (when) bits.push("Updated " + when);
    details.textContent = bits.join(" · ");
    item.append(details);

    var actions = document.createElement("div");
    actions.className = "post-actions";

    var statusLabel = document.createElement("label");
    statusLabel.className = "mini-status";
    var statusName = document.createElement("span");
    statusName.className = "visually-hidden";
    statusName.textContent = "Status for " + (product.title || "this piece");
    var select = document.createElement("select");
    select.className = "status-select";
    select.dataset.action = "status";
    ["available", "reserved", "sold", "draft"].forEach(function (status) {
      var option = document.createElement("option");
      option.value = status;
      option.textContent = CurioShop.statusLabel(status);
      select.append(option);
    });
    select.value = ["available", "reserved", "sold", "draft"].indexOf(product.status) === -1
      ? "draft"
      : product.status;
    statusLabel.append(statusName, select);

    actions.append(makeMini("Edit", "edit"), statusLabel, makeMini("Delete", "delete", "mini-button mini-danger"));
    if (product.status !== "draft" && product.slug) {
      var view = document.createElement("a");
      view.className = "mini-link";
      view.href = CurioShop.shopUrl({ item: product.slug });
      view.textContent = "View";
      actions.append(view);
    }
    item.append(actions);
    return item;
  }

  function makePill(text, className) {
    var pill = document.createElement("span");
    pill.className = className;
    pill.textContent = text;
    return pill;
  }

  function makeMini(text, action, className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "mini-button";
    button.dataset.action = action;
    button.textContent = text;
    return button;
  }

  async function handleListAction(action, product) {
    if (busy) return;
    if (action === "edit") {
      if (product.id === editingId) {
        titleInput.focus();
        focusEditor();
        return;
      }
      if (!confirmDiscard()) return;
      fillForm(product, { focus: true });
      return;
    }
    if (isDirty()) {
      if (!window.confirm("You have unsaved edits in the form. Continue and discard them?")) return;
      discardFormEdits();
    }
    if (action === "delete") await deleteProduct(product);
  }

  function openNew(options) {
    var settings = options || {};
    if (!settings.force && !confirmDiscard()) return;
    editingId = null;
    form.reset();
    slugTouched = false;
    slugInput.value = "";
    categoryInput.value = CurioShop.CATEGORIES[0];
    featuredInput.checked = false;
    statusInput.value = "draft";
    sortInput.value = "0";
    images = [];
    cover = "";
    fileInput.value = "";
    editorHeading.textContent = "New piece";
    deleteButton.hidden = true;
    viewLink.hidden = true;
    viewLink.removeAttribute("href");
    setImageMessage("");
    setFormMessage("");
    renderImages();
    snapshotForm();
    renderList();
    if (!settings.silent) titleInput.focus();
  }

  function fillForm(product, options) {
    var settings = options || {};
    editingId = product.id;
    titleInput.value = product.title || "";
    slugInput.value = product.slug || "";
    slugTouched = true;
    if (CurioShop.CATEGORIES.indexOf(product.category) !== -1) categoryInput.value = product.category;
    priceInput.value = product.price == null ? "" : String(product.price);
    conditionInput.value = product.condition || "";
    eraInput.value = product.era || "";
    makerInput.value = product.maker || "";
    dimensionsInput.value = product.dimensions || "";
    descriptionInput.value = product.description || "";
    sortInput.value = product.sort_order == null ? "0" : String(product.sort_order);
    featuredInput.checked = Boolean(product.featured);
    statusInput.value = ["available", "reserved", "sold", "draft"].indexOf(product.status) === -1
      ? "draft"
      : product.status;
    images = CurioShop.imageList(product);
    cover = CurioShop.coverUrl(product);
    fileInput.value = "";
    editorHeading.textContent = "Edit piece";
    deleteButton.hidden = false;
    if (product.status !== "draft" && product.slug) {
      viewLink.hidden = false;
      viewLink.href = CurioShop.shopUrl({ item: product.slug });
    } else {
      viewLink.hidden = true;
      viewLink.removeAttribute("href");
    }
    setImageMessage("");
    setFormMessage("");
    renderImages();
    snapshotForm();
    renderList();
    if (settings.focus) {
      titleInput.focus();
      focusEditor();
    }
  }

  function discardFormEdits() {
    var product = currentProduct();
    if (product) fillForm(product);
    else openNew({ force: true, silent: true });
  }

  function renderImages() {
    imageList.replaceChildren();
    if (!images.length) {
      var empty = document.createElement("li");
      empty.className = "empty-state";
      empty.textContent = "No photographs yet. A piece can be saved without them.";
      imageList.append(empty);
      return;
    }

    images.forEach(function (url, index) {
      var item = document.createElement("li");
      item.className = "image-row";
      if (url === cover) item.classList.add("is-cover");

      var preview = document.createElement("img");
      preview.src = url;
      preview.alt = titleInput.value.trim()
        ? titleInput.value.trim() + ", photograph " + (index + 1)
        : "Photograph " + (index + 1);
      item.append(preview);

      var body = document.createElement("div");
      if (url === cover) {
        var badge = document.createElement("span");
        badge.className = "pill pill-featured";
        badge.textContent = "Cover";
        body.append(badge);
      }

      var actions = document.createElement("div");
      actions.className = "post-actions";
      actions.append(
        makeImageButton("Earlier", "earlier", index, index === 0),
        makeImageButton("Later", "later", index, index === images.length - 1),
        makeImageButton(url === cover ? "Cover" : "Set as cover", "cover", index, url === cover),
        makeImageButton("Remove", "remove", index, false, "mini-button mini-danger")
      );
      body.append(actions);
      item.append(body);
      imageList.append(item);
    });
  }

  function makeImageButton(text, action, index, disabled, className) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = className || "mini-button";
    button.dataset.imageAction = action;
    button.dataset.index = String(index);
    button.textContent = text;
    button.disabled = Boolean(disabled);
    return button;
  }

  function moveImage(index, direction) {
    var next = index + direction;
    if (next < 0 || next >= images.length) return;
    var copy = images.slice();
    var held = copy[index];
    copy[index] = copy[next];
    copy[next] = held;
    images = copy;
    renderImages();
  }

  function setCover(index) {
    cover = images[index] || "";
    renderImages();
  }

  function removeImage(index) {
    var removed = images[index];
    images = images.filter(function (url, imageIndex) { return imageIndex !== index; });
    if (cover === removed) cover = images[0] || "";
    renderImages();
  }

  function selectedFiles() {
    return fileInput.files ? Array.prototype.slice.call(fileInput.files) : [];
  }

  function keepStored(stored) {
    if (!stored || !stored.length) return;
    images = images.concat(stored);
    if (!cover) cover = images[0] || "";
    renderImages();
    fileInput.value = "";
  }

  async function uploadImages() {
    if (busy) return;
    var files = selectedFiles();
    if (!files.length) {
      setImageMessage("Choose one or more photographs, then choose Upload.", "error");
      fileInput.focus();
      return;
    }
    if (images.length + files.length > CurioShop.MAX_IMAGES) {
      setImageMessage("A piece can hold up to " + CurioShop.MAX_IMAGES + " photographs. Remove one before adding more.", "error");
      return;
    }

    var checked = files.map(CurioShop.validateImageFile);
    var bad = checked.filter(function (item) { return !item.ok; })[0];
    if (bad) {
      setImageMessage(bad.message, "error");
      fileInput.focus();
      return;
    }

    busy = true;
    setBusy(true);
    var stored = [];

    try {
      var auth = await adminSession();
      if (!auth.ok) {
        setImageMessage(auth.message, "error");
        return;
      }
      if (!supabaseClient.storage || typeof supabaseClient.storage.from !== "function") {
        setImageMessage("Supabase Storage did not load. Reload the page.", "error");
        return;
      }

      for (var i = 0; i < files.length; i += 1) {
        setImageMessage("Uploading " + (i + 1) + " of " + files.length + "…");
        var path = objectPath(checked[i].ext);
        var uploaded = await supabaseClient.storage.from(BUCKET).upload(path, files[i], {
          contentType: checked[i].type,
          cacheControl: "31536000",
          upsert: false
        });
        if (uploaded.error) {
          keepStored(stored);
          var stopped = friendlyStorageError(uploaded.error);
          if (stored.length) {
            stopped += " " + stored.length + " photograph" + (stored.length === 1 ? " was" : "s were") + " stored before this stopped. Save the piece to keep them.";
          }
          setImageMessage(stopped, "error");
          return;
        }

        var published = supabaseClient.storage.from(BUCKET).getPublicUrl(path);
        var publicUrl = published && published.data && published.data.publicUrl;
        if (!publicUrl) {
          keepStored(stored);
          setImageMessage("A file uploaded, but no public address came back. Make the product-images bucket public, then try again.", "error");
          return;
        }
        stored.push(publicUrl);
      }

      images = images.concat(stored);
      if (!cover) cover = images[0] || "";
      fileInput.value = "";
      renderImages();
      setImageMessage("Photographs uploaded. Save the piece to keep them on the shelf.", "ok");
    } catch (error) {
      keepStored(stored);
      setImageMessage("Could not reach Supabase Storage. Try again.", "error");
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function adminSession() {
    try {
      var userResult = await supabaseClient.auth.getUser();
      if (userResult.error || !userResult.data || !userResult.data.user) {
        var detail = String((userResult.error && userResult.error.message) || "");
        if (/fetch|network|failed to fetch/i.test(detail)) {
          return { ok: false, message: "Could not confirm the admin session. Try again." };
        }
        return { ok: false, message: "Sign in as the admin before uploading a photograph." };
      }
      if (!isAdmin(userResult.data.user)) {
        return { ok: false, message: "This signed-in account cannot upload photographs." };
      }
      var sessionResult = await supabaseClient.auth.getSession();
      var session = sessionResult && sessionResult.data && sessionResult.data.session;
      if (!session || !session.access_token || !isAdmin(session.user)) {
        return { ok: false, message: "Sign in as the admin before uploading a photograph." };
      }
      return { ok: true, session: session };
    } catch (error) {
      return { ok: false, message: "Could not confirm the admin session. Try again." };
    }
  }

  function objectPath(ext) {
    var id;
    if (window.crypto && typeof crypto.randomUUID === "function") id = crypto.randomUUID();
    else id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
    return "products/" + id + "." + ext;
  }

  async function saveProduct(nextStatus) {
    if (busy) return;
    var status = ["available", "reserved", "sold", "draft"].indexOf(nextStatus) === -1 ? "draft" : nextStatus;
    var existing = currentProduct();
    var willHide = status === "draft" && existing && existing.status !== "draft";
    if (willHide) {
      var title = existing.title || "this piece";
      if (!window.confirm("Hide \"" + title + "\" as a draft? Visitors will no longer see it.")) return;
    }

    var payload = collectPayload(status);
    if (!payload) return;

    busy = true;
    setBusy(true);
    setFormMessage("Saving…");

    try {
      var query = existing
        ? supabaseClient.from("products").update(payload).eq("id", existing.id)
        : supabaseClient.from("products").insert(payload);
      var result = await query.select("*").single();
      if (result.error) {
        setFormMessage(friendlyError(result.error), "error");
        return;
      }

      editingId = result.data.id;
      var loaded = await loadProducts({ quiet: true });
      var saved = products.find(function (item) { return item.id === result.data.id; }) || result.data;
      fillForm(saved);
      if (loaded && !products.some(function (item) { return item.id === result.data.id; })) {
        setFormMessage("Saved, but the list could not show it. Check that this account is allowed to read every product.", "error");
        return;
      }
      if (willHide) setFormMessage("Saved as a draft. It is off the public shelf.", "ok");
      else if (status === "draft") setFormMessage("Draft saved.", "ok");
      else setFormMessage("Saved. This piece is on the public shelf as " + CurioShop.statusLabel(status).toLowerCase() + ".", "ok");
    } catch (error) {
      setFormMessage("Could not reach Supabase. Try again.", "error");
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function collectPayload(status) {
    var title = titleInput.value.trim();
    var slug = CurioShop.slugify(slugInput.value.trim() || title);
    var category = categoryInput.value;
    var price = CurioShop.parsePrice(priceInput.value);
    var sortOrder = CurioShop.parseSortOrder(sortInput.value);

    if (selectedFiles().length) {
      setFormMessage("The photographs from this device are not uploaded yet. Choose Upload, or clear the files.", "error");
      uploadButton.focus();
      return null;
    }
    if (!title) {
      setFormMessage("Add a title before saving.", "error");
      titleInput.focus();
      return null;
    }
    if (!slug) {
      setFormMessage("Add a slug made of letters and numbers. Match title can fill it in.", "error");
      slugInput.focus();
      return null;
    }
    slugInput.value = slug;
    if (CurioShop.CATEGORIES.indexOf(category) === -1) {
      setFormMessage("Choose one of the six shelves.", "error");
      categoryInput.focus();
      return null;
    }
    if (price == null) {
      setFormMessage("Add a price in pounds, such as 45 or 45.00.", "error");
      priceInput.focus();
      return null;
    }
    if (sortOrder == null) {
      setFormMessage("Shelf order needs to be a whole number, or left blank.", "error");
      sortInput.focus();
      return null;
    }
    if (products.some(function (item) {
      return String(item.slug || "").toLowerCase() === slug && item.id !== editingId;
    })) {
      setFormMessage("Another piece already uses that slug. Choose a different one.", "error");
      slugInput.focus();
      return null;
    }

    var cleanImages = [];
    images.forEach(function (url) {
      var safe = CurioShop.safeImageUrl(url);
      if (safe && cleanImages.indexOf(safe) === -1) cleanImages.push(safe);
    });
    if (cleanImages.length > CurioShop.MAX_IMAGES) {
      setFormMessage("A piece can hold up to " + CurioShop.MAX_IMAGES + " photographs.", "error");
      return null;
    }
    var cleanCover = CurioShop.safeImageUrl(cover);
    if (cleanCover && cleanImages.indexOf(cleanCover) === -1) cleanCover = cleanImages[0] || "";
    if (!cleanCover) cleanCover = cleanImages[0] || "";

    return {
      title: title,
      slug: slug,
      category: category,
      price: price,
      condition: blankToNull(conditionInput.value),
      era: blankToNull(eraInput.value),
      maker: blankToNull(makerInput.value),
      dimensions: blankToNull(dimensionsInput.value),
      description: blankToNull(descriptionInput.value),
      status: status,
      featured: featuredInput.checked,
      sort_order: sortOrder,
      images: cleanImages,
      cover_image: cleanCover || null,
      updated_at: new Date().toISOString()
    };
  }

  function blankToNull(value) {
    var text = String(value || "").trim();
    return text ? text : null;
  }

  async function setStatus(product, status) {
    if (busy) return;
    if (["available", "reserved", "sold", "draft"].indexOf(status) === -1) return;
    if (status === product.status) return;
    if (status === "draft" && product.status !== "draft") {
      if (!window.confirm("Hide \"" + (product.title || "this piece") + "\" as a draft? Visitors will no longer see it.")) {
        renderList();
        return;
      }
    }
    if (isDirty()) {
      if (!window.confirm("You have unsaved edits in the form. Continue and discard them?")) {
        renderList();
        return;
      }
      discardFormEdits();
    }

    busy = true;
    setBusy(true);
    setListMessage("Updating status…");

    try {
      var result = await supabaseClient
        .from("products")
        .update({
          status: status,
          updated_at: new Date().toISOString()
        })
        .eq("id", product.id)
        .select("*")
        .single();

      if (result.error) {
        setListMessage(friendlyError(result.error), "error");
        renderList();
        return;
      }

      await loadProducts({ quiet: true });
      if (editingId === product.id) {
        fillForm(products.find(function (item) { return item.id === product.id; }) || result.data);
      }
      setListMessage("Status set to " + CurioShop.statusLabel(status).toLowerCase() + ".", "ok");
    } catch (error) {
      setListMessage("Could not reach Supabase. Try again.", "error");
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  async function deleteProduct(product) {
    if (busy || !product) return;
    var title = product.title || "this piece";
    if (!window.confirm("Delete \"" + title + "\"? This cannot be undone.")) return;

    busy = true;
    setBusy(true);
    setListMessage("Deleting…");

    try {
      var result = await supabaseClient.from("products").delete().eq("id", product.id);
      if (result.error) {
        setListMessage(friendlyError(result.error), "error");
        return;
      }
      if (editingId === product.id) openNew({ force: true, silent: true });
      await loadProducts({ quiet: true });
      setListMessage("Piece deleted.", "ok");
    } catch (error) {
      setListMessage("Could not reach Supabase. Try again.", "error");
    } finally {
      busy = false;
      setBusy(false);
    }
  }

  function currentProduct() {
    if (!editingId) return null;
    return products.find(function (item) { return item.id === editingId; }) || null;
  }

  function formState() {
    return JSON.stringify({
      title: titleInput.value,
      slug: slugInput.value,
      category: categoryInput.value,
      price: priceInput.value,
      condition: conditionInput.value,
      era: eraInput.value,
      maker: makerInput.value,
      dimensions: dimensionsInput.value,
      description: descriptionInput.value,
      sort: sortInput.value,
      featured: featuredInput.checked,
      status: statusInput.value,
      images: images,
      cover: cover
    });
  }

  function snapshotForm() {
    savedState = formState();
  }

  function isDirty() {
    if (!savedState) return false;
    if (selectedFiles().length) return true;
    return formState() !== savedState;
  }

  function confirmDiscard() {
    if (!isDirty()) return true;
    return window.confirm("Discard unsaved changes?");
  }

  function focusEditor() {
    if (window.matchMedia("(max-width: 860px)").matches) {
      editorPanel.scrollIntoView({ block: "start" });
    }
  }

  function setBusy(isBusy) {
    shopDesk.querySelectorAll("button, #product-files, .status-select").forEach(function (control) {
      control.disabled = isBusy;
    });
    if (signOutButton) signOutButton.disabled = isBusy;
    if (tabJournal) tabJournal.disabled = isBusy;
    if (tabShop) tabShop.disabled = isBusy;
    if (!isBusy) renderImages();
  }

  function setListMessage(text, kind) {
    listMessage.textContent = text || "";
    listMessage.classList.toggle("is-error", kind === "error");
    listMessage.classList.toggle("is-ok", kind === "ok");
  }

  function setFormMessage(text, kind) {
    formMessage.textContent = text || "";
    formMessage.classList.toggle("is-error", kind === "error");
    formMessage.classList.toggle("is-ok", kind === "ok");
  }

  function setImageMessage(text, kind) {
    imageMessage.textContent = text || "";
    imageMessage.classList.toggle("is-error", kind === "error");
    imageMessage.classList.toggle("is-ok", kind === "ok");
  }

  function formatWhen(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    }).format(date);
  }

  function friendlyStorageError(error) {
    var message = String((error && (error.message || error.error)) || "");
    var code = String((error && (error.code || error.statusCode || error.status)) || "");
    var detail = message + " " + code;
    if (/NoSuchBucket|Bucket not found/i.test(detail)) {
      return "The product-images bucket is not in Supabase yet. Run supabase/shop-products.sql in the SQL editor, confirm the product-images bucket exists and is public, then try the upload again.";
    }
    if (code === "42501" || code === "403" || /row-level security|unauthorized|not authorized|permission denied/i.test(message)) {
      return "Supabase refused the upload. Storage policies need to let this admin write to product-images.";
    }
    if (code === "413" || /maximum allowed size|payload too large|entity too large|exceeded/i.test(message)) {
      return "Supabase rejected the file size. Photographs must be 5 MB or smaller.";
    }
    if (/mime type|invalid mime|not supported/i.test(message)) {
      return "Supabase rejected that file type. Use a JPEG, PNG, WebP, or GIF.";
    }
    if (code === "401" || /jwt|signature verification|invalid claim|invalid token|not authenticated|session expired/i.test(message)) {
      return "The admin session was not accepted. Sign in again, then upload.";
    }
    if (/already exists|duplicate/i.test(message)) {
      return "A file with that name is already stored. Try the upload again.";
    }
    return message || "The photograph could not be uploaded.";
  }

  function friendlyError(error) {
    if (!error) return "Something went wrong.";
    var code = error.code || "";
    var message = error.message || "Something went wrong.";
    if (code === "23505" || /duplicate key/i.test(message)) {
      return "Another piece already uses that slug. Choose a different one.";
    }
    if (code === "23514" || /products_category_check|products_status_check|products_price_check/i.test(message)) {
      return "Check the category, status, and price. The shelf only accepts the six categories and a price in pounds.";
    }
    if (code === "42501" || /row-level security/i.test(message)) {
      return "Supabase refused this change. The signed-in account needs permission to manage products.";
    }
    if (code === "PGRST116") {
      return "The change did not return a row. Check that this admin account can read products.";
    }
    if (code === "PGRST205" || /could not find the table|relation .*products.* does not exist|schema cache/i.test(message)) {
      return "The products table is not in Supabase yet. Run supabase/shop-products.sql in the SQL editor, then reload.";
    }
    return message;
  }

  window.curioShopIsDirty = function () {
    return isDirty();
  };

  init().catch(function () {
    if (listMessage) listMessage.textContent = "The shop desk could not open. Reload the page.";
  });
})();
