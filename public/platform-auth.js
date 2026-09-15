(() => {
  const SESSION_KEY = "worklogSupabaseSessionV1";
  const OAUTH_ERROR_KEY = "worklogOAuthErrorV1";
  let cachedConfig = null;

  function normalizeSession(session, fallbackRefreshToken = "") {
    if (!session || typeof session.access_token !== "string" || !session.access_token) return null;
    const refreshToken = typeof session.refresh_token === "string" && session.refresh_token
      ? session.refresh_token
      : fallbackRefreshToken;
    const normalized = {
      access_token: session.access_token,
      ...(refreshToken ? { refresh_token: refreshToken } : {}),
    };
    if (typeof session.token_type === "string") normalized.token_type = session.token_type;
    if (Number.isFinite(Number(session.expires_in))) normalized.expires_in = Number(session.expires_in);
    if (Number.isFinite(Number(session.expires_at))) normalized.expires_at = Number(session.expires_at);
    return normalized;
  }

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return value && typeof value.access_token === "string" ? value : null;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function saveSession(session, fallbackRefreshToken = "") {
    const normalized = normalizeSession(session, fallbackRefreshToken);
    if (!normalized) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function clearOAuthFragment() {
    if (!window.location.hash) return;
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }

  function consumeOAuthRedirect() {
    if (!window.location.hash || window.location.hash.length < 2) return null;
    const params = new URLSearchParams(window.location.hash.slice(1));
    const oauthError = params.get("error_description") || params.get("error");
    const accessToken = params.get("access_token");
    const refreshToken = params.get("refresh_token");

    if (oauthError) {
      sessionStorage.setItem(OAUTH_ERROR_KEY, String(oauthError).slice(0, 400));
      clearOAuthFragment();
      return null;
    }
    if (!accessToken || !refreshToken) return null;

    const session = saveSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      token_type: params.get("token_type") || undefined,
      expires_in: params.get("expires_in") || undefined,
      expires_at: params.get("expires_at") || undefined,
    });
    clearOAuthFragment();
    return session;
  }

  function takeOAuthError() {
    const message = sessionStorage.getItem(OAUTH_ERROR_KEY) || "";
    sessionStorage.removeItem(OAUTH_ERROR_KEY);
    return message;
  }

  async function getConfig() {
    if (cachedConfig) return cachedConfig;
    const response = await fetch("/api/supabase-auth-config", { cache: "no-store" });
    const config = await response.json().catch(() => ({}));
    if (!response.ok || !config?.configured) return null;
    cachedConfig = config;
    return cachedConfig;
  }

  async function request(path, options = {}) {
    const config = await getConfig();
    if (!config) throw new Error("Platform 계정 설정이 아직 준비되지 않았습니다.");
    const response = await fetch(`${config.supabaseUrl}${path}`, {
      ...options,
      headers: {
        apikey: config.publishableKey,
        "content-type": "application/json",
        ...(options.headers || {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(data?.msg || data?.message || "Platform 요청에 실패했습니다."));
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function signUp(email, password) {
    const data = await request("/auth/v1/signup", {
      method: "POST",
      body: JSON.stringify({ email: String(email || "").trim(), password: String(password || "") })
    });
    if (data?.access_token) saveSession(data);
    return data;
  }

  async function signIn(email, password) {
    const data = await request("/auth/v1/token?grant_type=password", {
      method: "POST",
      body: JSON.stringify({ email: String(email || "").trim(), password: String(password || "") })
    });
    saveSession(data);
    return data;
  }

  async function signInWithGoogle() {
    const config = await getConfig();
    if (!config) throw new Error("Google 로그인을 시작할 수 없습니다.");
    const redirectTo = `${window.location.origin}/`;
    const authorizeUrl = new URL(`${config.supabaseUrl}/auth/v1/authorize`);
    authorizeUrl.searchParams.set("provider", "google");
    authorizeUrl.searchParams.set("redirect_to", redirectTo);
    window.location.assign(authorizeUrl.toString());
  }

  async function refreshSession() {
    const previous = readSession();
    if (!previous?.refresh_token) throw new Error("다시 로그인해 주세요.");
    const data = await request("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      body: JSON.stringify({ refresh_token: previous.refresh_token })
    });
    const saved = saveSession(data, previous.refresh_token);
    if (!saved) throw new Error("로그인 세션을 갱신하지 못했습니다.");
    return saved;
  }

  async function bootstrapPersonalWorkspace() {
    const session = readSession();
    if (!session) throw new Error("로그인 후 개인 업무공간을 준비할 수 있습니다.");
    const data = await request("/rest/v1/rpc/bootstrap_personal_workspace", {
      method: "POST",
      headers: { authorization: `Bearer ${session.access_token}` },
      body: "{}"
    });
    const first = Array.isArray(data) ? data[0] : data;
    if (!first?.workspace_id) throw new Error("개인 업무공간을 확인하지 못했습니다.");
    return { workspaceId: String(first.workspace_id) };
  }

  async function currentUser() {
    let session = readSession();
    if (!session) return null;
    try {
      return await request("/auth/v1/user", {
        headers: { authorization: `Bearer ${session.access_token}` }
      });
    } catch {
      try {
        session = await refreshSession();
        return await request("/auth/v1/user", {
          headers: { authorization: `Bearer ${session.access_token}` }
        });
      } catch {
        saveSession(null);
        return null;
      }
    }
  }

  async function isDataCorePrimaryEnabled() {
    const config = await getConfig();
    return Boolean(config?.dataCorePrimaryEnabled && readSession());
  }

  async function signOut() {
    const session = readSession();
    try {
      if (session) await request("/auth/v1/logout?scope=local", { method: "POST", headers: { authorization: `Bearer ${session.access_token}` } });
    } finally {
      saveSession(null);
    }
  }

  consumeOAuthRedirect();

  window.WorklogPlatformAuth = {
    getConfig,
    readSession,
    signUp,
    signIn,
    signInWithGoogle,
    signOut,
    currentUser,
    refreshSession,
    takeOAuthError,
    isDataCorePrimaryEnabled,
    bootstrapPersonalWorkspace
  };
})();
