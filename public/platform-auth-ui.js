(() => {
  const card = document.getElementById("platformAuthCard");
  const form = document.getElementById("platformAuthForm");
  const email = document.getElementById("platformAuthEmail");
  const password = document.getElementById("platformAuthPassword");
  const status = document.getElementById("platformAuthStatus");
  const signIn = document.getElementById("platformSignIn");
  const signUp = document.getElementById("platformSignUp");
  const signOut = document.getElementById("platformSignOut");
  if (!card || !form || !window.WorklogPlatformAuth) return;

  function show(message, kind = "") {
    status.textContent = message;
    status.className = `platform-auth-status ${kind}`.trim();
  }

  function setBusy(busy) {
    [signIn, signUp, signOut].forEach((button) => { if (button) button.disabled = busy; });
  }

  async function refresh() {
    const config = await window.WorklogPlatformAuth.getConfig();
    if (!config) return;
    card.hidden = false;
    const user = await window.WorklogPlatformAuth.currentUser();
    if (!user) {
      form.hidden = false;
      signOut.hidden = true;
      show("Platform 계정으로 로그인하거나 가입하세요. 기존 Notion 연결은 그대로 유지됩니다.");
      return;
    }
    form.hidden = true;
    signOut.hidden = false;
    show("개인 업무공간을 확인하는 중…");
    try {
      await window.WorklogPlatformAuth.bootstrapPersonalWorkspace();
      show(`${user.email || "로그인한 사용자"}의 개인 업무공간이 준비되었습니다.`, "success");
    } catch (error) {
      show(error.message || "개인 업무공간 준비에 실패했습니다.", "error");
    }
  }

  async function authenticate(action) {
    setBusy(true);
    try {
      const result = await action(email.value, password.value);
      if (!result?.access_token) {
        show("가입 확인 메일을 보냈습니다. 확인 후 로그인하세요.", "success");
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
  signOut.addEventListener("click", async () => {
    setBusy(true);
    try { await window.WorklogPlatformAuth.signOut(); await refresh(); }
    finally { setBusy(false); }
  });
  refresh().catch(() => {});
})();
