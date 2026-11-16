/* Customer sign-in: password, magic link, and a reset email.
   No social sign-in. The cabinet has its own page. */

(function () {
  var form = document.getElementById("sign-in-form");
  var message = document.getElementById("sign-in-message");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var submitButton = document.getElementById("sign-in-submit");
  var magicButton = document.getElementById("magic-link");
  var forgotButton = document.getElementById("forgot-password");
  if (!form || !emailInput || !passwordInput) return;

  var busy = false;

  function setMessage(text, kind) {
    if (!message) return;
    message.textContent = text || "";
    message.classList.remove("is-error", "is-ok");
    if (kind) message.classList.add(kind === "error" ? "is-error" : "is-ok");
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  }

  function setBusy(next) {
    busy = next;
    [submitButton, magicButton, forgotButton].forEach(function (button) {
      if (button) button.disabled = next;
    });
  }

  function captchaProblem() {
    if (!window.CurioCaptcha || !CurioCaptcha.enabled()) return "";
    if (!CurioCaptcha.token()) return "Please complete the check, then try again.";
    return "";
  }

  function withCaptcha(options) {
    var next = options || {};
    if (!window.CurioCaptcha || !CurioCaptcha.enabled()) return next;
    next.captchaToken = CurioCaptcha.token();
    return next;
  }

  function afterAttempt() {
    if (window.CurioCaptcha) CurioCaptcha.reset();
  }

  function friendly(error, fallback) {
    var text = String((error && error.message) || "");
    if (error && (error.status === 429 || /rate limit/i.test(text))) {
      return "Too many emails were sent. Wait a little while and try again.";
    }
    if (/captcha/i.test(text)) return "The check was not accepted. Please try it again.";
    if (/email not confirmed/i.test(text)) {
      return "Please confirm your email first. The link is in the message we sent when you created the account.";
    }
    return fallback;
  }

  function goToAccount() {
    window.location.replace("account.html");
  }

  if (window.CurioCaptcha) CurioCaptcha.mount(document.getElementById("auth-captcha"));

  var resetSuccess = new URLSearchParams(window.location.search).get("reset") === "success";

  supabaseClient.auth.getSession().then(function (result) {
    var session = result.data && result.data.session;
    if (session && session.user) {
      goToAccount();
      return;
    }
    if (resetSuccess) {
      setMessage("Password updated. Sign in with your new password.", "ok");
      var url = new URL(window.location.href);
      url.searchParams.delete("reset");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }).catch(function () {
    if (resetSuccess) setMessage("Password updated. Sign in with your new password.", "ok");
  });

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy) return;

    var email = emailInput.value.trim();
    var password = passwordInput.value;
    if (!isEmail(email)) {
      setMessage("Enter the email address on your account.", "error");
      emailInput.focus();
      return;
    }
    if (!password) {
      setMessage("Enter your password.", "error");
      passwordInput.focus();
      return;
    }
    var captcha = captchaProblem();
    if (captcha) {
      setMessage(captcha, "error");
      return;
    }

    setBusy(true);
    setMessage("Signing in…");
    var result = await supabaseClient.auth.signInWithPassword({
      email: email,
      password: password,
      options: withCaptcha({})
    });
    afterAttempt();
    if (result.error || !result.data || !result.data.session) {
      setMessage(friendly(result.error, "Sign-in failed. Check your email and password."), "error");
      setBusy(false);
      return;
    }
    goToAccount();
  });

  if (magicButton) {
    magicButton.addEventListener("click", async function () {
      if (busy) return;
      var email = emailInput.value.trim();
      if (!isEmail(email)) {
        setMessage("Enter your email address, then ask for a sign-in link.", "error");
        emailInput.focus();
        return;
      }
      var captcha = captchaProblem();
      if (captcha) {
        setMessage(captcha, "error");
        return;
      }
      setBusy(true);
      setMessage("Sending a sign-in link…");
      var result = await supabaseClient.auth.signInWithOtp({
        email: email,
        options: withCaptcha({
          emailRedirectTo: ACCOUNT_URL,
          shouldCreateUser: false
        })
      });
      afterAttempt();
      setBusy(false);
      if (result.error && (result.error.status === 429 || /rate limit|captcha/i.test(String(result.error.message || "")))) {
        setMessage(friendly(result.error, "Could not send a sign-in link."), "error");
        return;
      }
      setMessage("If there is an account for that email, a sign-in link is on its way. If you are new here, create an account first.", "ok");
    });
  }

  if (forgotButton) {
    forgotButton.addEventListener("click", async function () {
      if (busy) return;
      var email = emailInput.value.trim();
      if (!isEmail(email)) {
        setMessage("Enter your email address, then ask for a reset link.", "error");
        emailInput.focus();
        return;
      }
      var captcha = captchaProblem();
      if (captcha) {
        setMessage(captcha, "error");
        return;
      }
      setBusy(true);
      setMessage("Sending a reset link…");
      var result = await supabaseClient.auth.resetPasswordForEmail(email, withCaptcha({
        redirectTo: CUSTOMER_RESET_URL
      }));
      afterAttempt();
      setBusy(false);
      if (result.error && (result.error.status === 429 || /rate limit|captcha/i.test(String(result.error.message || "")))) {
        setMessage(friendly(result.error, "Could not send a reset link. Try again in a moment."), "error");
        return;
      }
      setMessage("If that email has an account, a reset link is on its way. Open it to choose a new password.", "ok");
    });
  }
})();
