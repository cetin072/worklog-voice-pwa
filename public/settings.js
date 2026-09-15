(() => {
  const APP_URL = "https://worklog-voice-pwa.netlify.app/";
  const PREF_KEY = "worklogUiPreferencesV1";
  const DEFAULT_PREFS = Object.freeze({
    briefingExpanded: false,
    entryDetailsExpanded: false,
  });
  let deferredInstallPrompt = null;

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

  function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  }

  function isIos() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function updateInstallUi() {
    const installGuide = document.getElementById("settingsInstallGuide");
    const installAction = document.getElementById("settingsInstallAction");
    const installStatus = document.getElementById("settingsInstallStatus");
    if (!installGuide || !installAction) return;

    if (isStandalone()) {
      installGuide.textContent = "이 기기에는 이미 업무수첩이 앱처럼 설치되어 있습니다.";
      installAction.textContent = "설치됨";
      installAction.disabled = true;
      if (installStatus) installStatus.textContent = "";
      return;
    }

    installAction.disabled = false;
    if (deferredInstallPrompt) {
      installGuide.textContent = "버튼을 누르면 브라우저의 앱 설치 확인창이 열립니다. 확인하면 홈 화면에 업무수첩 아이콘이 추가됩니다.";
      installAction.textContent = "홈 화면에 앱 설치";
      return;
    }

    if (isIos()) {
      installGuide.textContent = "iPhone/iPad는 웹사이트가 설치를 자동 완료할 수 없어서 마지막 단계는 직접 눌러야 합니다.";
      installAction.textContent = "iPhone 설치 방법 보기";
      return;
    }

    if (isAndroid()) {
      installGuide.textContent = "설치 버튼이 지원되는 브라우저에서는 바로 설치 확인창을 열 수 있습니다. 아직 준비되지 않았다면 Chrome 메뉴의 ‘앱 설치’도 사용할 수 있습니다.";
      installAction.textContent = "홈 화면에 앱 설치";
      return;
    }

    installGuide.textContent = "지원되는 브라우저에서는 버튼으로 설치 확인창을 열 수 있습니다. 설치 버튼이 동작하지 않으면 브라우저 메뉴의 ‘앱 설치’를 사용하세요.";
    installAction.textContent = "앱 설치";
  }

  function wireInstall() {
    const installGuide = document.getElementById("settingsInstallGuide");
    const installAction = document.getElementById("settingsInstallAction");
    const installStatus = document.getElementById("settingsInstallStatus");
    if (!installAction) return;

    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      deferredInstallPrompt = event;
      updateInstallUi();
    });

    window.addEventListener("appinstalled", () => {
      deferredInstallPrompt = null;
      if (installStatus) installStatus.textContent = "업무수첩 설치가 완료되었습니다.";
      updateInstallUi();
    });

    installAction.addEventListener("click", async () => {
      if (isStandalone()) {
        updateInstallUi();
        return;
      }

      if (isIos()) {
        if (installGuide) {
          installGuide.textContent = "iPhone/iPad 설치: 브라우저의 공유 버튼 → ‘홈 화면에 추가’ → ‘웹 앱으로 열기’ 확인 → ‘추가’를 누르세요.";
        }
        if (installStatus) installStatus.textContent = "Apple 정책상 이 마지막 확인 절차는 자동화할 수 없습니다.";
        return;
      }

      if (!deferredInstallPrompt) {
        if (installStatus) {
          installStatus.textContent = isAndroid()
            ? "현재 브라우저가 설치 확인창을 아직 제공하지 않았습니다. Chrome 메뉴(⋮)의 ‘앱 설치’ 또는 ‘홈 화면에 추가’를 사용해 주세요."
            : "현재 브라우저에서는 자동 설치 확인창을 열 수 없습니다. 브라우저 메뉴의 ‘앱 설치’를 사용해 주세요.";
        }
        return;
      }

      installAction.disabled = true;
      try {
        const promptEvent = deferredInstallPrompt;
        deferredInstallPrompt = null;
        const result = await promptEvent.prompt();
        const outcome = result?.outcome || (promptEvent.userChoice ? (await promptEvent.userChoice)?.outcome : "");
        if (installStatus) {
          installStatus.textContent = outcome === "accepted"
            ? "설치를 승인했습니다. 홈 화면에서 업무수첩을 열 수 있습니다."
            : "설치를 취소했습니다. 필요할 때 다시 설치할 수 있습니다.";
        }
      } catch {
        if (installStatus) installStatus.textContent = "설치 확인창을 열지 못했습니다. 브라우저 메뉴의 ‘앱 설치’를 사용해 주세요.";
      } finally {
        installAction.disabled = false;
        updateInstallUi();
      }
    });

    updateInstallUi();
  }

  async function refreshAccount() {
    const accountState = document.getElementById("settingsAccountState");
    const loginLink = document.getElementById("settingsLoginLink");
    const logoutSection = document.getElementById("settingsLogoutSection");
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
  wireInstall();
  wireShare();
  wireLogout();
  refreshAccount().catch(() => {});
  window.addEventListener("worklog:platform-auth-changed", () => refreshAccount().catch(() => {}));

  window.WorklogUiPreferences = Object.freeze({ read: readPreferences, save: savePreferences });
})();
