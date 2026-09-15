function clean(value) {
  return String(value ?? "").trim();
}

function httpsOrigin(value) {
  try {
    const origin = new URL(clean(value)).origin;
    return origin.startsWith("https://") ? origin : "";
  } catch {
    return "";
  }
}

export function serverSupabaseAdminConfig(readEnv) {
  if (typeof readEnv !== "function") {
    return Object.freeze({ configured: false, supabaseUrl: "", secretKey: "" });
  }

  const supabaseUrl = httpsOrigin(readEnv("SUPABASE_URL"));
  const secretKey = clean(readEnv("SUPABASE_SECRET_KEY"));

  if (!supabaseUrl || !secretKey.startsWith("sb_secret_")) {
    return Object.freeze({ configured: false, supabaseUrl: "", secretKey: "" });
  }

  return Object.freeze({ configured: true, supabaseUrl, secretKey });
}
