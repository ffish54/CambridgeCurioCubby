/* Header link: "Sign in" until there is a customer session, then "Account". */

(function () {
  var link = document.querySelector("[data-account-nav]");
  if (!link) return;

  function paint(session) {
    var signedIn = Boolean(session && session.user);
    link.textContent = signedIn ? "Account" : "Sign in";
    link.href = signedIn ? "account.html" : "sign-in.html";
    var path = window.location.pathname || "";
    var here = signedIn ? /account\.html$/ : /sign-in\.html$/;
    if (here.test(path)) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }

  if (typeof supabaseClient === "undefined" || !supabaseClient || !supabaseClient.auth) return;

  supabaseClient.auth.getSession().then(function (result) {
    paint(result.data && result.data.session);
  }).catch(function () {
    paint(null);
  });

  supabaseClient.auth.onAuthStateChange(function (_event, session) {
    paint(session);
  });
})();
