
const SUPABASE_URL = "https://etiwnwqovlbcyxfpmpsv.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_hD7ekgB6pq7f6t4AQik7dA_gGr_eWy0";

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
