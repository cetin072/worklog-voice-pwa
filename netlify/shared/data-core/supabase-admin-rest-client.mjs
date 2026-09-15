function adminClientError(code, message) {
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
    throw adminClientError("SUPABASE_ADMIN_URL_INVALID", "Supabase admin URL은 HTTPS origin이어야 합니다.");
  }
}

function requireSecret(value) {
  const key = String(value || "").trim();
  if (!key.startsWith("sb_secret_")) {
    throw adminClientError("SUPABASE_ADMIN_SECRET_REQUIRED", "서버 전용 Supabase secret key가 필요합니다.");
  }
  return key;
}

function safeTable(value) {
  const table = String(value || "");
  if (!/^[a-z_]{1,80}$/.test(table)) throw adminClientError("SUPABASE_ADMIN_TABLE_INVALID", "table 이름이 올바르지 않습니다.");
  return table;
}

function sortedJson(value) {
  if (Array.isArray(value)) return value.map(sortedJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortedJson(value[key])]));
}

function equivalentValue(expected, actual) {
  if (expected === null || expected === undefined) return actual === null || actual === undefined;
  if (typeof expected === "number") return Number(actual) === expected;
  if (typeof expected === "object") return JSON.stringify(sortedJson(expected)) === JSON.stringify(sortedJson(actual));
  return String(actual ?? "") === String(expected);
}

function rowsEquivalent(expected, actual) {
  return Object.entries(expected)
    .filter(([key]) => key !== "created_at")
    .every(([key, value]) => equivalentValue(value, actual?.[key]));
}

async function jsonOrEmpty(response) {
  return response.json().catch(() => null);
}

export function createSupabaseAdminRestClient({ supabaseUrl, secretKey, fetchImpl = fetch } = {}) {
  const origin = httpsOrigin(supabaseUrl);
  const key = requireSecret(secretKey);
  if (typeof fetchImpl !== "function") throw adminClientError("SUPABASE_ADMIN_FETCH_REQUIRED", "fetch 구현이 필요합니다.");

  const headers = (extra = {}) => ({ apikey: key, ...extra });

  return Object.freeze({
    configured: true,

    async insertUsageEventIdempotent(row) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !row.workspace_id || !row.event_key) {
        throw adminClientError("SUPABASE_ADMIN_USAGE_ROW_INVALID", "Usage Event row가 올바르지 않습니다.");
      }

      const response = await fetchImpl(
        `${origin}/rest/v1/usage_events?on_conflict=${encodeURIComponent("workspace_id,event_key")}`,
        {
          method: "POST",
          headers: headers({
            "content-type": "application/json",
            prefer: "resolution=ignore-duplicates,return=representation",
          }),
          body: JSON.stringify(row),
        },
      );
      const data = await jsonOrEmpty(response);
      if (!response.ok) {
        throw adminClientError("SUPABASE_ADMIN_USAGE_WRITE_FAILED", "Usage Event 저장에 실패했습니다.");
      }
      if (Array.isArray(data) && data.length === 1) return data[0];
      if (!Array.isArray(data) || data.length !== 0) {
        throw adminClientError("SUPABASE_ADMIN_USAGE_RESPONSE_INVALID", "Usage Event 저장 결과가 올바르지 않습니다.");
      }

      const params = new URLSearchParams({
        workspace_id: `eq.${row.workspace_id}`,
        event_key: `eq.${row.event_key}`,
        select: "*",
      });
      const existingResponse = await fetchImpl(`${origin}/rest/v1/usage_events?${params.toString()}`, {
        method: "GET",
        headers: headers(),
      });
      const existing = await jsonOrEmpty(existingResponse);
      if (!existingResponse.ok || !Array.isArray(existing) || existing.length !== 1) {
        throw adminClientError("SUPABASE_ADMIN_USAGE_CONFLICT_LOOKUP_FAILED", "기존 Usage Event 확인에 실패했습니다.");
      }
      if (!rowsEquivalent(row, existing[0])) {
        throw adminClientError("DATA_CORE_USAGE_EVENT_CONFLICT", "같은 event key에 서로 다른 Usage Event가 존재합니다.");
      }
      return existing[0];
    },

    async upsertSharedCostPool(row) {
      if (!row || typeof row !== "object" || Array.isArray(row) || !row.month_start || !row.cost_key) {
        throw adminClientError("SUPABASE_ADMIN_SHARED_COST_ROW_INVALID", "Shared Cost row가 올바르지 않습니다.");
      }
      const response = await fetchImpl(
        `${origin}/rest/v1/${safeTable("shared_cost_pools")}?on_conflict=${encodeURIComponent("month_start,cost_key")}`,
        {
          method: "POST",
          headers: headers({
            "content-type": "application/json",
            prefer: "resolution=merge-duplicates,return=representation",
          }),
          body: JSON.stringify(row),
        },
      );
      const data = await jsonOrEmpty(response);
      if (!response.ok || !Array.isArray(data) || data.length !== 1) {
        throw adminClientError("SUPABASE_ADMIN_SHARED_COST_UPSERT_FAILED", "Shared Cost 저장에 실패했습니다.");
      }
      return data[0];
    },

    async recalculateSharedCostAllocations(monthStart) {
      const month = String(monthStart || "").trim();
      if (!/^\d{4}-\d{2}-01$/.test(month)) {
        throw adminClientError("SUPABASE_ADMIN_SHARED_COST_MONTH_INVALID", "Shared Cost 재계산 월이 올바르지 않습니다.");
      }
      const response = await fetchImpl(`${origin}/rest/v1/rpc/recalculate_shared_cost_allocations`, {
        method: "POST",
        headers: headers({ "content-type": "application/json" }),
        body: JSON.stringify({ p_month_start: month }),
      });
      const data = await jsonOrEmpty(response);
      if (!response.ok || (!Number.isInteger(data) && typeof data !== "number")) {
        throw adminClientError("SUPABASE_ADMIN_SHARED_COST_RECALCULATE_FAILED", "Shared Cost 재계산에 실패했습니다.");
      }
      return Number(data);
    },
  });
}
