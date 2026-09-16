(() => {
  let current = { morningEnabled: false, detailEnabled: true, connected: false };

  function session() {
    const value = window.WorklogPlatformAuth?.readSession?.();
    return value?.access_token ? value : null;
  }

  function elements() {
    return {
      morningToggle: document.getElementById("settingsMorningPushEnabled"),
      morningStatus: document.getElementById("settingsMorningPushStatus"),
      detailToggle: document.getElementById("settingsMorningPushDetailEnabled"),
      detailStatus: document.getElementById("settingsMorningPushDetailStatus"),
    };
  }

  async function apiJson(method, body) {
    const auth = session();
    if (!auth) {
      const error = new Error("로그인 후 알림 설정을 변경할 수 있습니다.");
      error.code = "LOGIN_REQUIRED";
      throw error;
    }
    const response = await fetch("/api/notification-preferences", {
      method,
      cache: "no-store",
      headers: {
        authorization: `Bearer ${auth.access_token}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(data?.message || "알림 설정을 불러오지 못했습니다."));
      error.code = String(data?.error || "NOTIFICATION_PREFERENCES_FAILED");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function render(data) {
    const { morningToggle, morningStatus, detailToggle, detailStatus } = elements();
    current = {
      morningEnabled: Boolean(data?.morningEnabled),
      detailEnabled: data?.detailEnabled !== false,
      connected: Boolean(data?.connected),
    };

    if (morningToggle) {
      morningToggle.disabled = false;
      morningToggle.checked = current.morningEnabled && current.connected;
    }
    if (detailToggle) {
      detailToggle.disabled = false;
      detailToggle.checked = current.detailEnabled;
    }

    if (morningStatus) {
      if (current.morningEnabled && current.connected) {
        morningStatus.textContent = "켜짐 · 필요한 날에만 오전 8:30에 브리핑을 보냅니다.";
      } else if (current.morningEnabled && !current.connected) {
        morningStatus.textContent = "아침 알림은 켜져 있지만 이 기기 연결이 없습니다. 다시 켜서 연결해주세요.";
      } else {
        morningStatus.textContent = "꺼짐 · 알림을 보내지 않습니다.";
      }
    }
    if (detailStatus) {
      detailStatus.textContent = current.detailEnabled
        ? "가장 가까운 일정과 우선 업무 제목을 최대 2개 표시합니다."
        : "잠금화면에는 업무 제목 없이 건수만 표시합니다.";
    }
  }

  function renderLoggedOut() {
    const { morningToggle, morningStatus, detailToggle, detailStatus } = elements();
    if (morningToggle) {
      morningToggle.checked = false;
      morningToggle.disabled = true;
    }
    if (detailToggle) {
      detailToggle.checked = true;
      detailToggle.disabled = true;
    }
    if (morningStatus) morningStatus.textContent = "로그인 후 아침 업무 알림을 켤 수 있습니다.";
    if (detailStatus) detailStatus.textContent = "로그인 후 알림 내용 표시 방식을 선택할 수 있습니다.";
  }

  async function load() {
    const { morningToggle, morningStatus, detailToggle } = elements();
    if (!morningToggle) return;
    if (!session()) {
      renderLoggedOut();
      return;
    }
    morningToggle.disabled = true;
    if (detailToggle) detailToggle.disabled = true;
    if (morningStatus) morningStatus.textContent = "알림 설정을 확인하는 중입니다…";
    try {
      render(await apiJson("GET"));
    } catch (error) {
      renderLoggedOut();
      if (morningStatus) morningStatus.textContent = String(error?.message || "알림 설정을 확인하지 못했습니다.");
    }
  }

  async function savePatch(patch, busyMessage) {
    const { morningToggle, morningStatus, detailToggle, detailStatus } = elements();
    if (morningToggle) morningToggle.disabled = true;
    if (detailToggle) detailToggle.disabled = true;
    if (busyMessage && morningStatus) morningStatus.textContent = busyMessage;
    try {
      render(await apiJson("POST", patch));
    } catch (error) {
      render(current);
      const targetStatus = Object.prototype.hasOwnProperty.call(patch, "detailEnabled") ? detailStatus : morningStatus;
      if (targetStatus) targetStatus.textContent = String(error?.message || "알림 설정을 저장하지 못했습니다.");
    }
  }

  function wire() {
    const { morningToggle, detailToggle, morningStatus } = elements();
    if (!morningToggle) return;

    morningToggle.addEventListener("change", async () => {
      const desired = Boolean(morningToggle.checked);
      if (desired) {
        morningToggle.disabled = true;
        if (detailToggle) detailToggle.disabled = true;
        try {
          if (morningStatus) morningStatus.textContent = "이 기기를 서버 알림에 연결하는 중입니다…";
          const notifications = window.WorklogNotifications;
          if (!notifications?.ensureServerPushSubscription) throw new Error("서버 알림 기능을 불러오지 못했습니다.");
          await notifications.ensureServerPushSubscription();
        } catch (error) {
          render(current);
          if (morningStatus) morningStatus.textContent = String(error?.message || "서버 알림 연결에 실패했습니다.");
          return;
        }
      }
      await savePatch({ morningEnabled: desired }, "아침 업무 알림 설정을 저장하는 중입니다…");
    });

    if (detailToggle) {
      detailToggle.addEventListener("change", async () => {
        await savePatch({ detailEnabled: Boolean(detailToggle.checked) }, "알림 내용 표시 설정을 저장하는 중입니다…");
      });
    }

    load();
  }

  wire();
  window.addEventListener("worklog:platform-auth-changed", load);
})();
