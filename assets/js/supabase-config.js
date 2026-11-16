
const SUPABASE_URL = "https://etiwnwqovlbcyxfpmpsv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hD7ekgB6pq7f6t4AQik7dA_gGr_eWy0";

// Auth emails must return to the shop domain.
const SHOP_ORIGIN = "https://thecuriocubbyhole.com";
const ACCOUNT_URL = SHOP_ORIGIN + "/account.html";
const CUSTOMER_RESET_URL = SHOP_ORIGIN + "/account-reset.html";
const ADMIN_RESET_URL = SHOP_ORIGIN + "/reset-password.html";

// Optional captcha. Leave both empty and sign-up, sign-in, and password
// reset work without a widget. When Authentication → Attack Protection →
// Enable CAPTCHA is on in Supabase, set the provider to "hcaptcha" or
// "turnstile" and paste the site key from that provider. The secret key
// stays in the Supabase dashboard, not in this file.
const AUTH_CAPTCHA_PROVIDER = "";
const AUTH_CAPTCHA_SITE_KEY = "";

const supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY,
  {
    auth: {
      // Recovery emails put the session in the URL hash (type=recovery), so the
      // link works in any browser. The reset page reads that session itself.
      flowType: "implicit",
      detectSessionInUrl: true,
      persistSession: true,
      autoRefreshToken: true
    }
  }
);

// Your authorised admin account's User UID
const ADMIN_USER_ID = "222043d1-053b-45be-ab39-20216c84ee86";
