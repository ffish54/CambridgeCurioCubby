/* Optional captcha for customer sign-up, sign-in, magic links, and resets.
   The site works with AUTH_CAPTCHA_SITE_KEY left empty. The secret stays
   in the Supabase dashboard. */

(function () {
  var provider = (typeof AUTH_CAPTCHA_PROVIDER === "string" ? AUTH_CAPTCHA_PROVIDER : "").trim().toLowerCase();
  var siteKey = (typeof AUTH_CAPTCHA_SITE_KEY === "string" ? AUTH_CAPTCHA_SITE_KEY : "").trim();
  var widgetId = null;
  var loaded = false;

  function enabled() {
    return (provider === "hcaptcha" || provider === "turnstile") && Boolean(siteKey);
  }

  function mount(element) {
    if (!element) return;
    if (!enabled()) {
      element.hidden = true;
      return;
    }
    element.hidden = false;
    var script = document.createElement("script");
    script.async = true;
    script.defer = true;
    window.curioCaptchaOnload = function () {
      try {
        if (provider === "hcaptcha" && window.hcaptcha) {
          widgetId = window.hcaptcha.render(element, { sitekey: siteKey });
        } else if (provider === "turnstile" && window.turnstile) {
          widgetId = window.turnstile.render(element, { sitekey: siteKey });
        }
        loaded = widgetId !== null && widgetId !== undefined;
      } catch (error) {
        loaded = false;
      }
    };
    script.src = provider === "hcaptcha"
      ? "https://js.hcaptcha.com/1/api.js?onload=curioCaptchaOnload&render=explicit"
      : "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=curioCaptchaOnload&render=explicit";
    document.head.appendChild(script);
  }

  function token() {
    if (!enabled()) return "";
    try {
      if (provider === "hcaptcha" && window.hcaptcha) return window.hcaptcha.getResponse(widgetId) || "";
      if (provider === "turnstile" && window.turnstile) return window.turnstile.getResponse(widgetId) || "";
    } catch (error) {
      return "";
    }
    return "";
  }

  function reset() {
    try {
      if (!enabled() || widgetId === null || widgetId === undefined) return;
      if (provider === "hcaptcha" && window.hcaptcha) window.hcaptcha.reset(widgetId);
      if (provider === "turnstile" && window.turnstile) window.turnstile.reset(widgetId);
    } catch (error) {
      /* The next attempt can ask for the check again. */
    }
  }

  window.CurioCaptcha = {
    enabled: enabled,
    mount: mount,
    token: token,
    reset: reset,
    loaded: function () { return loaded; }
  };
})();
