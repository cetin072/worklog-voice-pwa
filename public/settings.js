(() => {
  const APP_URL = "https://worklog-voice-pwa.netlify.app/";
  const PREF_KEY = "worklogUiPreferencesV1";
  const DEFAULT_PREFS = Object.freeze({
    briefingExpanded: false,
    entryDetailsExpanded: false,
  });

  function readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      return {
        briefingExpanded: stored?.briefingExpanded === true,
        entryDetailsExpanded: stored?.entryDetailsExpanded === true,
      };
    } catch {
      return { ...DEFAULT_PREFS };
    }
  }

  function savePreferences(next) {
    const value = { ...readPreferences(), ...next };
    localStorage.setItem(PREF_KEY, JSON.stringify(value));
    window.dispatchEvent(new CustomEvent("worklog:ui-preferences-changed", { detail: value }));
    return value;
  }

  function applyPagePreferences() {
    const prefs = readPreferences();
    const extraDetails = document.getElementById("entryExtraDetails");
    if (extraDetails) extraDetails.open = prefs.entryDetailsExpanded;
    return prefs;
  }

  function installationText() {
    if (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true) {
      return "이 기기에는 이미 업무수첩이 앱처럼 설치되어 있습니다.";
    }
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/i.test(ua)) {
      return "iPhone/iPad: Safari의 공유 버튼을 누른 뒤 ‘홈 화면에 추가’를 선택하세요.";
    }
    if (/Android/i.test(ua)) {
      return "Android: Chrome 메뉴(⋮)에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택하세요.";
    }
    return "브라우저 메뉴에서 ‘홈 화면에 추가’ 또는 ‘앱 설치’를 선택하면 일반 앱처럼 바로 열 수 있습니다.";
  }

  async function refreshAccount() {
    const accountState = document.getElementById("settingsAccountState");
    const loginLink = document.getElementById("settingsLoginLink");
    const logoutSection = document.getElementById("settingsLogoutSection");
    const installGuide = document.getElementById("settingsInstallGuide");
    if (installGuide) installGuide.textContent = installationText();
    if (!accountState) return;

    const auth = window.WorklogPlatformAuth;
    if (!auth) {
      accountState.textContent = "계정 기능을 확인하지 못했습니다.";
      if (loginLink) loginLink.hidden = false;
      if (logoutSection) logoutSection.hidden = true;
      return;
    }

    const session = auth.readSession?.();
    if (!session) {
      accountState.textContent = "현재 로그인되어 있지 않습니다.";
      if (loginLink) loginLink.hidden = false;
      if (logoutSection) logoutSection.hidden = true;
      return;
    }

    const user = await auth.currentUser().catch(() => null);
    if (!user) {
      accountState.textContent = "로그인 세션이 만료되었습니다. 다시 로그인해주세요.";
      if (loginLink) loginLink.hidden = false;
      if (logoutSection) logoutSection.hidden = true;
      return;
    }

    accountState.textContent = user?.email
      ? `${user.email} 계정으로 사용 중입니다.`
      : "업무수첩 계정으로 로그인되어 있습니다.";
    if (loginLink) loginLink.hidden = true;
    if (logoutSection) logoutSection.hidden = false;
  }

  function wirePreferenceControls() {
    const briefing = document.getElementById("settingsBriefingExpanded");
    const entry = document.getElementById("settingsEntryDetailsExpanded");
    const prefs = readPreferences();
    if (briefing) briefing.checked = prefs.briefingExpanded;
    if (entry) entry.checked = prefs.entryDetailsExpanded;

    briefing?.addEventListener("change", () => {
      savePreferences({ briefingExpanded: briefing.checked });
    });
    entry?.addEventListener("change", () => {
      savePreferences({ entryDetailsExpanded: entry.checked });
    });
  }

  function wireShare() {
    const shareButton = document.getElementById("settingsShare");
    const shareStatus = document.getElementById("settingsShareStatus");
    shareButton?.addEventListener("click", async () => {
      if (shareStatus) shareStatus.textContent = "";
      try {
        if (navigator.share) {
          await navigator.share({
            title: "업무수첩",
            text: "말하거나 입력하면 업무와 일정을 놓치지 않게 정리해주는 개인 업무수첩",
            url: APP_URL,
          });
          if (shareStatus) shareStatus.textContent = "공유 화면을 열었습니다.";
          return;
        }
        await navigator.clipboard.writeText(APP_URL);
        if (shareStatus) shareStatus.textContent = "업무수첩 링크를 복사했습니다.";
      } catch (error) {
        if (error?.name === "AbortError") return;
        if (shareStatus) shareStatus.textContent = `링크: ${APP_URL}`;
      }
    });
  }

  function wireLogout() {
    const logout = document.getElementById("settingsLogout");
    logout?.addEventListener("click", async () => {
      if (!window.confirm("이 기기에서 업무수첩 계정을 로그아웃할까요?")) return;
      logout.disabled = true;
      try {
        await window.WorklogPlatformAuth?.signOut?.();
        window.location.href = "/";
      } finally {
        logout.disabled = false;
      }
    });
  }

  applyPagePreferences();
  wirePreferenceControls();
  wireShare();
  wireLogout();
  refreshAccount().catch(() => {});
  window.addEventListener("worklog:platform-auth-changed", () => refreshAccount().catch(() => {}));

  window.WorklogUiPreferences = Object.freeze({ read: readPreferences, save: savePreferences });
})();
