(() => {
  const SESSION_KEY = "worklogSupabaseSessionV1";
  let cachedConfig = null;

  function readSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      return value && typeof value.access_token === "string" ? value : null;
    } catch {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function saveSession(session) {
    if (!session || typeof session.access_token !== "string") {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return session;
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
    if (!response.ok) throw new Error(String(data?.msg || data?.message || "Platform 요청에 실패했습니다."));
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
    const session = readSession();
    if (!session) return null;
    try {
      return await request("/auth/v1/user", {
        headers: { authorization: `Bearer ${session.access_token}` }
      });
    } catch {
      saveSession(null);
      return null;
    }
  }

  async function signOut() {
    const session = readSession();
    try {
      if (session) await request("/auth/v1/logout?scope=local", { method: "POST", headers: { authorization: `Bearer ${session.access_token}` } });
    } finally {
      saveSession(null);
    }
  }

  window.WorklogPlatformAuth = {
    getConfig,
    readSession,
    signUp,
    signIn,
    signOut,
    currentUser,
    bootstrapPersonalWorkspace
  };
})();
