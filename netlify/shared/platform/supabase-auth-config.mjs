import {worklogDataSchema} from "../data-core/data-schema.mjs";
export function publicSupabaseAuthConfig(readEnv) {
  const supabaseUrl = String(readEnv("SUPABASE_URL") || "").trim().replace(/\/$/, "");
  const publishableKey = String(readEnv("SUPABASE_PUBLISHABLE_KEY") || "").trim();

  if (!supabaseUrl || !publishableKey) {
    return { configured: false, supabaseUrl: "", publishableKey: "", dataCorePrimaryEnabled: false };
  }

  let origin;
  try {
    origin = new URL(supabaseUrl).origin;
  } catch {
    return { configured: false, supabaseUrl: "", publishableKey: "", dataCorePrimaryEnabled: false };
  }

  if (!/^https:\/\//.test(origin)) {
    return { configured: false, supabaseUrl: "", publishableKey: "", dataCorePrimaryEnabled: false };
  }

  let schema;
  try { schema = worklogDataSchema(readEnv); } catch { return { configured:false, supabaseUrl:"", publishableKey:"", dataCorePrimaryEnabled:false }; }
  return {
    ...(schema === "worklog" ? {dataSchema:schema} : {}),
    configured: true,
    supabaseUrl: origin,
    publishableKey,
    dataCorePrimaryEnabled: String(readEnv("WORKLOG_DATA_CORE_PRIMARY_ENABLED") || "").trim().toLowerCase() === "true",
  };
}
