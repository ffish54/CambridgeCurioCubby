const CATEGORIES = [
  "Recent Finds",
  "New Stock",
  "Shop News",
  "Stories Behind the Items",
  "Upcoming Sales"
];

const gate = document.getElementById("gate");
const gateMessage = document.getElementById("gate-message");
const app = document.getElementById("app");
const accountLabel = document.getElementById("account-label");
const signOutButton = document.getElementById("sign-out");
const newPostButton = document.getElementById("new-post");
const postList = document.getElementById("post-list");
const listMessage = document.getElementById("list-message");
const filterButtons = document.querySelectorAll(".filter");
const editorPanel = document.getElementById("editor-panel");
const editorHeading = document.getElementById("editor-heading");
const publishedNote = document.getElementById("published-note");
const form = document.getElementById("post-form");
const titleInput = document.getElementById("title");
const slugInput = document.getElementById("slug");
const slugFromTitle = document.getElementById("slug-from-title");
const categoryInput = document.getElementById("category");
const excerptInput = document.getElementById("excerpt");
const contentInput = document.getElementById("content");
const coverInput = document.getElementById("cover-image");
const coverFileInput = document.getElementById("cover-file");
const uploadCoverButton = document.getElementById("upload-cover");
const clearCoverFileButton = document.getElementById("clear-cover-file");
const coverMessage = document.getElementById("cover-message");
const coverPreview = document.getElementById("cover-preview");

// Bucket created by supabase/journal-covers.sql. The publishable key cannot
// create it. Storage policies, not this page, decide who can write.
const COVER_BUCKET = "journal-covers";
const COVER_MAX_BYTES = 5 * 1024 * 1024;
const COVER_TYPES = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif"
};
const COVER_MIME_EXT = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/pjpeg": "jpg",
  "image/png": "png",
  "image/x-png": "png",
  "image/webp": "webp",
  "image/gif": "gif"
};
const featuredInput = document.getElementById("featured");
const statusInput = document.getElementById("status");
const saveDraftButton = document.getElementById("save-draft");
const publishButton = document.getElementById("publish-post");
const unpublishButton = document.getElementById("unpublish-post");
const deleteButton = document.getElementById("delete-post");
const formMessage = document.getElementById("form-message");

let posts = [];
let activeFilter = "all";
let editingId = null;
let slugTouched = false;
let savedState = "";
let busy = false;
let leaving = false;
let coverPreviewToken = 0;

function clientReady() {
  try {
    return Boolean(supabaseClient && supabaseClient.auth && ADMIN_USER_ID);
  } catch (error) {
    return false;
  }
}

function isAdmin(user) {
  if (!user || !user.id) return false;
  return String(user.id).toLowerCase() === String(ADMIN_USER_ID).toLowerCase();
}

function leave() {
  if (leaving) return;
  leaving = true;
  window.location.replace("admin-login.html");
}

async function init() {
  gateMessage.textContent = "Checking the cabinet lock…";

  if (!clientReady()) {
    gateMessage.textContent = "Supabase did not load. Check the connection and reload.";
    return;
  }

  const session = await requireAdmin();
  if (!session) return;

  accountLabel.textContent = session.user.email || "Admin";
  gate.classList.add("is-hidden");
  app.classList.remove("is-hidden");
  bindEvents();
  openNew({ force: true, silent: true });
  await loadPosts();
}

async function requireAdmin() {
  let session = null;

  try {
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    session = data.session;
  } catch (error) {
    gateMessage.textContent = "Could not check the sign-in. Sending you back.";
    leave();
    return null;
  }

  if (!session || !isAdmin(session.user)) {
    gateMessage.textContent = "Sending you back to sign in…";
    if (session) {
      try {
        await supabaseClient.auth.signOut();
      } catch (error) {
        // Still leave. A rejected sign-out should not keep the desk open.
      }
    }
    leave();
    return null;
  }

  supabaseClient.auth.onAuthStateChange((event, nextSession) => {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") {
      if (event === "TOKEN_REFRESHED" && nextSession && !isAdmin(nextSession.user)) {
        leave();
      }
      return;
    }
    if (event === "SIGNED_OUT" || !nextSession || !isAdmin(nextSession.user)) {
      leave();
    }
  });

  return session;
}

function bindEvents() {
  signOutButton.addEventListener("click", signOut);
  newPostButton.addEventListener("click", () => {
    openNew();
    focusEditor();
  });
  slugFromTitle.addEventListener("click", () => {
    slugTouched = false;
    slugInput.value = slugify(titleInput.value);
    slugInput.focus();
  });
  titleInput.addEventListener("input", () => {
    if (slugTouched) return;
    slugInput.value = slugify(titleInput.value);
  });
  slugInput.addEventListener("input", () => {
    slugTouched = slugInput.value.trim() !== slugify(titleInput.value);
  });
  coverInput.addEventListener("input", () => {
    updateCoverPreview();
    setCoverMessage("");
  });
  coverFileInput.addEventListener("change", () => {
    const file = selectedCoverFile();
    if (!file) {
      setCoverMessage("");
      return;
    }
    const checked = validateCoverFile(file);
    if (!checked.ok) {
      setCoverMessage(checked.message, "error");
      return;
    }
    setCoverMessage(file.name + " is ready. Choose Upload to store it.");
  });
  uploadCoverButton.addEventListener("click", () => {
    uploadCover();
  });
  clearCoverFileButton.addEventListener("click", clearCoverFile);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const nextStatus = statusInput.value === "published" ? "published" : "draft";
    savePost(nextStatus);
  });
  saveDraftButton.addEventListener("click", () => savePost("draft"));
  publishButton.addEventListener("click", () => savePost("published"));
  unpublishButton.addEventListener("click", () => savePost("draft"));
  deleteButton.addEventListener("click", () => {
    const post = currentPost();
    if (post) deletePost(post);
  });
  postList.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const card = button.closest("[data-id]");
    if (!card) return;
    const post = posts.find((item) => item.id === card.dataset.id);
    if (!post) return;
    handleListAction(button.dataset.action, post);
  });
  filterButtons.forEach((button) => {
    button.addEventListener("click", () => {
      activeFilter = button.dataset.filter;
      renderList();
    });
  });
  window.addEventListener("beforeunload", (event) => {
    if (leaving || !isDirty()) return;
    event.preventDefault();
    event.returnValue = "";
  });
}

async function signOut() {
  if (isDirty() && !window.confirm("Sign out and discard unsaved edits?")) return;
  leaving = true;
  setBusy(true);
  const { error } = await supabaseClient.auth.signOut();
  if (error) {
    leaving = false;
    setBusy(false);
    setListMessage(friendlyError(error), "error");
    return;
  }
  window.location.replace("admin-login.html");
}

async function loadPosts(options = {}) {
  if (!options.quiet) setListMessage("Loading posts…");

  try {
    const { data, error } = await supabaseClient
      .from("journal_posts")
      .select("*")
      .order("updated_at", { ascending: false });

    if (error) {
      posts = [];
      renderList();
      setListMessage(friendlyError(error), "error");
      return false;
    }

    posts = data || [];
    renderList();
    if (!options.quiet) setListMessage("");
    return true;
  } catch (error) {
    posts = [];
    renderList();
    setListMessage("Could not reach Supabase. Try again.", "error");
    return false;
  }
}

function renderList() {
  const counts = {
    all: posts.length,
    draft: posts.filter((post) => post.status !== "published").length,
    published: posts.filter((post) => post.status === "published").length
  };

  filterButtons.forEach((button) => {
    const filter = button.dataset.filter;
    const label = filter === "all" ? "All" : filter === "draft" ? "Drafts" : "Published";
    button.textContent = `${label} (${counts[filter]})`;
    const selected = filter === activeFilter;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-selected", selected ? "true" : "false");
  });

  const visible = posts.filter((post) => {
    if (activeFilter === "published") return post.status === "published";
    if (activeFilter === "draft") return post.status !== "published";
    return true;
  });

  postList.replaceChildren();

  if (!visible.length) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    if (activeFilter === "draft") empty.textContent = "No drafts.";
    else if (activeFilter === "published") empty.textContent = "Nothing published yet.";
    else empty.textContent = "No journal posts yet.";
    postList.append(empty);
    return;
  }

  visible.forEach((post) => postList.append(renderPostCard(post)));
  if (busy) setBusy(true);
}

function renderPostCard(post) {
  const item = document.createElement("li");
  item.className = "post-card";
  item.dataset.id = post.id;
  if (post.id === editingId) item.classList.add("is-active");

  const meta = document.createElement("div");
  meta.className = "post-meta";
  meta.append(makePill(
    statusLabel(post.status),
    post.status === "published" ? "pill pill-published" : "pill"
  ));
  if (post.featured) meta.append(makePill("Featured", "pill pill-featured"));
  item.append(meta);

  const heading = document.createElement("h3");
  heading.textContent = post.title || "Untitled";
  item.append(heading);

  const details = document.createElement("p");
  const when = formatWhen(post.updated_at || post.created_at);
  const bits = [post.category || "Uncategorised"];
  if (when) bits.push(`Updated ${when}`);
  details.textContent = bits.join(" · ");
  item.append(details);

  const actions = document.createElement("div");
  actions.className = "post-actions";
  actions.append(
    makeMini("Edit", "edit"),
    makeMini(
      post.status === "published" ? "Unpublish" : "Publish",
      post.status === "published" ? "unpublish" : "publish"
    ),
    makeMini(post.featured ? "Unfeature" : "Feature", post.featured ? "unfeature" : "feature"),
    makeMini("Delete", "delete", "mini-button mini-danger")
  );
  item.append(actions);
  return item;
}

function makePill(text, className) {
  const pill = document.createElement("span");
  pill.className = className;
  pill.textContent = text;
  return pill;
}

function makeMini(text, action, className) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className || "mini-button";
  button.dataset.action = action;
  button.textContent = text;
  return button;
}

async function handleListAction(action, post) {
  if (busy) return;

  if (action === "edit") {
    if (post.id === editingId) {
      titleInput.focus();
      focusEditor();
      return;
    }
    if (!confirmDiscard()) return;
    fillForm(post, { focus: true });
    return;
  }

  if (isDirty()) {
    if (!window.confirm("You have unsaved edits in the form. Continue and discard them?")) return;
    discardFormEdits();
  }

  if (action === "delete") await deletePost(post);
  else if (action === "feature") await setFeatured(post, true);
  else if (action === "unfeature") await setFeatured(post, false);
  else if (action === "publish") await setStatus(post, "published");
  else if (action === "unpublish") await setStatus(post, "draft");
}

function openNew(options = {}) {
  if (!options.force && !confirmDiscard()) return;
  editingId = null;
  form.reset();
  slugTouched = false;
  slugInput.value = "";
  syncCategory("");
  featuredInput.checked = false;
  statusInput.value = "draft";
  editorHeading.textContent = "New post";
  publishedNote.hidden = true;
  publishedNote.textContent = "";
  deleteButton.hidden = true;
  unpublishButton.hidden = true;
  clearCoverFile();
  updateCoverPreview();
  setFormMessage("");
  snapshotForm();
  renderList();
  if (!options.silent) titleInput.focus();
}

function fillForm(post, options = {}) {
  editingId = post.id;
  titleInput.value = post.title || "";
  slugInput.value = post.slug || "";
  slugTouched = true;
  excerptInput.value = post.excerpt || "";
  contentInput.value = post.content || "";
  syncCategory(post.category);
  coverInput.value = post.cover_image || "";
  clearCoverFile();
  featuredInput.checked = Boolean(post.featured);
  statusInput.value = post.status === "published" ? "published" : "draft";
  editorHeading.textContent = "Edit post";
  deleteButton.hidden = false;
  unpublishButton.hidden = post.status !== "published";
  if (post.published_at) {
    const when = formatWhen(post.published_at);
    publishedNote.hidden = false;
    publishedNote.textContent = post.status === "published"
      ? `Published ${when}. Later saves keep this date.`
      : `First published ${when}. Publishing again keeps this date.`;
  } else {
    publishedNote.hidden = true;
    publishedNote.textContent = "";
  }
  updateCoverPreview();
  snapshotForm();
  renderList();
  if (options.focus) {
    titleInput.focus();
    focusEditor();
  }
}

function discardFormEdits() {
  const post = currentPost();
  if (post) fillForm(post);
  else openNew({ force: true, silent: true });
}

function syncCategory(value) {
  [...categoryInput.options].forEach((option) => {
    if (!CATEGORIES.includes(option.value)) option.remove();
  });
  if (value && !CATEGORIES.includes(value)) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    categoryInput.append(option);
    categoryInput.value = value;
    return;
  }
  categoryInput.value = CATEGORIES.includes(value) ? value : CATEGORIES[0];
}

function updateCoverPreview() {
  const token = ++coverPreviewToken;
  const parsed = parseCover(coverInput.value);
  if (!parsed.ok || !parsed.value) {
    coverPreview.hidden = true;
    coverPreview.removeAttribute("src");
    return;
  }
  coverPreview.onload = () => {
    if (token !== coverPreviewToken) return;
    coverPreview.hidden = false;
  };
  coverPreview.onerror = () => {
    if (token !== coverPreviewToken) return;
    coverPreview.hidden = true;
    if (parsed.value.indexOf("/object/public/" + COVER_BUCKET + "/") !== -1) {
      setCoverMessage("The cover address is filled in, but the image did not load. Make the journal-covers bucket public, then save the post.", "error");
    }
  };
  coverPreview.src = parsed.value;
  coverPreview.hidden = false;
}

function selectedCoverFile() {
  return coverFileInput.files && coverFileInput.files[0] ? coverFileInput.files[0] : null;
}

function clearCoverFile() {
  coverFileInput.value = "";
  setCoverMessage("");
}

async function uploadCover() {
  if (busy) return;

  const file = selectedCoverFile();
  const checked = validateCoverFile(file);
  if (!checked.ok) {
    setCoverMessage(checked.message, "error");
    coverFileInput.focus();
    return;
  }

  busy = true;
  setBusy(true);
  setCoverMessage("Uploading cover…");
  let stored = false;

  try {
    const auth = await adminSession();
    if (!auth.ok) {
      setCoverMessage(auth.message, "error");
      return;
    }

    if (!supabaseClient.storage || typeof supabaseClient.storage.from !== "function") {
      setCoverMessage("Supabase Storage did not load. Reload the page.", "error");
      return;
    }

    const path = coverObjectPath(checked.ext);
    const { error } = await supabaseClient.storage.from(COVER_BUCKET).upload(path, file, {
      contentType: checked.type,
      cacheControl: "31536000",
      upsert: false
    });

    if (error) {
      setCoverMessage(friendlyStorageError(error), "error");
      return;
    }

    const published = supabaseClient.storage.from(COVER_BUCKET).getPublicUrl(path);
    const publicUrl = published && published.data && published.data.publicUrl;
    if (!publicUrl) {
      setCoverMessage("The file uploaded, but no public address came back. Make the journal-covers bucket public, then try again.", "error");
      return;
    }

    coverInput.value = publicUrl;
    stored = true;
    setCoverMessage("Cover uploaded. Save or publish the post to keep this image.", "ok");
    updateCoverPreview();
  } catch (error) {
    setCoverMessage("Could not reach Supabase Storage. Try again.", "error");
  } finally {
    busy = false;
    setBusy(false);
    if (stored) coverFileInput.value = "";
  }
}

async function adminSession() {
  try {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error || !data || !data.user) {
      const detail = String((error && error.message) || "");
      if (/fetch|network|failed to fetch/i.test(detail)) {
        return { ok: false, message: "Could not confirm the admin session. Try again." };
      }
      return { ok: false, message: "Sign in as the admin before uploading a cover." };
    }
    if (!isAdmin(data.user)) {
      return { ok: false, message: "This signed-in account cannot upload covers." };
    }

    const sessionResult = await supabaseClient.auth.getSession();
    const session = sessionResult && sessionResult.data && sessionResult.data.session;
    if (!session || !session.access_token || !isAdmin(session.user)) {
      return { ok: false, message: "Sign in as the admin before uploading a cover." };
    }
    return { ok: true, session: session };
  } catch (error) {
    return { ok: false, message: "Could not confirm the admin session. Try again." };
  }
}

async function savePost(nextStatus) {
  if (busy) return;
  const status = nextStatus === "published" ? "published" : "draft";
  const existing = currentPost();
  const willUnpublish = status === "draft" && existing && existing.status === "published";

  if (willUnpublish) {
    const title = existing.title || "this post";
    if (!window.confirm(`Unpublish "${title}"? Visitors will no longer see it. You can publish it again later.`)) {
      return;
    }
  }

  const payload = collectPayload(status);
  if (!payload) return;

  busy = true;
  setBusy(true);
  setFormMessage(status === "published" ? "Publishing…" : "Saving draft…");

  try {
    const query = existing
      ? supabaseClient.from("journal_posts").update(payload).eq("id", existing.id)
      : supabaseClient.from("journal_posts").insert(payload);
    const { data, error } = await query.select("*").single();
    if (error) {
      setFormMessage(friendlyError(error), "error");
      return;
    }

    editingId = data.id;
    const loaded = await loadPosts({ quiet: true });
    const saved = posts.find((post) => post.id === data.id) || data;
    fillForm(saved);

    if (loaded && !posts.some((post) => post.id === data.id)) {
      setFormMessage("Saved, but the list could not show it. Check that this account is allowed to read every journal post.", "error");
      return;
    }

    if (status === "published") {
      setFormMessage(existing && existing.status === "published" ? "Published changes saved." : "Published.", "ok");
    } else if (willUnpublish) {
      setFormMessage("Unpublished. The post is a draft again.", "ok");
    } else {
      setFormMessage("Draft saved.", "ok");
    }
  } catch (error) {
    setFormMessage("Could not reach Supabase. Try again.", "error");
  } finally {
    busy = false;
    setBusy(false);
  }
}

function collectPayload(status) {
  const title = titleInput.value.trim();
  const slug = slugify(slugInput.value.trim() || title);
  const excerpt = excerptInput.value.trim();
  const content = contentInput.value.trim();
  const category = categoryInput.value;
  const cover = parseCover(coverInput.value);

  if (selectedCoverFile()) {
    setFormMessage("The image from this device is not uploaded yet. Choose Upload, or clear the file to keep the address as it is.", "error");
    uploadCoverButton.focus();
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
  if (!category) {
    setFormMessage("Choose a category.", "error");
    categoryInput.focus();
    return null;
  }
  if (!cover.ok) {
    setFormMessage("The cover image needs a full http or https address, or leave it blank.", "error");
    coverInput.focus();
    return null;
  }
  if (status === "published" && !content) {
    setFormMessage("Write the post before publishing. You can save a draft without it.", "error");
    contentInput.focus();
    return null;
  }
  if (posts.some((post) => (post.slug || "").toLowerCase() === slug && post.id !== editingId)) {
    setFormMessage("Another post already uses that slug. Choose a different one.", "error");
    slugInput.focus();
    return null;
  }

  const existing = currentPost();
  let publishedAt = existing ? existing.published_at : null;
  if (status === "published" && !publishedAt) {
    publishedAt = new Date().toISOString();
  }

  return {
    title,
    slug,
    excerpt,
    content,
    cover_image: cover.value,
    category,
    status,
    featured: featuredInput.checked,
    published_at: publishedAt,
    updated_at: new Date().toISOString()
  };
}

async function setStatus(post, status) {
  if (busy) return;
  if (status === "draft" && post.status === "published") {
    if (!window.confirm(`Unpublish "${post.title || "this post"}"? Visitors will no longer see it.`)) return;
  }
  if (status === "published" && !String(post.content || "").trim()) {
    fillForm(post, { focus: true });
    setFormMessage("Write the post before publishing. You can save a draft without it.", "error");
    contentInput.focus();
    return;
  }

  const patch = {
    status,
    updated_at: new Date().toISOString()
  };
  if (status === "published" && !post.published_at) {
    patch.published_at = new Date().toISOString();
  }

  busy = true;
  setBusy(true);
  setListMessage(status === "published" ? "Publishing…" : "Unpublishing…");

  try {
    const { data, error } = await supabaseClient
      .from("journal_posts")
      .update(patch)
      .eq("id", post.id)
      .select("*")
      .single();

    if (error) {
      setListMessage(friendlyError(error), "error");
      return;
    }

    await loadPosts({ quiet: true });
    if (editingId === post.id) fillForm(posts.find((item) => item.id === post.id) || data);
    setListMessage(
      status === "published" ? "Published." : "Unpublished. The post is a draft again.",
      "ok"
    );
  } catch (error) {
    setListMessage("Could not reach Supabase. Try again.", "error");
  } finally {
    busy = false;
    setBusy(false);
  }
}

async function setFeatured(post, featured) {
  if (busy) return;
  busy = true;
  setBusy(true);
  setListMessage(featured ? "Featuring…" : "Updating…");

  try {
    const { data, error } = await supabaseClient
      .from("journal_posts")
      .update({
        featured,
        updated_at: new Date().toISOString()
      })
      .eq("id", post.id)
      .select("*")
      .single();

    if (error) {
      setListMessage(friendlyError(error), "error");
      return;
    }

    await loadPosts({ quiet: true });
    if (editingId === post.id) fillForm(posts.find((item) => item.id === post.id) || data);
    setListMessage(featured ? "Post featured." : "Removed from featured.", "ok");
  } catch (error) {
    setListMessage("Could not reach Supabase. Try again.", "error");
  } finally {
    busy = false;
    setBusy(false);
  }
}

async function deletePost(post) {
  if (busy || !post) return;
  const title = post.title || "this post";
  if (!window.confirm(`Delete "${title}"? This cannot be undone.`)) return;

  busy = true;
  setBusy(true);
  setListMessage("Deleting…");

  try {
    const { error } = await supabaseClient
      .from("journal_posts")
      .delete()
      .eq("id", post.id);

    if (error) {
      setListMessage(friendlyError(error), "error");
      return;
    }

    if (editingId === post.id) openNew({ force: true, silent: true });
    await loadPosts({ quiet: true });
    setListMessage("Post deleted.", "ok");
  } catch (error) {
    setListMessage("Could not reach Supabase. Try again.", "error");
  } finally {
    busy = false;
    setBusy(false);
  }
}

function currentPost() {
  if (!editingId) return null;
  return posts.find((post) => post.id === editingId) || null;
}

function formState() {
  return JSON.stringify({
    title: titleInput.value,
    slug: slugInput.value,
    excerpt: excerptInput.value,
    content: contentInput.value,
    category: categoryInput.value,
    cover: coverInput.value,
    featured: featuredInput.checked,
    status: statusInput.value
  });
}

function snapshotForm() {
  savedState = formState();
}

function isDirty() {
  if (selectedCoverFile()) return true;
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
  app.querySelectorAll("button, #cover-file").forEach((control) => {
    control.disabled = isBusy;
  });
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

function setCoverMessage(text, kind) {
  coverMessage.textContent = text || "";
  coverMessage.classList.toggle("is-error", kind === "error");
  coverMessage.classList.toggle("is-ok", kind === "ok");
}

function statusLabel(status) {
  if (status === "published") return "Published";
  if (status === "draft") return "Draft";
  return status || "Draft";
}

function formatWhen(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

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

function extensionOf(name) {
  const base = String(name || "").trim().toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1);
}

function formatBytes(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 0.1) {
    const rounded = mb >= 10 ? mb.toFixed(0) : mb.toFixed(1);
    return rounded + " MB";
  }
  const kb = Math.max(1, Math.round(bytes / 1024));
  return kb + " KB";
}

function validateCoverFile(file) {
  if (!file) {
    return { ok: false, message: "Choose an image from this device, then choose Upload." };
  }
  if (!file.size) {
    return { ok: false, message: "That file is empty. Choose a JPEG, PNG, WebP, or GIF." };
  }
  if (file.size > COVER_MAX_BYTES) {
    return {
      ok: false,
      message: "That image is " + formatBytes(file.size) + ". Covers must be 5 MB or smaller."
    };
  }

  const nameExt = extensionOf(file.name);
  const mime = String(file.type || "").toLowerCase().split(";")[0].trim();
  if (mime === "image/heic" || mime === "image/heif" || nameExt === "heic" || nameExt === "heif") {
    return {
      ok: false,
      message: "HEIC photos need to be saved as JPEG first. Covers can be JPEG, PNG, WebP, or GIF."
    };
  }

  const mimeExt = COVER_MIME_EXT[mime];
  const nameType = COVER_TYPES[nameExt];
  if (mime && !mimeExt) {
    if (mime.indexOf("image/") === 0) {
      return { ok: false, message: "Choose a JPEG, PNG, WebP, or GIF. This image type is not accepted." };
    }
    if (mime !== "application/octet-stream" || !nameType) {
      return { ok: false, message: "Choose a JPEG, PNG, WebP, or GIF. Other file types are not accepted." };
    }
  }

  if (mimeExt) {
    return { ok: true, ext: mimeExt, type: COVER_TYPES[mimeExt] };
  }
  if (nameType) {
    return { ok: true, ext: nameExt === "jpeg" ? "jpg" : nameExt, type: nameType };
  }
  return { ok: false, message: "Choose a JPEG, PNG, WebP, or GIF. Other file types are not accepted." };
}

function coverObjectPath(ext) {
  let id;
  if (window.crypto && typeof crypto.randomUUID === "function") {
    id = crypto.randomUUID();
  } else {
    id = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }
  return "covers/" + id + "." + ext;
}

function friendlyStorageError(error) {
  const message = String((error && (error.message || error.error)) || "");
  const code = String((error && (error.code || error.statusCode || error.status)) || "");
  const detail = message + " " + code;
  if (/NoSuchBucket|Bucket not found/i.test(detail)) {
    return "The journal-covers bucket is not in Supabase yet. Create it with the storage setup, then try the upload again.";
  }
  if (code === "42501" || code === "403" || /row-level security|unauthorized|not authorized|permission denied/i.test(message)) {
    return "Supabase refused the upload. Storage policies need to let this admin write to journal-covers.";
  }
  if (code === "413" || /maximum allowed size|payload too large|entity too large|exceeded/i.test(message)) {
    return "Supabase rejected the file size. Covers must be 5 MB or smaller.";
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
  return message || "The cover could not be uploaded.";
}

function parseCover(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) return { ok: true, value: null };
  let url;
  try {
    url = new URL(trimmed);
  } catch (error) {
    return { ok: false, value: null };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, value: null };
  }
  return { ok: true, value: url.href };
}

function friendlyError(error) {
  if (!error) return "Something went wrong.";
  const code = error.code || "";
  const message = error.message || "Something went wrong.";
  if (code === "23505" || /duplicate key/i.test(message)) {
    return "Another post already uses that slug. Choose a different one.";
  }
  if (code === "42501" || /row-level security/i.test(message)) {
    return "Supabase refused this change. The signed-in account needs permission to manage journal posts.";
  }
  if (code === "PGRST116") {
    return "The change did not return a row. Check that this admin account can read journal posts.";
  }
  return message;
}

init().catch(() => {
  gateMessage.textContent = "The cabinet could not open. Reload the page.";
});
