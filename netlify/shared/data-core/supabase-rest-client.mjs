function clientError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function httpsOrigin(value) {
  try {
    const origin = new URL(String(value || "")).origin;
    if (!origin.startsWith("https://")) throw new Error("HTTPS_REQUIRED");
    return origin;
  } catch {
    throw clientError("SUPABASE_DATA_CORE_URL_INVALID", "Supabase Data Core URL은 HTTPS origin이어야 합니다.");
  }
}

export function createSupabaseDataCoreRestClient({ supabaseUrl, publishableKey, accessToken, fetchImpl = fetch } = {}) {
  const origin = httpsOrigin(supabaseUrl);
  const key = String(publishableKey || "").trim();
  const token = String(accessToken || "").trim();
  if (!key) throw clientError("SUPABASE_DATA_CORE_PUBLISHABLE_KEY_REQUIRED", "Supabase publishable key가 필요합니다.");
  if (!token) throw clientError("SUPABASE_DATA_CORE_ACCESS_TOKEN_REQUIRED", "인증된 사용자 access token이 필요합니다.");
  if (typeof fetchImpl !== "function") throw clientError("SUPABASE_DATA_CORE_FETCH_REQUIRED", "fetch 구현이 필요합니다.");

  return Object.freeze({
    async insert(table, row) {
      const safeTable = String(table || "");
      if (!/^[a-z_]{1,80}$/.test(safeTable)) throw clientError("SUPABASE_DATA_CORE_TABLE_INVALID", "Data Core table 이름이 올바르지 않습니다.");
      const response = await fetchImpl(`${origin}/rest/v1/${safeTable}`, {
        method: "POST",
        headers: {
          apikey: key,
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
          prefer: "return=representation",
        },
        body: JSON.stringify(row),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw clientError("SUPABASE_DATA_CORE_INSERT_FAILED", String(data?.message || data?.hint || "Data Core 저장에 실패했습니다."));
      }
      if (!Array.isArray(data) || data.length !== 1) {
        throw clientError("SUPABASE_DATA_CORE_INSERT_RESPONSE_INVALID", "Data Core 저장 결과가 올바르지 않습니다.");
      }
      return data[0];
    },
  });
}
