const LIST_COLUMNS = "id,title,slug,excerpt,cover_image,category,status,featured,published_at";
const ENTRY_COLUMNS = LIST_COLUMNS + ",content";

const browse = document.getElementById("journal-browse");
const heading = document.getElementById("journal-heading");
const intro = document.getElementById("journal-intro");
const statusLine = document.getElementById("journal-status");
const retryButton = document.getElementById("journal-retry");
const grid = document.getElementById("journal-grid");
const entryStatus = document.getElementById("entry-status");
const entry = document.getElementById("journal-entry");
const missing = document.getElementById("journal-missing");
const backLink = document.getElementById("journal-back");
const entryKicker = document.getElementById("entry-kicker");
const entryTitle = document.getElementById("entry-title");
const entryDate = document.getElementById("entry-date");
const entryExcerpt = document.getElementById("entry-excerpt");
const entryCover = document.getElementById("entry-cover");
const entryContent = document.getElementById("entry-content");

const route = readRoute();
let publicClient = null;

function readRoute() {
  const params = new URLSearchParams(window.location.search);
  return {
    slug: (params.get("slug") || "").trim(),
    category: (params.get("category") || "").trim()
  };
}

function clientReady() {
  try {
    if (!window.supabase || typeof SUPABASE_URL !== "string" || typeof SUPABASE_PUBLISHABLE_KEY !== "string") {
      return false;
    }
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return false;
    // A fresh client with no stored session, so a signed-in admin
    // visiting this page still reads as an anonymous visitor.
    publicClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        storageKey: "ccc-public-journal"
      }
    });
    return Boolean(publicClient && publicClient.from);
  } catch (error) {
    return false;
  }
}

function isPublished(post) {
  return Boolean(post)
    && post.status === "published"
    && String(post.slug || "").trim() !== "";
}

function publishedTime(post) {
  const time = Date.parse(post && post.published_at);
  return Number.isNaN(time) ? 0 : time;
}

function sortNewest(posts) {
  return posts.slice().sort((a, b) => publishedTime(b) - publishedTime(a));
}

function listUrl(category) {
  if (!category) return "journal.html";
  return "journal.html?category=" + encodeURIComponent(category);
}

function entryUrl(slug) {
  const url = "journal.html?slug=" + encodeURIComponent(slug);
  if (!route.category) return url;
  return url + "&category=" + encodeURIComponent(route.category);
}

function safeImageUrl(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.href;
  } catch (error) {
    return "";
  }
}

function formatDate(value) {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric"
  }).format(time);
}

function markFilters() {
  document.querySelectorAll("#journal-filters a").forEach((link) => {
    const value = link.dataset.category || "";
    if (value === route.category) link.setAttribute("aria-current", "true");
    else link.removeAttribute("aria-current");
  });
}

function setBrowseCopy() {
  if (route.category) {
    heading.textContent = route.category;
    intro.textContent = "Published entries in this category, newest first.";
  } else {
    heading.textContent = "Latest entries";
    intro.textContent = "Published notes from the Cubbyhole, newest first.";
  }
}

function showBrowseMessage(text, showRetry) {
  statusLine.textContent = text || "";
  retryButton.hidden = !showRetry;
  if (text) grid.replaceChildren();
}

async function loadList() {
  setBrowseCopy();
  showBrowseMessage("Opening the journal…", false);

  try {
    const { data, error } = await publicClient
      .from("journal_posts")
      .select(LIST_COLUMNS)
      .eq("status", "published")
      .order("published_at", { ascending: false, nullsFirst: false });

    if (error) throw error;

    const posts = sortNewest((data || []).filter(isPublished).filter((post) => {
      if (!route.category) return true;
      return post.category === route.category;
    }));
    renderList(posts);
  } catch (error) {
    showBrowseMessage("The journal could not be reached. Please try again.", true);
  }
}

function renderList(posts) {
  retryButton.hidden = true;
  grid.replaceChildren();

  if (!posts.length) {
    statusLine.textContent = route.category
      ? "Nothing published under " + route.category + " yet."
      : "Nothing has been published yet. New stories will appear here.";
    return;
  }

  statusLine.textContent = "";
  posts.forEach((post) => grid.append(renderCard(post)));
}

function renderCard(post) {
  const item = document.createElement("li");
  const link = document.createElement("a");
  link.className = "journal-card";
  link.href = entryUrl(post.slug);
  if (post.featured === true) link.classList.add("is-featured");

  const imageUrl = safeImageUrl(post.cover_image);
  if (imageUrl) {
    const image = document.createElement("img");
    image.className = "journal-cover";
    image.src = imageUrl;
    image.alt = "";
    image.loading = "lazy";
    image.addEventListener("error", () => image.remove());
    link.append(image);
  }

  const body = document.createElement("div");
  body.className = "journal-card-body";

  const kicker = document.createElement("p");
  kicker.className = "journal-kicker";
  if (post.featured === true) kicker.append(makePill("Featured"));
  if (post.category) {
    const category = document.createElement("span");
    category.textContent = post.category;
    kicker.append(category);
  }
  if (kicker.childNodes.length) body.append(kicker);

  const title = document.createElement("h3");
  title.textContent = post.title || "Untitled entry";
  body.append(title);

  if (post.excerpt) {
    const excerpt = document.createElement("p");
    excerpt.className = "journal-excerpt";
    excerpt.textContent = post.excerpt;
    body.append(excerpt);
  }

  const when = formatDate(post.published_at);
  if (when) {
    const date = document.createElement("p");
    date.className = "journal-date";
    const time = document.createElement("time");
    time.dateTime = post.published_at;
    time.textContent = when;
    date.append(time);
    body.append(date);
  }

  const more = document.createElement("span");
  more.className = "journal-readmore";
  more.textContent = "Read the entry →";
  body.append(more);

  link.append(body);
  item.append(link);
  return item;
}

function makePill(text) {
  const pill = document.createElement("span");
  pill.className = "journal-pill";
  pill.textContent = text;
  return pill;
}

function showReadingShell() {
  document.documentElement.classList.add("journal-reading");
  browse.hidden = true;
}

async function loadEntry(slug) {
  showReadingShell();
  entry.hidden = true;
  missing.hidden = true;
  entryStatus.textContent = "Opening this entry…";
  backLink.href = listUrl(route.category);
  backLink.textContent = route.category ? "← " + route.category : "← All entries";

  if (slug.length > 160) {
    showMissing();
    return;
  }

  try {
    const { data, error } = await publicClient
      .from("journal_posts")
      .select(ENTRY_COLUMNS)
      .eq("status", "published")
      .eq("slug", slug)
      .maybeSingle();

    if (error) throw error;
    if (!isPublished(data)) {
      showMissing();
      return;
    }
    renderEntry(data);
  } catch (error) {
    document.documentElement.classList.remove("journal-reading");
    browse.hidden = false;
    entry.hidden = true;
    missing.hidden = true;
    entryStatus.textContent = "";
    showBrowseMessage("The journal could not be reached. Please try again.", true);
  }
}

function showMissing() {
  entry.hidden = true;
  missing.hidden = false;
  entryStatus.textContent = "";
  document.title = "Entry not found | Journal | Cambridge Curio Cubbyhole";
}

function renderEntry(post) {
  missing.hidden = true;
  entry.hidden = false;
  entryStatus.textContent = "";
  retryButton.hidden = true;

  const title = post.title || "Untitled entry";
  entryTitle.textContent = title;
  document.title = title + " | Journal | Cambridge Curio Cubbyhole";

  const bits = [];
  if (post.featured === true) bits.push("Featured");
  if (post.category) bits.push(post.category);
  entryKicker.textContent = bits.join(" · ");

  const when = formatDate(post.published_at);
  entryDate.textContent = "";
  entryDate.replaceChildren();
  if (when) {
    const time = document.createElement("time");
    time.dateTime = post.published_at;
    time.textContent = when;
    entryDate.append(time);
  }

  if (post.excerpt) {
    entryExcerpt.hidden = false;
    entryExcerpt.textContent = post.excerpt;
  } else {
    entryExcerpt.hidden = true;
    entryExcerpt.textContent = "";
  }

  const imageUrl = safeImageUrl(post.cover_image);
  if (imageUrl) {
    entryCover.hidden = false;
    entryCover.src = imageUrl;
    entryCover.addEventListener("error", () => {
      entryCover.hidden = true;
      entryCover.removeAttribute("src");
    }, { once: true });
  } else {
    entryCover.hidden = true;
    entryCover.removeAttribute("src");
  }

  fillContent(entryContent, post.content);
}

function fillContent(container, text) {
  container.replaceChildren();
  const blocks = String(text || "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);

  if (!blocks.length) {
    const paragraph = document.createElement("p");
    paragraph.textContent = "This entry has no story text yet.";
    container.append(paragraph);
    return;
  }

  blocks.forEach((block) => {
    const paragraph = document.createElement("p");
    const lines = block.split("\n");
    lines.forEach((line, index) => {
      if (index) paragraph.append(document.createElement("br"));
      paragraph.append(document.createTextNode(line));
    });
    container.append(paragraph);
  });
}

function init() {
  markFilters();
  setBrowseCopy();

  if (!clientReady()) {
    if (route.slug) {
      showReadingShell();
      entryStatus.textContent = "The journal could not open. Please reload the page.";
    } else {
      showBrowseMessage("The journal could not open. Please reload the page.", false);
    }
    return;
  }

  retryButton.addEventListener("click", () => {
    if (route.slug) loadEntry(route.slug);
    else loadList();
  });

  if (route.slug) loadEntry(route.slug);
  else loadList();
}

init();
