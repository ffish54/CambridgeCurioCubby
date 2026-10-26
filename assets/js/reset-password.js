const resetForm = document.getElementById("reset-form");
const resetMessage = document.getElementById("reset-message");
const resetIntro = document.getElementById("reset-intro");
const passwordInput = document.getElementById("password");
const confirmInput = document.getElementById("confirm-password");
const submitButton = document.getElementById("save-password");
const requestAgain = document.getElementById("request-again");

const MIN_PASSWORD_LENGTH = 8;
const callback = window.__authCallback || {};

let phase = "checking";

function clientReady() {
  return typeof supabaseClient !== "undefined" && supabaseClient && supabaseClient.auth;
}

function setResetMessage(text, kind) {
  resetMessage.textContent = text;
  resetMessage.classList.remove("is-error", "is-ok");
  if (kind === "error") resetMessage.classList.add("is-error");
  if (kind === "ok") resetMessage.classList.add("is-ok");
}

function hasRecoveryMarker(details) {
  if (!details) return false;
  if (details.type && details.type !== "recovery") return false;
  if (details.type === "recovery") return true;
  if (details.code) return true;
  if (details.tokenHash) return true;
  if (details.accessToken && details.refreshToken) return true;
  return false;
}

function describeCallbackError(details) {
  const description = details.errorDescription || "";
  const code = `${details.errorCode || ""} ${details.error || ""}`;
  if (/otp_expired|expired/i.test(code) || /expired/i.test(description)) {
    return "This reset link has expired. Request a new one from the sign-in page.";
  }
  if (/invalid|access_denied|otp_disabled/i.test(code) || /invalid|already been used/i.test(description)) {
    return "This reset link is invalid or has already been used. Request a new one from the sign-in page.";
  }
  if (description) return description;
  return "This reset link could not be opened. Request a new one from the sign-in page.";
}

function describeUpdateError(error) {
  const text = String((error && error.message) || "");
  if (/session/i.test(text) || (error && error.name === "AuthSessionMissingError")) {
    return "This reset link is no longer active. Request a new one from the sign-in page.";
  }
  if (/different from the old|same password|should be different/i.test(text)) {
    return "Choose a password that is different from the current one.";
  }
  if (text && text.length < 180) return text;
  return "Could not save that password. Try again.";
}

function sessionCameFromLink(session) {
  if (!session) return false;
  if (callback.accessToken && session.access_token === callback.accessToken) return true;
  if (!callback.previousAccessToken) return true;
  if (session.access_token && session.access_token !== callback.previousAccessToken) return true;
  return false;
}

function showRequestAgain(show) {
  if (!requestAgain) return;
  requestAgain.hidden = !show;
}

function rememberUsername() {
  supabaseClient.auth.getSession().then(({ data }) => {
    const email = data.session && data.session.user && data.session.user.email;
    const username = document.getElementById("username");
    if (email && username) username.value = email;
  }).catch(() => {});
}

function showReady() {
  if (phase === "ready" || phase === "done") return;
  phase = "ready";
  resetIntro.textContent = "Choose a new password for the cabinet. You will sign in with it afterwards.";
  resetForm.hidden = false;
  showRequestAgain(false);
  setResetMessage("");
  rememberUsername();
  passwordInput.focus();
}

function showIdle() {
  if (phase === "ready" || phase === "done") return;
  phase = "idle";
  resetIntro.textContent = "Open the reset link in your email to choose a new password.";
  resetForm.hidden = true;
  showRequestAgain(true);
  setResetMessage("Request a link from the sign-in page, then follow it here.");
}

function showError(text) {
  if (phase === "ready" || phase === "done") return;
  phase = "error";
  resetIntro.textContent = "This reset link did not open a session.";
  resetForm.hidden = true;
  showRequestAgain(true);
  setResetMessage(text, "error");
}

function stripAuthParams() {
  const url = new URL(window.location.href);
  [
    "access_token",
    "refresh_token",
    "expires_in",
    "expires_at",
    "token_type",
    "type",
    "code",
    "token_hash",
    "error",
    "error_code",
    "error_description"
  ].forEach((key) => url.searchParams.delete(key));
  url.hash = "";
  window.history.replaceState(null, "", url.pathname + url.search);
}

if (clientReady()) {
  supabaseClient.auth.onAuthStateChange((event, session) => {
    if (event === "PASSWORD_RECOVERY" && session) {
      showReady();
    }
  });
}

async function init() {
  if (!clientReady()) {
    showError("Supabase did not load. Check the connection and reload.");
    return;
  }

  let session = null;

  try {
    const first = await supabaseClient.auth.getSession();
    session = first.data.session;
    await new Promise((resolve) => setTimeout(resolve, 0));
  } catch (error) {
    session = null;
  }

  stripAuthParams();

  if (phase === "ready") return;

  if (callback.error || callback.errorDescription || callback.errorCode) {
    showError(describeCallbackError(callback));
    return;
  }

  try {
    if (callback.tokenHash && (!callback.type || callback.type === "recovery")) {
      const verified = await supabaseClient.auth.verifyOtp({
        token_hash: callback.tokenHash,
        type: "recovery"
      });
      if (verified.error || !verified.data.session) {
        showError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
        return;
      }
      showReady();
      return;
    }

    if (!session) {
      const again = await supabaseClient.auth.getSession();
      session = again.data.session;
    }

    if (hasRecoveryMarker(callback) && sessionCameFromLink(session)) {
      showReady();
      return;
    }

    if (hasRecoveryMarker(callback)) {
      showError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
      return;
    }

    showIdle();
  } catch (error) {
    showError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
  }
}

resetForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (phase !== "ready") return;

  const password = passwordInput.value;
  const confirmation = confirmInput.value;

  if (!password || !confirmation) {
    setResetMessage("Enter your new password twice.", "error");
    return;
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    setResetMessage("Use at least 8 characters.", "error");
    passwordInput.focus();
    return;
  }

  if (password !== confirmation) {
    setResetMessage("Those passwords do not match.", "error");
    confirmInput.focus();
    return;
  }

  submitButton.disabled = true;
  setResetMessage("Saving your new password…");

  const { error } = await supabaseClient.auth.updateUser({ password });

  if (error) {
    setResetMessage(describeUpdateError(error), "error");
    submitButton.disabled = false;
    return;
  }

  phase = "done";
  resetForm.hidden = true;
  setResetMessage("Password updated. Returning you to sign in…", "ok");

  try {
    await supabaseClient.auth.signOut({ scope: "local" });
  } catch (signOutError) {
    // The password is already saved. Sign-in replaces this browser session.
  }

  window.location.replace("admin-login.html?reset=success");
});

init();
