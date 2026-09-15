(() => {
  const APP_URL = "https://worklog-voice-pwa.netlify.app/";
  const openButton = document.getElementById("settingsOpen");
  const closeButton = document.getElementById("settingsClose");
  const card = document.getElementById("settingsCard");
  const accountState = document.getElementById("settingsAccountState");
  const accountAction = document.getElementById("settingsAccountAction");
  const installGuide = document.getElementById("settingsInstallGuide");
  const shareButton = document.getElementById("settingsShare");
  const shareStatus = document.getElementById("settingsShareStatus");
  const authCard = document.getElementById("platformAuthCard");
  const authEmail = document.getElementById("platformAuthEmail");

  if (!openButton || !closeButton || !card) return;

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
    if (installGuide) installGuide.textContent = installationText();
    if (!accountState || !accountAction) return;
    const auth = window.WorklogPlatformAuth;
    if (!auth) {
      accountState.textContent = "계정 기능을 확인하지 못했습니다.";
      accountAction.hidden = true;
      return;
    }
    const session = auth.readSession?.();
    if (!session) {
      accountState.textContent = "아직 로그인하지 않았습니다. 새 사용자는 Notion 없이 업무수첩 계정으로 바로 시작할 수 있습니다.";
      accountAction.textContent = "로그인 · 무료로 시작";
      accountAction.hidden = false;
      return;
    }
    const user = await auth.currentUser?.().catch?.(() => null);
    accountState.textContent = user?.email
      ? `${user.email} 계정으로 사용 중입니다.`
      : "업무수첩 계정으로 로그인되어 있습니다.";
    accountAction.textContent = "내 업무공간으로 돌아가기";
    accountAction.hidden = false;
  }

  function openSettings() {
    card.hidden = false;
    refreshAccount().catch(() => {});
    card.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function closeSettings() {
    card.hidden = true;
  }

  openButton.addEventListener("click", openSettings);
  closeButton.addEventListener("click", closeSettings);

  accountAction?.addEventListener("click", () => {
    closeSettings();
    if (document.body.classList.contains("platform-signed-in")) {
      document.querySelector(".voice-card")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    authCard?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => authEmail?.focus(), 350);
  });

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

  window.addEventListener("worklog:platform-auth-changed", () => refreshAccount().catch(() => {}));
  refreshAccount().catch(() => {});
})();
