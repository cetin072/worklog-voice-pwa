(() => {
  const card = document.getElementById("platformAuthCard");
  const form = document.getElementById("platformAuthForm");
  const email = document.getElementById("platformAuthEmail");
  const password = document.getElementById("platformAuthPassword");
  const status = document.getElementById("platformAuthStatus");
  const signIn = document.getElementById("platformSignIn");
  const signUp = document.getElementById("platformSignUp");
  const signOut = document.getElementById("platformSignOut");
  if (!card || !form || !window.WorklogPlatformAuth) {
    document.body.classList.remove("platform-auth-loading");
    document.body.classList.add("platform-auth-unavailable");
    return;
  }

  function show(message, kind = "") {
    status.textContent = message;
    status.className = `platform-auth-status ${kind}`.trim();
  }

  function setBusy(busy) {
    [signIn, signUp, signOut].forEach((button) => { if (button) button.disabled = busy; });
  }

  function setAuthState(state, user = null) {
    document.body.classList.remove("platform-auth-loading", "platform-signed-out", "platform-signed-in", "platform-legacy-user", "platform-auth-unavailable");
    document.body.classList.add(state);
    card.classList.toggle("is-authenticated", state === "platform-signed-in");
    window.dispatchEvent(new CustomEvent("worklog:platform-auth-changed", { detail: { state, user } }));
  }

  function legacyMode() {
    return window.WorklogAuth?.mode?.() || "unset";
  }

  async function refresh() {
    const config = await window.WorklogPlatformAuth.getConfig().catch(() => null);
    if (!config) {
      card.hidden = true;
      setAuthState("platform-auth-unavailable");
      return;
    }

    const user = await window.WorklogPlatformAuth.currentUser();
    if (!user) {
      card.hidden = false;
      form.hidden = false;
      if (signOut) signOut.hidden = true;
      if (legacyMode() !== "unset") {
        setAuthState("platform-legacy-user");
        show("기존 연결 설정으로 사용 중입니다. 새 계정은 필요할 때 시작할 수 있습니다.");
        return;
      }
      setAuthState("platform-signed-out");
      show("처음이면 무료로 시작하세요. 가입하면 개인 업무공간이 바로 준비됩니다.");
      return;
    }

    form.hidden = true;
    if (signOut) signOut.hidden = true;
    card.hidden = true;
    setAuthState("platform-signed-in", user);
    try {
      await window.WorklogPlatformAuth.bootstrapPersonalWorkspace();
    } catch (error) {
      console.error("개인 업무공간 준비 실패", error);
    }
  }

  async function authenticate(action) {
    setBusy(true);
    try {
      const result = await action(email.value, password.value);
      if (!result?.access_token) {
        show("가입 확인 메일을 보냈습니다. 메일 확인 후 로그인하세요.", "success");
        return;
      }
      await refresh();
    } catch (error) {
      show(error.message || "인증에 실패했습니다.", "error");
    } finally {
      setBusy(false);
    }
  }

  signIn.addEventListener("click", () => authenticate(window.WorklogPlatformAuth.signIn));
  signUp.addEventListener("click", () => authenticate(window.WorklogPlatformAuth.signUp));
  form.addEventListener("submit", (event) => { event.preventDefault(); signIn.click(); });
  signOut?.addEventListener("click", async () => {
    setBusy(true);
    try { await window.WorklogPlatformAuth.signOut(); await refresh(); }
    finally { setBusy(false); }
  });
  refresh().catch(() => {
    document.body.classList.remove("platform-auth-loading");
    document.body.classList.add("platform-auth-unavailable");
  });
})();
