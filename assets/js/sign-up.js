/* Customer sign-up. Email confirmation is required before the account opens.
   Marketing emails stay off unless the box is ticked. */

(function () {
  var form = document.getElementById("sign-up-form");
  var message = document.getElementById("sign-up-message");
  var nameInput = document.getElementById("display-name");
  var emailInput = document.getElementById("email");
  var passwordInput = document.getElementById("password");
  var confirmInput = document.getElementById("confirm-password");
  var consentInput = document.getElementById("marketing-consent");
  var submitButton = document.getElementById("sign-up-submit");
  if (!form || !nameInput || !emailInput || !passwordInput || !confirmInput) return;

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

  if (window.CurioCaptcha) CurioCaptcha.mount(document.getElementById("auth-captcha"));

  supabaseClient.auth.getSession().then(function (result) {
    if (result.data && result.data.session && result.data.session.user) {
      window.location.replace("account.html");
    }
  }).catch(function () {});

  form.addEventListener("submit", async function (event) {
    event.preventDefault();
    if (busy) return;

    var name = nameInput.value.trim();
    var email = emailInput.value.trim();
    var password = passwordInput.value;
    var confirmation = confirmInput.value;
    var marketing = Boolean(consentInput && consentInput.checked);

    if (!name || name.length > 120) {
      setMessage("Add the name you would like us to use. Up to 120 characters.", "error");
      nameInput.focus();
      return;
    }
    if (!isEmail(email) || email.length > 200) {
      setMessage("Enter an email address we can write to.", "error");
      emailInput.focus();
      return;
    }
    if (password.length < 8) {
      setMessage("Use at least 8 characters.", "error");
      passwordInput.focus();
      return;
    }
    if (password !== confirmation) {
      setMessage("Those passwords do not match.", "error");
      confirmInput.focus();
      return;
    }
    if (window.CurioCaptcha && CurioCaptcha.enabled() && !CurioCaptcha.token()) {
      setMessage("Please complete the check, then try again.", "error");
      return;
    }

    var options = {
      emailRedirectTo: ACCOUNT_URL,
      data: {
        display_name: name,
        marketing_consent: marketing
      }
    };
    if (window.CurioCaptcha && CurioCaptcha.enabled()) options.captchaToken = CurioCaptcha.token();

    busy = true;
    if (submitButton) submitButton.disabled = true;
    setMessage("Creating your account…");

    var result = await supabaseClient.auth.signUp({
      email: email,
      password: password,
      options: options
    });
    if (window.CurioCaptcha) CurioCaptcha.reset();

    if (result.error) {
      var text = String(result.error.message || "");
      if (result.error.status === 429 || /rate limit/i.test(text)) {
        setMessage("Too many accounts were started. Wait a little while and try again.", "error");
      } else if (/captcha/i.test(text)) {
        setMessage("The check was not accepted. Please try it again.", "error");
      } else if (/already registered|already been registered|user already/i.test(text)) {
        setMessage("That email already has an account. Sign in, or ask for a reset link.", "error");
      } else if (text && text.length < 180) {
        setMessage(text, "error");
      } else {
        setMessage("We could not create the account. Please try again.", "error");
      }
      busy = false;
      if (submitButton) submitButton.disabled = false;
      return;
    }

    if (result.data && result.data.session) {
      window.location.replace("account.html");
      return;
    }

    form.hidden = true;
    setMessage("Check your email and open the confirmation link. The account stays closed until you do. We will not send shop news unless you ticked the box.", "ok");
  });
})();
