/* Shared shop helpers for the public shelf, the home grid, and the cabinet.
   Classic script: window.CurioShop in the browser, globalThis.CurioShop in Node. */

(function (root) {
  var CATEGORIES = [
    "Glass & Crystal",
    "Ceramics & Pottery",
    "Brass & Metalwork",
    "Collectables",
    "Decorative",
    "Curious Things"
  ];

  var PUBLIC_STATUSES = ["available", "reserved", "sold"];
  var ENQUIRY_EMAIL = "curiocubbyhole@gmail.com";
  var MAX_IMAGES = 12;
  var MAX_IMAGE_BYTES = 5 * 1024 * 1024;

  var IMAGE_TYPES = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif"
  };

  var IMAGE_MIME_EXT = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/pjpeg": "jpg",
    "image/png": "png",
    "image/x-png": "png",
    "image/webp": "webp",
    "image/gif": "gif"
  };

  function slugify(value) {
    return String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80)
      .replace(/-+$/g, "");
  }

  function formatPrice(value) {
    var number = typeof value === "number"
      ? value
      : Number(String(value == null ? "" : value).replace(/,/g, ""));
    if (!Number.isFinite(number)) return "";
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: "GBP",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(number);
  }

  function parsePrice(value) {
    var text = String(value == null ? "" : value)
      .trim()
      .replace(/£/g, "")
      .replace(/,/g, "")
      .replace(/\s/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
    var number = Number(text);
    if (!Number.isFinite(number) || number > 99999999.99) return null;
    return number.toFixed(2);
  }

  function parseSortOrder(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return 0;
    if (!/^-?\d+$/.test(text)) return null;
    var number = Number(text);
    if (!Number.isInteger(number) || number < -9999 || number > 9999) return null;
    return number;
  }

  function safeImageUrl(value) {
    var trimmed = String(value || "").trim();
    if (!trimmed) return "";
    try {
      var url = new URL(trimmed);
      if (url.protocol !== "http:" && url.protocol !== "https:") return "";
      return url.href;
    } catch (error) {
      return "";
    }
  }

  function isPublicProduct(product) {
    return Boolean(product)
      && PUBLIC_STATUSES.indexOf(product.status) !== -1
      && String(product.slug || "").trim() !== "";
  }

  function createdTime(product) {
    var time = Date.parse(product && product.created_at);
    return Number.isNaN(time) ? 0 : time;
  }

  function statusRank(status) {
    if (status === "available") return 0;
    if (status === "reserved") return 1;
    if (status === "sold") return 2;
    return 3;
  }

  function sortForShelf(products) {
    return products.slice().sort(function (a, b) {
      var byStatus = statusRank(a.status) - statusRank(b.status);
      if (byStatus) return byStatus;
      var byFeatured = (b.featured === true) - (a.featured === true);
      if (byFeatured) return byFeatured;
      var bySort = (Number(a.sort_order) || 0) - (Number(b.sort_order) || 0);
      if (bySort) return bySort;
      return createdTime(b) - createdTime(a);
    });
  }

  function sortLatest(products) {
    return products.slice().sort(function (a, b) {
      return createdTime(b) - createdTime(a);
    });
  }

  function normaliseCategory(value) {
    var text = String(value || "").trim().toLowerCase();
    if (!text) return "";
    var i;
    for (i = 0; i < CATEGORIES.length; i += 1) {
      if (CATEGORIES[i].toLowerCase() === text) return CATEGORIES[i];
    }
    var slug = slugify(text);
    for (i = 0; i < CATEGORIES.length; i += 1) {
      if (slugify(CATEGORIES[i]) === slug) return CATEGORIES[i];
    }
    return "";
  }

  function productHaystack(product) {
    return [
      product.title,
      product.category,
      product.description,
      product.condition,
      product.era,
      product.maker,
      product.dimensions,
      product.status
    ].join("\n").toLowerCase();
  }

  function matchesQuery(product, query) {
    var q = String(query || "").trim().toLowerCase();
    if (!q) return true;
    var hay = productHaystack(product);
    return q.split(/\s+/).filter(Boolean).every(function (word) {
      return hay.indexOf(word) !== -1;
    });
  }

  function filterShelf(products, options) {
    var settings = options || {};
    var category = settings.category || "";
    var query = settings.query || "";
    var hideSold = Boolean(settings.hideSold);
    return (products || []).filter(function (product) {
      if (!isPublicProduct(product)) return false;
      if (category && product.category !== category) return false;
      if (hideSold && product.status === "sold") return false;
      return matchesQuery(product, query);
    });
  }

  function imageList(product) {
    var raw = product && product.images;
    var list = Array.isArray(raw) ? raw : [];
    var seen = {};
    var urls = [];
    list.forEach(function (item) {
      var url = safeImageUrl(item);
      if (!url || seen[url]) return;
      seen[url] = true;
      urls.push(url);
    });
    return urls;
  }

  function coverUrl(product) {
    var images = imageList(product);
    var cover = safeImageUrl(product && product.cover_image);
    if (cover && (images.indexOf(cover) !== -1 || !images.length)) return cover;
    return images[0] || "";
  }

  function galleryUrls(product) {
    var images = imageList(product);
    var cover = coverUrl(product);
    if (!cover) return images;
    var rest = images.filter(function (url) { return url !== cover; });
    if (images.indexOf(cover) === -1) return [cover].concat(rest);
    return [cover].concat(rest);
  }

  function statusLabel(status) {
    if (status === "available") return "Available";
    if (status === "reserved") return "Reserved";
    if (status === "sold") return "Sold";
    if (status === "draft") return "Draft";
    return "";
  }

  function enquireMailto(product, pageUrl) {
    var title = (product && product.title) || "a piece";
    var subject = "Enquiry: " + title;
    var body = "Hello,\n\nI would like to enquire about \"" + title + "\".\n\n" + (pageUrl || "") + "\n";
    return "mailto:" + ENQUIRY_EMAIL
      + "?subject=" + encodeURIComponent(subject)
      + "&body=" + encodeURIComponent(body);
  }

  function shopUrl(params) {
    var settings = params || {};
    var parts = [];
    if (settings.item) parts.push("item=" + encodeURIComponent(settings.item));
    if (settings.category) parts.push("category=" + encodeURIComponent(settings.category));
    if (settings.q) parts.push("q=" + encodeURIComponent(settings.q));
    if (settings.hideSold) parts.push("sold=hidden");
    return "shop.html" + (parts.length ? "?" + parts.join("&") : "");
  }

  function extensionOf(name) {
    var base = String(name || "").trim().toLowerCase();
    var dot = base.lastIndexOf(".");
    if (dot <= 0 || dot === base.length - 1) return "";
    return base.slice(dot + 1);
  }

  function formatBytes(bytes) {
    var mb = bytes / (1024 * 1024);
    if (mb >= 0.1) {
      var rounded = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
      return rounded + " MB";
    }
    var kb = Math.max(1, Math.round(bytes / 1024));
    return kb + " KB";
  }

  function validateImageFile(file) {
    if (!file) {
      return { ok: false, message: "Choose an image from this device, then choose Upload." };
    }
    if (!file.size) {
      return { ok: false, message: "That file is empty. Choose a JPEG, PNG, WebP, or GIF." };
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return {
        ok: false,
        message: "That image is " + formatBytes(file.size) + ". Photographs must be 5 MB or smaller."
      };
    }

    var nameExt = extensionOf(file.name);
    var mime = String(file.type || "").toLowerCase().split(";")[0].trim();
    if (mime === "image/heic" || mime === "image/heif" || nameExt === "heic" || nameExt === "heif") {
      return {
        ok: false,
        message: "HEIC photos need to be saved as JPEG first. Photographs can be JPEG, PNG, WebP, or GIF."
      };
    }

    var mimeExt = IMAGE_MIME_EXT[mime];
    var nameType = IMAGE_TYPES[nameExt];
    if (mime && !mimeExt) {
      if (mime.indexOf("image/") === 0) {
        return { ok: false, message: "Choose a JPEG, PNG, WebP, or GIF. This image type is not accepted." };
      }
      if (mime !== "application/octet-stream" || !nameType) {
        return { ok: false, message: "Choose a JPEG, PNG, WebP, or GIF. Other file types are not accepted." };
      }
    }

    if (mimeExt) {
      return { ok: true, ext: mimeExt, type: IMAGE_TYPES[mimeExt] };
    }
    if (nameType) {
      return { ok: true, ext: nameExt === "jpeg" ? "jpg" : nameExt, type: nameType };
    }
    return { ok: false, message: "Choose a JPEG, PNG, WebP, or GIF. Other file types are not accepted." };
  }

  var PRICE_OPTIONS = [
    {
      key: "delivered",
      column: "price_delivered",
      label: "Delivered to your door",
      cardLabel: "Delivered",
      adminLabel: "Delivered",
      note: ""
    },
    {
      key: "item",
      column: "price_item",
      label: "Item only, arrange your own courier",
      cardLabel: "Item only",
      adminLabel: "Item only",
      note: "Contact us to arrange collection by your courier"
    },
    {
      key: "collection",
      column: "price_collection",
      label: "Collect from Wisbech",
      cardLabel: "Collection",
      adminLabel: "Collection",
      note: "Collection by arrangement"
    }
  ];

  function amountOf(value) {
    if (value == null || value === "") return null;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || value < 0 || value > 99999999.99) return null;
      return Math.round(value * 100) / 100;
    }
    var text = String(value).trim().replace(/£/g, "").replace(/,/g, "").replace(/\s/g, "");
    if (!/^\d+(\.\d+)?$/.test(text)) return null;
    var number = Number(text);
    if (!Number.isFinite(number) || number < 0 || number > 99999999.99) return null;
    return Math.round(number * 100) / 100;
  }

  function offeredPrices(product) {
    var list = [];
    if (!product) return list;
    PRICE_OPTIONS.forEach(function (option) {
      if (!Object.prototype.hasOwnProperty.call(product, option.column)) return;
      var amount = amountOf(product[option.column]);
      if (amount == null) return;
      list.push({
        key: option.key,
        label: option.label,
        cardLabel: option.cardLabel,
        adminLabel: option.adminLabel,
        note: option.note,
        amount: amount
      });
    });
    if (list.length) return list;
    var fallback = amountOf(product.price);
    if (fallback == null) return list;
    list.push({
      key: "price",
      label: "Price",
      cardLabel: "",
      adminLabel: "",
      note: "",
      amount: fallback
    });
    return list;
  }

  function headlinePrice(product) {
    var options = offeredPrices(product);
    if (!options.length) return "";
    if (options.length === 1 && options[0].key === "price") return formatPrice(options[0].amount);
    if (options.length === 1) return options[0].cardLabel + " " + formatPrice(options[0].amount);
    var lowest = options[0].amount;
    options.forEach(function (option) {
      if (option.amount < lowest) lowest = option.amount;
    });
    return "From " + formatPrice(lowest);
  }

  function priceSummary(product) {
    var options = offeredPrices(product);
    if (!options.length) return "";
    if (options.length === 1 && options[0].key === "price") return formatPrice(options[0].amount);
    return options.map(function (option) {
      return option.adminLabel + " " + formatPrice(option.amount);
    }).join(" · ");
  }

  function readOptionalPrice(value) {
    var text = String(value == null ? "" : value).trim();
    if (!text) return { ok: true, value: null };
    var parsed = parsePrice(text);
    if (parsed == null) return { ok: false, value: null };
    return { ok: true, value: parsed };
  }

  function storedPrice(delivered, item, collection) {
    if (delivered != null) return delivered;
    var amounts = [];
    if (item != null) amounts.push(Number(item));
    if (collection != null) amounts.push(Number(collection));
    if (!amounts.length) return null;
    var lowest = amounts[0];
    amounts.forEach(function (amount) {
      if (amount < lowest) lowest = amount;
    });
    return lowest.toFixed(2);
  }

  function columnsWithPrices(columns) {
    return String(columns || "") + ",price_delivered,price_item,price_collection";
  }

  var SALE_CHANNELS = [
    { key: "website", label: "Website" },
    { key: "etsy", label: "Etsy" },
    { key: "ebay", label: "eBay" },
    { key: "vinted", label: "Vinted" },
    { key: "in_person", label: "In person" },
    { key: "other", label: "Other" }
  ];

  function offerOptionLabel(key) {
    if (key === "delivered") return "Delivered";
    if (key === "item") return "Item only, own courier";
    if (key === "collection") return "Collection";
    if (key === "other") return "Other";
    return "";
  }

  function offerChoices(product) {
    var list = offeredPrices(product).filter(function (option) {
      return option.key === "delivered" || option.key === "item" || option.key === "collection";
    }).map(function (option) {
      return {
        key: option.key,
        label: offerOptionLabel(option.key),
        detail: option.label,
        amount: option.amount
      };
    });
    if (list.length) return list;
    var fallback = offeredPrices(product).filter(function (option) {
      return option.key === "price";
    })[0];
    if (!fallback) return list;
    return [{
      key: "delivered",
      label: offerOptionLabel("delivered"),
      detail: "Price",
      amount: fallback.amount
    }];
  }

  function askedAmount(product, optionKey) {
    var choices = offerChoices(product);
    var i;
    for (i = 0; i < choices.length; i += 1) {
      if (choices[i].key === optionKey) return choices[i].amount;
    }
    return null;
  }

  function preferredSaleOption(product) {
    var choices = offerChoices(product);
    if (choices.length) return { key: choices[0].key, amount: choices[0].amount };
    return { key: "other", amount: null };
  }

  function offerPercent(amount, asked) {
    var offer = typeof amount === "number" ? amount : Number(amount);
    var list = typeof asked === "number" ? asked : Number(asked);
    if (!Number.isFinite(offer) || !Number.isFinite(list) || list <= 0 || offer < 0) return null;
    return Math.round((offer / list) * 100);
  }

  function channelLabel(key) {
    var found = "";
    SALE_CHANNELS.forEach(function (channel) {
      if (channel.key === key) found = channel.label;
    });
    return found;
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

  function inLondonMonth(value, now) {
    var when = new Date(value);
    var clock = now ? new Date(now) : new Date();
    if (Number.isNaN(when.getTime()) || Number.isNaN(clock.getTime())) return false;
    var zone = { timeZone: "Europe/London", year: "numeric", month: "2-digit" };
    return new Intl.DateTimeFormat("en-GB", zone).format(when)
      === new Intl.DateTimeFormat("en-GB", zone).format(clock);
  }

  function mailtoWith(email, subject, body) {
    var address = String(email || "").trim();
    if (!address || /[\s<>"]/.test(address)) return "";
    return "mailto:" + address
      + "?subject=" + encodeURIComponent(subject || "")
      + "&body=" + encodeURIComponent(body || "");
  }

  function offerContactMailto(offer) {
    var title = (offer && offer.product_title) || "a piece";
    var name = (offer && offer.name) || "";
    var subject = "Your offer on " + title;
    var body = "Hello " + name + ",\n\nThank you for your offer on \"" + title + "\".\n\n";
    return mailtoWith(offer && offer.email, subject, body);
  }

  function counterMailto(offer, counterAmount) {
    var title = (offer && offer.product_title) || "a piece";
    var name = (offer && offer.name) || "";
    var option = offerOptionLabel(offer && offer.option);
    var subject = "Your offer on " + title;
    var lines = [
      "Hello " + name + ",",
      "",
      "Thank you for your offer of " + formatPrice(offer && offer.amount) + " for \"" + title + "\"" + (option ? " (" + option + ")" : "") + ".",
      "",
      "We can do " + formatPrice(counterAmount) + " for that option.",
      "",
      "If that suits you, reply to this email and we will set the piece aside.",
      "",
      "Cambridge Curio Cubbyhole"
    ];
    return mailtoWith(offer && offer.email, subject, lines.join("\n"));
  }

  function missingPriceColumns(error) {
    if (!error) return false;
    var blob = String(error.message || "") + " " + String(error.details || "") + " " + String(error.hint || "");
    if (!/price_delivered|price_item|price_collection/.test(blob)) return false;
    var code = String(error.code || "");
    if (code === "42703" || code === "PGRST204") return true;
    return /schema cache|does not exist|could not find/i.test(blob);
  }

  root.CurioShop = {
    CATEGORIES: CATEGORIES,
    PUBLIC_STATUSES: PUBLIC_STATUSES,
    ENQUIRY_EMAIL: ENQUIRY_EMAIL,
    MAX_IMAGES: MAX_IMAGES,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    slugify: slugify,
    formatPrice: formatPrice,
    parsePrice: parsePrice,
    offeredPrices: offeredPrices,
    headlinePrice: headlinePrice,
    priceSummary: priceSummary,
    readOptionalPrice: readOptionalPrice,
    storedPrice: storedPrice,
    columnsWithPrices: columnsWithPrices,
    missingPriceColumns: missingPriceColumns,
    SALE_CHANNELS: SALE_CHANNELS,
    offerOptionLabel: offerOptionLabel,
    offerChoices: offerChoices,
    askedAmount: askedAmount,
    preferredSaleOption: preferredSaleOption,
    offerPercent: offerPercent,
    channelLabel: channelLabel,
    formatWhen: formatWhen,
    inLondonMonth: inLondonMonth,
    offerContactMailto: offerContactMailto,
    counterMailto: counterMailto,
    parseSortOrder: parseSortOrder,
    safeImageUrl: safeImageUrl,
    isPublicProduct: isPublicProduct,
    sortForShelf: sortForShelf,
    sortLatest: sortLatest,
    normaliseCategory: normaliseCategory,
    filterShelf: filterShelf,
    imageList: imageList,
    coverUrl: coverUrl,
    galleryUrls: galleryUrls,
    statusLabel: statusLabel,
    enquireMailto: enquireMailto,
    shopUrl: shopUrl,
    validateImageFile: validateImageFile
  };
})(typeof window !== "undefined" ? window : globalThis);
