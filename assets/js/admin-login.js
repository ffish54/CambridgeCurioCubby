
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");

function isAdminUser(user) {
  return Boolean(user && String(user.id).toLowerCase() === String(ADMIN_USER_ID).toLowerCase());
}

supabaseClient.auth.getSession().then(({ data }) => {
  if (data.session && isAdminUser(data.session.user)) {
    loginMessage.textContent = "Opening the cabinet…";
    window.location.replace("admin.html");
  }
}).catch(() => {
  loginMessage.textContent = "";
});

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  loginMessage.textContent = "Signing in...";

  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;

  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password
  });

  if (error) {
    loginMessage.textContent = "Sign-in failed. Check your details.";
    return;
  }

  if (!isAdminUser(data.user)) {
    await supabaseClient.auth.signOut();
    loginMessage.textContent = "This account is not authorised.";
    return;
  }

  window.location.href = "admin.html";
});
