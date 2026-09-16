(() => {
  function state() {
    return window.WorklogNotifications?.getStatus?.() || null;
  }

  function session() {
    return window.WorklogPlatformAuth?.readSession?.() || null;
  }

  function updateUi() {
    const button = document.getElementById("settingsServerPushTest");
    const status = document.getElementById("settingsServerPushStatus");
    if (!button) return;

    const notificationState = state();
    if (!notificationState?.serverPushSupported) {
      button.disabled = true;
      button.textContent = "서버 알림 사용 불가";
      if (status) status.textContent = "이 브라우저에서는 서버 Push를 사용할 수 없습니다.";
      return;
    }
    if (notificationState.requiresInstall) {
      button.disabled = true;
      button.textContent = "설치 후 서버 알림 연결";
      if (status) status.textContent = "iPhone/iPad에서는 업무수첩을 홈 화면에 설치한 뒤 연결할 수 있습니다.";
      return;
    }
    if (!session()) {
      button.disabled = true;
      button.textContent = "로그인 후 서버 알림 연결";
      if (status) status.textContent = "서버가 내 기기로 알림을 보내려면 업무수첩 로그인이 필요합니다.";
      return;
    }

    button.disabled = false;
    button.textContent = "앱 닫고 서버 알림 테스트";
    if (status?.dataset.ready !== "true") {
      status.textContent = "먼저 서버 전송을 즉시 확인한 뒤, 성공하면 8초 뒤 종료 상태 테스트를 이어서 실행합니다.";
    }
  }

  function messageFor(error) {
    if (error?.code === "login_required") return "로그인 후 서버 알림을 연결해주세요.";
    if (error?.code === "ios_install_required") return "먼저 업무수첩을 홈 화면에 설치하고 홈 화면 아이콘으로 열어주세요.";
    if (error?.code === "denied") return "알림 권한이 차단되어 있습니다. 브라우저 또는 기기 설정에서 알림을 허용해주세요.";
    if (error?.status === 404 || error?.code === "SUBSCRIPTION_NOT_FOUND") return "기기 구독을 찾지 못했습니다. 다시 연결해주세요.";
    return String(error?.message || "서버 알림 테스트를 시작하지 못했습니다.");
  }

  function wire() {
    const button = document.getElementById("settingsServerPushTest");
    const status = document.getElementById("settingsServerPushStatus");
    if (!button) return;

    button.addEventListener("click", async () => {
      const notifications = window.WorklogNotifications;
      if (!notifications?.sendServerTestPush || !notifications?.scheduleClosedAppServerPushTest) {
        if (status) status.textContent = "서버 알림 기능을 불러오지 못했습니다. 페이지를 다시 열어주세요.";
        return;
      }

      button.disabled = true;
      if (status) {
        status.dataset.ready = "true";
        status.textContent = "1차 서버 전송을 확인하는 중입니다…";
      }
      try {
        await notifications.sendServerTestPush();
        if (status) status.textContent = "1차 서버 전송 성공. 종료 상태 테스트를 예약하는 중입니다…";
        const result = await notifications.scheduleClosedAppServerPushTest();
        if (status) status.textContent = `1차 서버 전송 성공. ${result.delaySeconds || 8}초 뒤 두 번째 서버 알림이 도착합니다. 지금 업무수첩을 닫고 홈 화면으로 이동하세요.`;
      } catch (error) {
        if (status) status.textContent = `서버 전송 확인 실패: ${messageFor(error)}`;
      } finally {
        button.disabled = false;
      }
    });

    updateUi();
  }

  wire();
  window.addEventListener("worklog:platform-auth-changed", updateUi);
})();
