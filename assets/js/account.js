/* Account page: profile, password, offers, export, and deletion.
   A customer only sees their own rows. The cabinet account is sent onwards
   and cannot be deleted from here. */

(function () {
  var gate = document.getElementById("account-gate");
  var app = document.getElementById("account-app");
  var gateMessage = document.getElementById("account-gate-message");
  if (!gate || !app) return;

  var user = null;
  var busy = false;
  var offersViewedAt = null;
  var offersViewedReady = false;
  var offersSeenStamped = false;
  var touchedOfferIds = {};

  function isAdmin(account) {
    if (!account || !account.id || typeof ADMIN_USER_ID !== "string") return false;
    return String(account.id).toLowerCase() === String(ADMIN_USER_ID).toLowerCase();
  }

  function setLine(id, text, kind) {
    var node = document.getElementById(id);
    if (!node) return;
    node.textContent = text || "";
    node.classList.remove("is-error", "is-ok");
    if (kind) node.classList.add(kind === "error" ? "is-error" : "is-ok");
  }

  function money(value) {
    if (window.CurioShop && CurioShop.formatPrice) return CurioShop.formatPrice(value) || "";
    if (value == null || value === "") return "";
    return "£" + value;
  }

  function when(value) {
    if (window.CurioShop && CurioShop.formatWhen) return CurioShop.formatWhen(value);
    return value || "";
  }

  function optionLabel(key) {
    if (window.CurioShop && CurioShop.offerOptionLabel) return CurioShop.offerOptionLabel(key) || key || "";
    return key || "";
  }

  function statusLabel(status) {
    if (status === "new") return "New";
    if (status === "read") return "Read";
    if (status === "accepted") return "Accepted";
    if (status === "declined") return "Declined";
    if (status === "countered") return "Counter-offer";
    if (status === "archived") return "Archived";
    return "Offer";
  }

  function showApp() {
    gate.hidden = true;
    app.hidden = false;
  }

  async function requireUser() {
    var result = await supabaseClient.auth.getSession();
    var session = result.data && result.data.session;
    if (!session || !session.user) {
      window.location.replace("sign-in.html");
      return null;
    }
    if (isAdmin(session.user)) {
      if (gateMessage) gateMessage.textContent = "This is the cabinet account. Opening the cabinet…";
      window.location.replace("admin.html");
      return null;
    }
    return session.user;
  }

  async function loadProfile() {
    var result = await supabaseClient
      .from("profiles")
      .select("display_name, phone, marketing_consent")
      .eq("id", user.id)
      .maybeSingle();
    if (result.error) {
      if (/schema cache|does not exist|could not find the table|PGRST205|42P01/i.test(String(result.error.message || ""))) {
        setLine("profile-message", "Your account page is not switched on yet. Please write to us if this continues.", "error");
      } else {
        setLine("profile-message", "We could not load your profile. Please try again.", "error");
      }
      return;
    }
    var profile = result.data || {};
    var name = document.getElementById("display-name");
    var phone = document.getElementById("phone");
    var consent = document.getElementById("marketing-consent");
    var email = document.getElementById("account-email");
    if (name) name.value = profile.display_name || (user.user_metadata && user.user_metadata.display_name) || "";
    if (phone) phone.value = profile.phone || "";
    if (consent) consent.checked = profile.marketing_consent === true;
    if (email) email.textContent = user.email || "";
  }

  function offerUnseen(offer) {
    if (!offersViewedReady || !offersViewedAt || !offer) return false;
    if (touchedOfferIds[offer.id]) return false;
    if (offer.status !== "accepted" && offer.status !== "declined" && offer.status !== "countered") return false;
    var updated = Date.parse(offer.updated_at || "");
    var seen = Date.parse(offersViewedAt);
    if (Number.isNaN(updated) || Number.isNaN(seen)) return false;
    return updated > seen;
  }

  function showOfferUpdates(count) {
    var updates = document.getElementById("offer-updates");
    if (!updates) return;
    if (count === 1) {
      updates.hidden = false;
      updates.textContent = "One offer has changed since you last looked.";
    } else if (count > 1) {
      updates.hidden = false;
      updates.textContent = count + " offers have changed since you last looked.";
    } else {
      updates.hidden = true;
      updates.textContent = "";
    }
  }

  function renderOffers(offers) {
    var list = document.getElementById("offer-list");
    var empty = document.getElementById("offer-empty");
    if (!list) return;
    list.replaceChildren();
    if (!offers.length) {
      if (empty) empty.hidden = false;
      showOfferUpdates(0);
      return;
    }
    if (empty) empty.hidden = true;
    var unseenCount = 0;
    offers.forEach(function (offer) {
      var item = document.createElement("li");
      item.className = "account-offer";
      item.dataset.offerId = offer.id;

      var title = document.createElement("h3");
      var product = offer.products || null;
      if (product && product.slug) {
        var link = document.createElement("a");
        link.href = "shop.html?item=" + encodeURIComponent(product.slug);
        link.textContent = offer.product_title || "Piece";
        title.append(link);
      } else {
        title.textContent = offer.product_title || "Piece";
      }
      item.append(title);

      var meta = document.createElement("p");
      var pill = document.createElement("span");
      pill.className = "account-pill";
      pill.textContent = statusLabel(offer.status);
      meta.append(pill);
      if (offerUnseen(offer)) {
        unseenCount += 1;
        var updatedPill = document.createElement("span");
        updatedPill.className = "account-pill is-updated";
        updatedPill.textContent = "Updated";
        meta.append(updatedPill);
      }
      meta.append(document.createTextNode(
        [optionLabel(offer.option), money(offer.amount), when(offer.created_at)].filter(Boolean).join(" · ")
      ));
      item.append(meta);

      if (offer.status === "countered" && offer.counter_amount != null) {
        var counter = document.createElement("p");
        counter.textContent = "We can do " + (money(offer.counter_amount) || "another amount") + " for that option.";
        item.append(counter);
        var actions = document.createElement("div");
        actions.className = "account-actions";
        actions.append(makeButton("Accept counter-offer", "accept"), makeButton("Decline counter-offer", "decline", true));
        item.append(actions);
      } else if (offer.status === "accepted") {
        var accepted = document.createElement("p");
        var held = product && product.reserved_until ? when(product.reserved_until) : "";
        accepted.textContent = held
          ? "Accepted. The piece is held for you until " + held + ". If it is not settled by then, it goes back on the shelf."
          : "Accepted. We will be in touch about payment.";
        item.append(accepted);
      }

      if (offer.message) {
        var note = document.createElement("p");
        note.textContent = offer.message;
        item.append(note);
      }
      list.append(item);
    });
    showOfferUpdates(unseenCount);
  }

  function makeButton(text, decision, quiet) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = quiet ? "account-button-quiet" : "account-button";
    button.dataset.decision = decision;
    button.textContent = text;
    return button;
  }

  async function loadOffersViewed() {
    if (offersViewedReady) return;
    var viewed = await supabaseClient
      .from("profiles")
      .select("offers_viewed_at")
      .eq("id", user.id)
      .maybeSingle();
    if (viewed.error) return;
    offersViewedReady = true;
    offersViewedAt = viewed.data && viewed.data.offers_viewed_at ? viewed.data.offers_viewed_at : null;
  }

  async function stampOffersViewed() {
    if (!offersViewedReady || offersSeenStamped) return;
    offersSeenStamped = true;
    await supabaseClient
      .from("profiles")
      .update({ offers_viewed_at: new Date().toISOString() })
      .eq("id", user.id);
  }

  async function loadOffers(options) {
    var quiet = options && options.quiet;
    if (!quiet) setLine("offer-message", "Opening your offers…");
    await loadOffersViewed();
    var embedded = await supabaseClient
      .from("offers")
      .select("id, product_title, amount, option, status, counter_amount, message, created_at, updated_at, products(slug, status, reserved_until)")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (embedded.error) {
      var plain = await supabaseClient
        .from("offers")
        .select("id, product_title, amount, option, status, counter_amount, message, created_at, updated_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false });
      if (plain.error) {
        setLine("offer-message", "We could not load your offers. Please try again.", "error");
        renderOffers([]);
        return;
      }
      renderOffers(plain.data || []);
      if (!quiet) {
        setLine("offer-message", "");
        await stampOffersViewed();
      }
      return;
    }
    renderOffers(embedded.data || []);
    if (!quiet) {
      setLine("offer-message", "");
      await stampOffersViewed();
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (busy) return;
    var name = document.getElementById("display-name").value.trim();
    var phone = document.getElementById("phone").value.trim();
    var consent = document.getElementById("marketing-consent").checked === true;
    if (name.length > 120) {
      setLine("profile-message", "The name needs to be 120 characters or fewer.", "error");
      return;
    }
    if (phone.length > 40) {
      setLine("profile-message", "That phone number is too long.", "error");
      return;
    }
    busy = true;
    setLine("profile-message", "Saving…");
    var payload = {
      display_name: name || null,
      phone: phone || null,
      marketing_consent: consent
    };
    var updated = await supabaseClient.from("profiles").update(payload).eq("id", user.id).select("id");
    if (!updated.error && (!updated.data || !updated.data.length)) {
      payload.id = user.id;
      updated = await supabaseClient.from("profiles").insert(payload).select("id");
    }
    busy = false;
    if (updated.error) {
      setLine("profile-message", "We could not save that. Please try again.", "error");
      return;
    }
    setLine("profile-message", consent
      ? "Saved. We may email you occasionally about new pieces. You can turn that off here at any time."
      : "Saved. We will not send shop news unless you tick the box.", "ok");
  }

  async function changePassword(event) {
    event.preventDefault();
    if (busy || !user.email) return;
    var current = document.getElementById("current-password").value;
    var next = document.getElementById("new-password").value;
    var confirmation = document.getElementById("confirm-password").value;
    if (!current || !next || !confirmation) {
      setLine("password-message", "Enter your current password and the new one twice.", "error");
      return;
    }
    if (next.length < 8) {
      setLine("password-message", "Use at least 8 characters.", "error");
      return;
    }
    if (next !== confirmation) {
      setLine("password-message", "Those new passwords do not match.", "error");
      return;
    }
    busy = true;
    setLine("password-message", "Checking your current password…");
    var signed = await supabaseClient.auth.signInWithPassword({
      email: user.email,
      password: current
    });
    if (signed.error) {
      busy = false;
      setLine("password-message", "That current password was not recognised.", "error");
      return;
    }
    var updated = await supabaseClient.auth.updateUser({ password: next });
    busy = false;
    if (updated.error) {
      var text = String(updated.error.message || "");
      if (/different from the old|same password|should be different/i.test(text)) {
        setLine("password-message", "Choose a password that is different from the current one.", "error");
      } else {
        setLine("password-message", "Could not save that password. Try again.", "error");
      }
      return;
    }
    document.getElementById("password-form").reset();
    setLine("password-message", "Password updated.", "ok");
  }

  async function respond(offerId, decision) {
    if (busy) return;
    var question = decision === "accept"
      ? "Accept this counter-offer? The piece is held for you for 3 days."
      : "Decline this counter-offer? The piece is left as it is.";
    if (!window.confirm(question)) return;
    touchedOfferIds[offerId] = true;
    busy = true;
    setLine("offer-message", decision === "accept" ? "Accepting…" : "Declining…");
    var result = await supabaseClient.rpc("respond_to_counter", {
      offer_id: offerId,
      decision: decision
    });
    busy = false;
    if (result.error) {
      var text = String(result.error.message || "");
      if (/no counter-offer/i.test(text)) setLine("offer-message", "There is no counter-offer waiting on this one.", "error");
      else if (/cannot be reserved|already been sold/i.test(text)) setLine("offer-message", "This piece can no longer be held.", "error");
      else if (/not on your account|sign in/i.test(text)) setLine("offer-message", "Please sign in again, then try that offer.", "error");
      else setLine("offer-message", "We could not update that offer. Please try again.", "error");
      return;
    }
    if (decision === "accept") {
      var held = result.data && result.data.reserved_until ? when(result.data.reserved_until) : "";
      setLine("offer-message", held
        ? "Accepted. The piece is held for you until " + held + "."
        : "Accepted. The piece is held for you for 3 days.", "ok");
    } else {
      setLine("offer-message", "Declined. The piece is left as it is.", "ok");
    }
    await loadOffers({ quiet: true });
  }

  async function exportData() {
    if (busy) return;
    busy = true;
    setLine("data-message", "Preparing your file…");
    var profile = await supabaseClient
      .from("profiles")
      .select("display_name, phone, marketing_consent, created_at, updated_at")
      .eq("id", user.id)
      .maybeSingle();
    var offers = await supabaseClient
      .from("offers")
      .select("id, product_title, amount, option, status, counter_amount, message, phone, created_at, updated_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });
    busy = false;
    if (profile.error || offers.error) {
      setLine("data-message", "We could not prepare your file. Please try again.", "error");
      return;
    }
    var payload = {
      exported_at: new Date().toISOString(),
      account: {
        email: user.email || "",
        email_confirmed_at: user.email_confirmed_at || null
      },
      profile: profile.data || null,
      offers: offers.data || []
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = "curio-cubbyhole-my-data.json";
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    setLine("data-message", "Your file has downloaded.", "ok");
  }

  async function deleteAccount() {
    if (busy || isAdmin(user)) return;
    var typed = document.getElementById("delete-confirm");
    if (!typed || typed.value.trim() !== "DELETE") {
      setLine("data-message", "Type DELETE in the box to confirm.", "error");
      if (typed) typed.focus();
      return;
    }
    if (!window.confirm("Delete your account? This cannot be undone.")) return;
    busy = true;
    setLine("data-message", "Deleting your account…");
    var result = await supabaseClient.rpc("delete_my_account");
    if (result.error) {
      busy = false;
      var text = String(result.error.message || "");
      if (/cannot be deleted/i.test(text)) setLine("data-message", "This account cannot be deleted from the shop page.", "error");
      else if (/does not exist|could not find the function|PGRST202/i.test(text)) {
        setLine("data-message", "Deletion is not switched on yet. Write to curiocubbyhole@gmail.com and we will remove the account.", "error");
      } else {
        setLine("data-message", "We could not delete the account. Write to curiocubbyhole@gmail.com and we will remove it.", "error");
      }
      return;
    }
    try {
      await supabaseClient.auth.signOut({ scope: "local" });
    } catch (error) {
      /* The account is already gone. */
    }
    window.location.replace("index.html");
  }

  function bind() {
    document.getElementById("profile-form").addEventListener("submit", saveProfile);
    document.getElementById("password-form").addEventListener("submit", changePassword);
    document.getElementById("export-data").addEventListener("click", exportData);
    document.getElementById("delete-account").addEventListener("click", deleteAccount);
    document.getElementById("sign-out").addEventListener("click", async function () {
      await supabaseClient.auth.signOut();
      window.location.replace("index.html");
    });
    document.getElementById("offer-list").addEventListener("click", function (event) {
      var button = event.target.closest("button[data-decision]");
      if (!button) return;
      var card = button.closest("[data-offer-id]");
      if (!card) return;
      respond(card.dataset.offerId, button.dataset.decision);
    });
  }

  async function init() {
    try {
      user = await requireUser();
    } catch (error) {
      if (gateMessage) gateMessage.textContent = "We could not check your sign-in. Please try again.";
      return;
    }
    if (!user) return;
    showApp();
    bind();
    try {
      await supabaseClient.rpc("link_guest_offers");
    } catch (error) {
      /* Offers you sent as a guest can still be linked the next time you visit. */
    }
    await loadProfile();
    await loadOffers();
  }

  init();
})();
