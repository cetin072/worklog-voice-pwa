export function publicSupabaseAuthConfig(readEnv) {
  const supabaseUrl = String(readEnv("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const publishableKey = String(readEnv("SUPABASE_PUBLISHABLE_KEY") || "").trim();

  if (!supabaseUrl || !publishableKey) {
    return { configured: false, supabaseUrl: "", publishableKey: "" };
  }

  let origin;
  try {
    origin = new URL(supabaseUrl).origin;
  } catch {
    return { configured: false, supabaseUrl: "", publishableKey: "" };
  }

  if (!/^https:\/\//.test(origin)) {
    return { configured: false, supabaseUrl: "", publishableKey: "" };
  }

  return { configured: true, supabaseUrl: origin, publishableKey };
}
