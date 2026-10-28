/* Latest published journal notes for the home page.
   Uses the same public read as journal.js: published rows only,
   newest first, linked as journal.html?slug=… */

(function () {
  var LIST_COLUMNS = "id,title,slug,excerpt,cover_image,category,status,featured,published_at";
  var LIMIT = 3;

  var grid = document.getElementById("home-news-grid");
  var statusLine = document.getElementById("home-news-status");
  var retryButton = document.getElementById("home-news-retry");

  if (!grid || !statusLine) return;

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
      // No stored session, so a signed-in admin still reads as a visitor.
      return window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false,
          storageKey: "ccc-public-home-news"
        }
      });
    } catch (error) {
      return null;
    }
  }

  function isPublished(post) {
    return Boolean(post)
      && post.status === "published"
      && String(post.slug || "").trim() !== "";
  }

  function publishedTime(post) {
    var time = Date.parse(post && post.published_at);
    return Number.isNaN(time) ? 0 : time;
  }

  function sortNewest(posts) {
    return posts.slice().sort(function (a, b) {
      return publishedTime(b) - publishedTime(a);
    });
  }

  function entryUrl(slug) {
    return "journal.html?slug=" + encodeURIComponent(slug);
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

  function formatDate(value) {
    var time = Date.parse(value);
    if (Number.isNaN(time)) return "";
    return new Intl.DateTimeFormat("en-GB", {
      day: "numeric",
      month: "long",
      year: "numeric"
    }).format(time);
  }

  function placeholderCover() {
    var placeholder = document.createElement("div");
    placeholder.className = "home-news-placeholder";
    placeholder.setAttribute("aria-hidden", "true");
    var mark = document.createElement("span");
    mark.textContent = "◆  ✦  ◆";
    placeholder.append(mark);
    return placeholder;
  }

  function renderCard(post) {
    var item = document.createElement("li");
    var link = document.createElement("a");
    link.className = "home-news-card";
    link.href = entryUrl(post.slug);

    var imageUrl = safeImageUrl(post.cover_image);
    if (imageUrl) {
      var image = document.createElement("img");
      image.className = "home-news-cover";
      image.src = imageUrl;
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("error", function () {
        image.replaceWith(placeholderCover());
      });
      link.append(image);
    } else {
      link.append(placeholderCover());
    }

    var body = document.createElement("div");
    body.className = "home-news-body";

    var kickerBits = [];
    if (post.featured === true) kickerBits.push("Featured");
    if (post.category) kickerBits.push(post.category);
    if (kickerBits.length) {
      var kicker = document.createElement("p");
      kicker.className = "home-news-kicker";
      kicker.textContent = kickerBits.join(" · ");
      body.append(kicker);
    }

    var title = document.createElement("h3");
    title.textContent = post.title || "Untitled entry";
    body.append(title);

    var when = formatDate(post.published_at);
    if (when) {
      var date = document.createElement("p");
      date.className = "home-news-date";
      var time = document.createElement("time");
      time.dateTime = post.published_at;
      time.textContent = when;
      date.append(time);
      body.append(date);
    }

    if (post.excerpt) {
      var excerpt = document.createElement("p");
      excerpt.className = "home-news-excerpt";
      excerpt.textContent = post.excerpt;
      body.append(excerpt);
    }

    var more = document.createElement("span");
    more.className = "home-news-read";
    more.textContent = "Read the entry →";
    body.append(more);

    link.append(body);
    item.append(link);
    return item;
  }

  function render(posts) {
    showRetry(false);
    grid.replaceChildren();

    if (!posts.length) {
      setStatus("Nothing has been published yet. New stories will appear here.");
      return;
    }

    setStatus("");
    posts.forEach(function (post) {
      grid.append(renderCard(post));
    });
  }

  async function loadNews() {
    var client = publicClient();
    if (!client || !client.from) {
      grid.replaceChildren();
      showRetry(false);
      setStatus("The latest notes could not be opened just now.");
      return;
    }

    setStatus("Opening the latest notes…");
    showRetry(false);

    try {
      var result = await client
        .from("journal_posts")
        .select(LIST_COLUMNS)
        .eq("status", "published")
        .order("published_at", { ascending: false, nullsFirst: false })
        .limit(LIMIT);

      if (result.error) throw result.error;

      var posts = sortNewest((result.data || []).filter(isPublished)).slice(0, LIMIT);
      render(posts);
    } catch (error) {
      grid.replaceChildren();
      showRetry(true);
      setStatus("The latest notes could not be reached just now.");
    }
  }

  if (retryButton) {
    retryButton.addEventListener("click", function () {
      loadNews();
    });
  }

  loadNews();
})();
