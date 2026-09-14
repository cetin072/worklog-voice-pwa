function resolverError(code, message) {
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
    throw resolverError("SUPABASE_WORKSPACE_URL_INVALID", "Supabase Data Core URL은 HTTPS origin이어야 합니다.");
  }
}

export function createSupabaseWorkspaceContextResolver({ supabaseUrl, publishableKey, fetchImpl = fetch } = {}) {
  const origin = httpsOrigin(supabaseUrl);
  const key = String(publishableKey || "").trim();
  if (!key) throw resolverError("SUPABASE_WORKSPACE_PUBLISHABLE_KEY_REQUIRED", "Supabase publishable key가 필요합니다.");
  if (typeof fetchImpl !== "function") throw resolverError("SUPABASE_WORKSPACE_FETCH_REQUIRED", "Supabase fetch 구현이 필요합니다.");

  async function request(path, accessToken, options = {}) {
    const token = String(accessToken || "").trim();
    if (!token) throw resolverError("SUPABASE_WORKSPACE_ACCESS_TOKEN_REQUIRED", "인증된 사용자 access token이 필요합니다.");
    const response = await fetchImpl(`${origin}${path}`, {
      ...options,
      headers: { apikey: key, authorization: `Bearer ${token}`, ...(options.headers || {}) },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw resolverError("SUPABASE_WORKSPACE_AUTH_FAILED", String(data?.msg || data?.message || "Platform 계정을 확인하지 못했습니다."));
    return data;
  }

  return Object.freeze({
    async resolve(accessToken) {
      const user = await request("/auth/v1/user", accessToken);
      const userId = String(user?.id || "").trim();
      if (!userId) throw resolverError("SUPABASE_WORKSPACE_USER_INVALID", "Platform 사용자 정보가 올바르지 않습니다.");
      const result = await request("/rest/v1/rpc/bootstrap_personal_workspace", accessToken, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const first = Array.isArray(result) ? result[0] : result;
      const workspaceId = String(first?.workspace_id || "").trim();
      if (!workspaceId) throw resolverError("SUPABASE_WORKSPACE_BOOTSTRAP_INVALID", "개인 업무공간을 확인하지 못했습니다.");
      return Object.freeze({ userId, workspaceId, role: "owner" });
    },
  });
}
