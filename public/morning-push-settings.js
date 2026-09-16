(() => {
  function session() {
    const value = window.WorklogPlatformAuth?.readSession?.();
    return value?.access_token ? value : null;
  }

  function elements() {
    return {
      toggle: document.getElementById("settingsMorningPushEnabled"),
      status: document.getElementById("settingsMorningPushStatus"),
    };
  }

  async function apiJson(method, body) {
    const auth = session();
    if (!auth) {
      const error = new Error("로그인 후 아침 업무 알림을 설정할 수 있습니다.");
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
      const error = new Error(String(data?.message || "아침 업무 알림 설정을 불러오지 못했습니다."));
      error.code = String(data?.error || "NOTIFICATION_PREFERENCES_FAILED");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function render(data) {
    const { toggle, status } = elements();
    if (!toggle) return;
    const enabled = Boolean(data?.morningEnabled);
    const connected = Boolean(data?.connected);
    toggle.disabled = false;
    toggle.checked = enabled && connected;
    if (!status) return;
    if (enabled && connected) {
      status.textContent = "매일 오전 8:30에 오늘 할 일·지난 업무·오늘 일정을 묶어서 알려드립니다.";
    } else if (enabled && !connected) {
      status.textContent = "아침 알림은 켜져 있지만 이 주소의 기기 연결이 없습니다. 다시 켜서 연결해주세요.";
    } else {
      status.textContent = "꺼짐 · 필요한 날에만 오전 8:30 묶음 알림을 보냅니다.";
    }
  }

  async function load() {
    const { toggle, status } = elements();
    if (!toggle) return;
    if (!session()) {
      toggle.checked = false;
      toggle.disabled = true;
      if (status) status.textContent = "로그인 후 아침 업무 알림을 켤 수 있습니다.";
      return;
    }
    toggle.disabled = true;
    if (status) status.textContent = "아침 업무 알림 설정을 확인하는 중입니다…";
    try {
      render(await apiJson("GET"));
    } catch (error) {
      toggle.checked = false;
      toggle.disabled = false;
      if (status) status.textContent = String(error?.message || "아침 업무 알림 설정을 확인하지 못했습니다.");
    }
  }

  function wire() {
    const { toggle, status } = elements();
    if (!toggle) return;
    toggle.addEventListener("change", async () => {
      const desired = Boolean(toggle.checked);
      toggle.disabled = true;
      try {
        if (desired) {
          if (status) status.textContent = "이 기기를 서버 알림에 연결하는 중입니다…";
          const notifications = window.WorklogNotifications;
          if (!notifications?.ensureServerPushSubscription) throw new Error("서버 알림 기능을 불러오지 못했습니다.");
          await notifications.ensureServerPushSubscription();
        }
        if (status) status.textContent = "아침 업무 알림 설정을 저장하는 중입니다…";
        render(await apiJson("POST", { morningEnabled: desired }));
      } catch (error) {
        toggle.checked = !desired;
        toggle.disabled = false;
        if (status) status.textContent = String(error?.message || "아침 업무 알림 설정을 저장하지 못했습니다.");
      }
    });
    load();
  }

  wire();
  window.addEventListener("worklog:platform-auth-changed", load);
})();
