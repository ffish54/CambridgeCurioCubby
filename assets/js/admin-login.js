const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");
const forgotButton = document.getElementById("forgot-password");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const submitButton = loginForm.querySelector("button[type='submit']");

const RESET_REDIRECT_URL = "https://ffish54.github.io/CambridgeCurioCubby/reset-password.html";

function isAdminUser(user) {
  return Boolean(user && String(user.id).toLowerCase() === String(ADMIN_USER_ID).toLowerCase());
}

function setLoginMessage(text, kind) {
  loginMessage.textContent = text;
  loginMessage.classList.remove("is-error", "is-ok");
  if (kind === "error") loginMessage.classList.add("is-error");
  if (kind === "ok") loginMessage.classList.add("is-ok");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function resetRequestMessage(error) {
  const text = String((error && error.message) || "");
  if (error && (error.status === 429 || /rate limit/i.test(text))) {
    return "Too many reset emails were sent. Wait a little while and try again.";
  }
  return "Could not send a reset link. Try again in a moment.";
}

const resetSuccess = new URLSearchParams(window.location.search).get("reset") === "success";

if (window.location.hash === "#forgot") {
  emailInput.focus();
}

supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session && isAdminUser(data.session.user)) {
    setLoginMessage("Opening the cabinet…");
    window.location.replace("admin.html");
    return;
  }

  if (resetSuccess) {
    setLoginMessage("Password updated. Sign in with your new password.", "ok");
    const url = new URL(window.location.href);
    url.searchParams.delete("reset");
    window.history.replaceState(null, "", url.pathname + url.search + url.hash);
  }
}).catch(() => {
  if (resetSuccess) {
    setLoginMessage("Password updated. Sign in with your new password.", "ok");
  }
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  setLoginMessage("Signing in...");
  submitButton.disabled = true;
  forgotButton.disabled = true;

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    setLoginMessage("Sign-in failed. Check your details.", "error");
    submitButton.disabled = false;
    forgotButton.disabled = false;
    return;
  }

  if (!isAdminUser(data.user)) {
    await supabaseClient.auth.signOut();
    setLoginMessage("This account is not authorised.", "error");
    submitButton.disabled = false;
    forgotButton.disabled = false;
    return;
  }

  window.location.href = "admin.html";
});

forgotButton.addEventListener("click", async () => {
  const email = emailInput.value.trim();

  if (!email) {
    setLoginMessage("Enter your email address, then ask for a reset link.", "error");
    emailInput.focus();
    return;
  }

  if (!isEmail(email)) {
    setLoginMessage("Enter the email address you use for the cabinet.", "error");
    emailInput.focus();
    return;
  }

  forgotButton.disabled = true;
  setLoginMessage("Sending a reset link…");

  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: RESET_REDIRECT_URL
  });

  forgotButton.disabled = false;

  if (error) {
    setLoginMessage(resetRequestMessage(error), "error");
    return;
  }

  setLoginMessage("If that email is on the cabinet, a reset link is on its way. Open it to choose a new password.", "ok");
});
