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

  root.CurioShop = {
    CATEGORIES: CATEGORIES,
    PUBLIC_STATUSES: PUBLIC_STATUSES,
    ENQUIRY_EMAIL: ENQUIRY_EMAIL,
    MAX_IMAGES: MAX_IMAGES,
    MAX_IMAGE_BYTES: MAX_IMAGE_BYTES,
    slugify: slugify,
    formatPrice: formatPrice,
    parsePrice: parsePrice,
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
