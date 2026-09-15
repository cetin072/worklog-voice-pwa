(() => {
  const APP_URL = "https://worklog-voice-pwa.netlify.app/";
  const PREF_KEY = "worklogUiPreferencesV1";
  const DEFAULT_PREFS = Object.freeze({
    briefingCollapsed: false,
  });
  let deferredInstallPrompt = null;

  function readPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      return {
        briefingCollapsed: stored?.briefingCollapsed === true,
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

  function sanitizeLegacyDraftExtras() {
    if (!document.getElementById("entryCompatibilityFields")) return;
    try {
      const raw = localStorage.getItem("worklogDraftV1");
      if (!raw) return;
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return;
      const next = { ...draft, amount: "", assignee: "", dueDate: "", followUp: "" };
      localStorage.setItem("worklogDraftV1", JSON.stringify(next));
    } catch {}
  }

  function applyPagePreferences() {
    sanitizeLegacyDraftExtras();
    return readPreferences();
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

  function browserLabel() {
    const ua = navigator.userAgent || "";
    if (/EdgA|EdgiOS|Edg\//i.test(ua)) return "Edge";
    if (/SamsungBrowser/i.test(ua)) return "Samsung Internet";
    if (/CriOS|Chrome\//i.test(ua)) return "Chrome";
    if (/FxiOS|Firefox\//i.test(ua)) return "Firefox";
    if (/Safari/i.test(ua)) return "Safari";
    return "브라우저";
  }

  function notificationHelpText() {
    const browser = browserLabel();
    if (isAndroid()) {
      return `웹 알림 권한은 켜졌지만 ${browser} 자체 알림이 휴대폰에서 차단되어 있을 수 있습니다. 휴대폰 설정 → 앱 → ${browser} → 알림 → ‘알림 허용’을 켠 뒤 ‘테스트 알림 다시 보내기’를 눌러주세요.`;
    }
    if (isIos()) {
      return "웹 알림 권한은 켜졌지만 iPhone/iPad의 앱 알림이 꺼져 있을 수 있습니다. 설정 → 알림에서 업무수첩 알림을 허용한 뒤 다시 테스트해 주세요.";
    }
    return `${browser} 또는 운영체제의 알림 설정에서 업무수첩 알림이 허용되어 있는지 확인한 뒤 다시 테스트해 주세요.`;
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
      updateNotificationUi();
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
        await promptEvent.prompt();
        const choice = promptEvent.userChoice ? await promptEvent.userChoice : null;
        const outcome = choice?.outcome || "";
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

  function updateNotificationUi() {
    const guide = document.getElementById("settingsNotificationGuide");
    const action = document.getElementById("settingsNotificationTest");
    if (!guide || !action) return;

    const notifications = window.WorklogNotifications;
    if (!notifications) {
      guide.textContent = "알림 기능을 불러오지 못했습니다. 페이지를 다시 열어주세요.";
      action.textContent = "알림 사용 불가";
      action.disabled = true;
      return;
    }

    const state = notifications.getStatus();
    if (!state.supported) {
      guide.textContent = "이 브라우저에서는 업무수첩 알림을 지원하지 않습니다.";
      action.textContent = "알림 사용 불가";
      action.disabled = true;
      return;
    }

    if (state.requiresInstall) {
      guide.textContent = "iPhone/iPad에서 알림을 받으려면 먼저 업무수첩을 홈 화면에 설치한 뒤, 홈 화면 아이콘으로 앱을 열어주세요.";
      action.textContent = "설치 후 알림 켜기";
      action.disabled = true;
      return;
    }

    if (state.permission === "denied") {
      guide.textContent = "업무수첩 웹 알림 권한이 차단되어 있습니다. 브라우저의 사이트 권한에서 알림을 허용한 뒤 다시 열어주세요.";
      action.textContent = "알림이 차단됨";
      action.disabled = true;
      return;
    }

    action.disabled = false;
    if (state.permission === "granted") {
      guide.textContent = "웹 알림 권한이 켜져 있습니다. 테스트를 보내 실제 휴대폰에 표시되는지 확인해보세요.";
      action.textContent = "테스트 알림 다시 보내기";
      return;
    }

    guide.textContent = "‘알림 시작하기’를 누르면 브라우저의 기본 알림 허용창이 열립니다. 허용하면 테스트 알림까지 바로 보냅니다.";
    action.textContent = "알림 시작하기";
  }

  function wireNotificationTest() {
    const action = document.getElementById("settingsNotificationTest");
    const status = document.getElementById("settingsNotificationStatus");
    const confirm = document.getElementById("settingsNotificationConfirm");
    const seen = document.getElementById("settingsNotificationSeen");
    const missing = document.getElementById("settingsNotificationMissing");
    const help = document.getElementById("settingsNotificationHelp");
    if (!action) return;

    action.addEventListener("click", async () => {
      const notifications = window.WorklogNotifications;
      if (!notifications) {
        if (status) status.textContent = "알림 기능을 불러오지 못했습니다. 페이지를 다시 열어주세요.";
        return;
      }

      action.disabled = true;
      if (status) status.textContent = "";
      if (confirm) confirm.hidden = true;
      if (help) help.hidden = true;
      try {
        const result = await notifications.showTestNotification();
        if (status) {
          if (result.ok) {
            status.textContent = "테스트 알림을 전송했습니다. 실제로 보였는지 아래에서 확인해주세요.";
            if (confirm) confirm.hidden = false;
          } else if (result.code === "ios_install_required") {
            status.textContent = "먼저 업무수첩을 홈 화면에 설치하고 홈 화면 아이콘으로 열어주세요.";
          } else if (result.code === "denied") {
            status.textContent = "업무수첩 웹 알림 권한이 차단되었습니다. 브라우저의 사이트 권한에서 알림을 허용해주세요.";
          } else {
            status.textContent = "이 기기에서는 현재 업무수첩 알림을 사용할 수 없습니다.";
          }
        }
      } catch {
        if (status) status.textContent = "테스트 알림을 전송하지 못했습니다. 앱을 다시 연 뒤 한 번 더 시도해주세요.";
      } finally {
        updateNotificationUi();
      }
    });

    seen?.addEventListener("click", () => {
      if (confirm) confirm.hidden = true;
      if (help) help.hidden = true;
      if (status) status.textContent = "알림 확인이 완료되었습니다. 이 기기에서 업무수첩 알림을 받을 수 있습니다.";
    });

    missing?.addEventListener("click", () => {
      if (confirm) confirm.hidden = true;
      if (status) status.textContent = "알림 전송은 됐지만 휴대폰에 표시되지 않았습니다.";
      if (help) {
        help.textContent = notificationHelpText();
        help.hidden = false;
      }
    });

    updateNotificationUi();
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
    const briefing = document.getElementById("settingsBriefingCollapsed");
    const prefs = readPreferences();
    if (briefing) briefing.checked = prefs.briefingCollapsed;

    briefing?.addEventListener("change", () => {
      savePreferences({ briefingCollapsed: briefing.checked });
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
  wireNotificationTest();
  wireShare();
  wireLogout();
  refreshAccount().catch(() => {});
  window.addEventListener("worklog:platform-auth-changed", () => refreshAccount().catch(() => {}));

  window.WorklogUiPreferences = Object.freeze({ read: readPreferences, save: savePreferences });
})();