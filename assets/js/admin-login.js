
const loginForm = document.getElementById("login-form");
const loginMessage = document.getElementById("login-message");

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

  if (data.user.id !== ADMIN_USER_ID) {
    await supabaseClient.auth.signOut();
    loginMessage.textContent = "This account is not authorised.";
    return;
  }

  window.location.href = "admin.html";
});
