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
    async rpc(functionName, body = {}) {
      const safeFunction = String(functionName || "");
      if (!/^[a-z_]{1,80}$/.test(safeFunction) || !body || typeof body !== "object" || Array.isArray(body)) {
        throw clientError("SUPABASE_DATA_CORE_RPC_INVALID", "Data Core RPC 이름 또는 body가 올바르지 않습니다.");
      }
      const response = await fetchImpl(`${origin}/rest/v1/rpc/${safeFunction}`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw clientError("SUPABASE_DATA_CORE_RPC_FAILED", String(data?.message || data?.hint || "Data Core RPC 호출에 실패했습니다."));
      return data;
    },
    async update(table, row, query = {}) {
      const safeTable = String(table || "");
      if (!/^[a-z_]{1,80}$/.test(safeTable) || !row || typeof row !== "object" || Array.isArray(row) || !query || typeof query !== "object" || Array.isArray(query)) {
        throw clientError("SUPABASE_DATA_CORE_UPDATE_INVALID", "Data Core update 대상, row 또는 query가 올바르지 않습니다.");
      }
      const entries = Object.entries(query);
      if (!entries.length || !Object.keys(row).length) {
        throw clientError("SUPABASE_DATA_CORE_UPDATE_INVALID", "Data Core update row과 범위 조건이 필요합니다.");
      }
      const params = new URLSearchParams();
      for (const [name, value] of entries) {
        if (!/^[a-z_]{1,80}$/.test(name) || typeof value !== "string" || value.length > 1000) {
          throw clientError("SUPABASE_DATA_CORE_UPDATE_INVALID", "Data Core update query가 올바르지 않습니다.");
        }
        params.set(name, value);
      }
      const response = await fetchImpl(`${origin}/rest/v1/${safeTable}?${params.toString()}`, {
        method: "PATCH",
        headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw clientError("SUPABASE_DATA_CORE_UPDATE_FAILED", String(data?.message || data?.hint || "Data Core 변경에 실패했습니다."));
      if (!Array.isArray(data)) throw clientError("SUPABASE_DATA_CORE_UPDATE_RESPONSE_INVALID", "Data Core 변경 결과가 올바르지 않습니다.");
      return data;
    },
    async select(table, query = {}) {
      const safeTable = String(table || "");
      if (!/^[a-z_]{1,80}$/.test(safeTable) || !query || typeof query !== "object" || Array.isArray(query)) {
        throw clientError("SUPABASE_DATA_CORE_SELECT_INVALID", "Data Core select 대상 또는 query가 올바르지 않습니다.");
      }
      const params = new URLSearchParams();
      for (const [name, value] of Object.entries(query)) {
        if (!/^[a-z_]{1,80}$/.test(name) || typeof value !== "string" || value.length > 1000) {
          throw clientError("SUPABASE_DATA_CORE_SELECT_INVALID", "Data Core select query가 올바르지 않습니다.");
        }
        params.set(name, value);
      }
      const response = await fetchImpl(`${origin}/rest/v1/${safeTable}?${params.toString()}`, {
        method: "GET",
        headers: { apikey: key, authorization: `Bearer ${token}` },
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw clientError("SUPABASE_DATA_CORE_SELECT_FAILED", String(data?.message || data?.hint || "Data Core 조회에 실패했습니다."));
      if (!Array.isArray(data)) throw clientError("SUPABASE_DATA_CORE_SELECT_RESPONSE_INVALID", "Data Core 조회 결과가 올바르지 않습니다.");
      return data;
    },
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
    async upsert(table, row, conflictColumns = []) {
      const safeTable = String(table || "");
      const columns = Array.isArray(conflictColumns) ? conflictColumns.map(String) : [];
      if (!/^[a-z_]{1,80}$/.test(safeTable) || !columns.length || !columns.every((column) => /^[a-z_]{1,80}$/.test(column))) {
        throw clientError("SUPABASE_DATA_CORE_UPSERT_INVALID", "Data Core upsert 대상 또는 conflict column이 올바르지 않습니다.");
      }
      const response = await fetchImpl(`${origin}/rest/v1/${safeTable}?on_conflict=${encodeURIComponent(columns.join(","))}`, {
        method: "POST",
        headers: { apikey: key, authorization: `Bearer ${token}`, "content-type": "application/json", prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify(row),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw clientError("SUPABASE_DATA_CORE_UPSERT_FAILED", String(data?.message || data?.hint || "Data Core upsert에 실패했습니다."));
      if (!Array.isArray(data) || data.length !== 1) throw clientError("SUPABASE_DATA_CORE_UPSERT_RESPONSE_INVALID", "Data Core upsert 결과가 올바르지 않습니다.");
      return data[0];
    },
  });
}
