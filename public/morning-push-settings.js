(() => {
  let current = { morningEnabled: false, afternoonEnabled: false, detailEnabled: true, connected: false };

  function session() {
    const value = window.WorklogPlatformAuth?.readSession?.();
    return value?.access_token ? value : null;
  }

  function ensurePreviewControls() {
    if (document.getElementById("settingsMorningPushPreview")) return;
    const body = document.querySelector("#settingsNotificationDiagnostics .settings-diagnostics-body");
    if (!body) return;
    const box = document.createElement("div");
    box.className = "settings-future-note";
    box.innerHTML = `
      <strong>실제 아침 브리핑 문구 확인</strong>
      <p class="settings-note">현재 Supabase 업무·일정으로 08:30 알림과 같은 문구를 지금 바로 보냅니다. 정식 아침 알림의 중복방지 이력에는 영향을 주지 않습니다.</p>
      <button id="settingsMorningPushPreview" class="settings-action" type="button">오늘 브리핑 알림 보내보기</button>
      <p id="settingsMorningPushPreviewStatus" class="settings-status" aria-live="polite"></p>
    `;
    body.prepend(box);
  }

  function elements() {
    return {
      morningToggle: document.getElementById("settingsMorningPushEnabled"),
      morningStatus: document.getElementById("settingsMorningPushStatus"),
      afternoonToggle: document.getElementById("settingsAfternoonPushEnabled"),
      afternoonStatus: document.getElementById("settingsAfternoonPushStatus"),
      detailToggle: document.getElementById("settingsMorningPushDetailEnabled"),
      detailStatus: document.getElementById("settingsMorningPushDetailStatus"),
      previewButton: document.getElementById("settingsMorningPushPreview"),
      previewStatus: document.getElementById("settingsMorningPushPreviewStatus"),
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
    const { morningToggle, morningStatus, afternoonToggle, afternoonStatus, detailToggle, detailStatus, previewButton } = elements();
    current = {
      morningEnabled: Boolean(data?.morningEnabled),
      afternoonEnabled: Boolean(data?.afternoonEnabled),
      detailEnabled: data?.detailEnabled !== false,
      connected: Boolean(data?.connected),
    };

    if (morningToggle) {
      morningToggle.disabled = false;
      morningToggle.checked = current.morningEnabled && current.connected;
    }
    if (afternoonToggle) {
      afternoonToggle.disabled = false;
      afternoonToggle.checked = current.afternoonEnabled && current.connected;
    }
    if (detailToggle) {
      detailToggle.disabled = false;
      detailToggle.checked = current.detailEnabled;
    }
    if (previewButton) previewButton.disabled = false;

    if (morningStatus) {
      if (current.morningEnabled && current.connected) {
        morningStatus.textContent = "켜짐 · 필요한 날에만 오전 8:30에 브리핑을 보냅니다.";
      } else if (current.morningEnabled && !current.connected) {
        morningStatus.textContent = "아침 알림은 켜져 있지만 이 기기 연결이 없습니다. 다시 켜서 연결해주세요.";
      } else {
        morningStatus.textContent = "꺼짐 · 알림을 보내지 않습니다.";
      }
    }
    if (afternoonStatus) {
      if (current.afternoonEnabled && current.connected) {
        afternoonStatus.textContent = "켜짐 · 남은 업무가 있는 날에만 오후 4:30에 보냅니다.";
      } else if (current.afternoonEnabled && !current.connected) {
        afternoonStatus.textContent = "오후 알림은 켜져 있지만 이 기기 연결이 없습니다. 다시 켜서 연결해주세요.";
      } else {
        afternoonStatus.textContent = "꺼짐 · 오후 미완료 업무 알림을 보내지 않습니다.";
      }
    }
    if (detailStatus) {
      detailStatus.textContent = current.detailEnabled
        ? "가장 가까운 일정과 우선 업무 제목을 표시합니다."
        : "잠금화면에는 업무 제목 없이 건수만 표시합니다.";
    }
  }

  function renderLoggedOut() {
    const { morningToggle, morningStatus, afternoonToggle, afternoonStatus, detailToggle, detailStatus, previewButton, previewStatus } = elements();
    if (morningToggle) {
      morningToggle.checked = false;
      morningToggle.disabled = true;
    }
    if (afternoonToggle) {
      afternoonToggle.checked = false;
      afternoonToggle.disabled = true;
    }
    if (detailToggle) {
      detailToggle.checked = true;
      detailToggle.disabled = true;
    }
    if (previewButton) previewButton.disabled = true;
    if (morningStatus) morningStatus.textContent = "로그인 후 아침 업무 알림을 켤 수 있습니다.";
    if (afternoonStatus) afternoonStatus.textContent = "로그인 후 오후 미완료 업무 알림을 켤 수 있습니다.";
    if (detailStatus) detailStatus.textContent = "로그인 후 알림 내용 표시 방식을 선택할 수 있습니다.";
    if (previewStatus) previewStatus.textContent = "로그인 후 실제 오늘 브리핑 문구를 받아볼 수 있습니다.";
  }

  function setControlsDisabled(disabled) {
    const { morningToggle, afternoonToggle, detailToggle, previewButton } = elements();
    if (morningToggle) morningToggle.disabled = disabled;
    if (afternoonToggle) afternoonToggle.disabled = disabled;
    if (detailToggle) detailToggle.disabled = disabled;
    if (previewButton) previewButton.disabled = disabled;
  }

  async function load() {
    const { morningToggle, morningStatus } = elements();
    if (!morningToggle) return;
    if (!session()) {
      renderLoggedOut();
      return;
    }
    setControlsDisabled(true);
    if (morningStatus) morningStatus.textContent = "알림 설정을 확인하는 중입니다…";
    try {
      render(await apiJson("GET"));
    } catch (error) {
      renderLoggedOut();
      if (morningStatus) morningStatus.textContent = String(error?.message || "알림 설정을 확인하지 못했습니다.");
    }
  }

  function statusForPatch(patch) {
    const { morningStatus, afternoonStatus, detailStatus } = elements();
    if (Object.prototype.hasOwnProperty.call(patch, "afternoonEnabled")) return afternoonStatus;
    if (Object.prototype.hasOwnProperty.call(patch, "detailEnabled")) return detailStatus;
    return morningStatus;
  }

  async function savePatch(patch, busyMessage) {
    const targetStatus = statusForPatch(patch);
    setControlsDisabled(true);
    if (busyMessage && targetStatus) targetStatus.textContent = busyMessage;
    try {
      render(await apiJson("POST", patch));
    } catch (error) {
      render(current);
      if (targetStatus) targetStatus.textContent = String(error?.message || "알림 설정을 저장하지 못했습니다.");
    }
  }

  async function ensurePushConnection(statusNode) {
    if (statusNode) statusNode.textContent = "이 기기를 서버 알림에 연결하는 중입니다…";
    const notifications = window.WorklogNotifications;
    if (!notifications?.ensureServerPushSubscription) throw new Error("서버 알림 기능을 불러오지 못했습니다.");
    await notifications.ensureServerPushSubscription();
  }

  async function sendMorningPreview() {
    const { previewButton, previewStatus } = elements();
    if (!previewButton) return;
    previewButton.disabled = true;
    if (previewStatus) previewStatus.textContent = "현재 Supabase 업무·일정으로 오늘 브리핑 알림을 만드는 중입니다…";
    try {
      const notifications = window.WorklogNotifications;
      if (!notifications?.sendMorningPreviewPush) throw new Error("서버 알림 기능을 불러오지 못했습니다.");
      const result = await notifications.sendMorningPreviewPush();
      if (result?.empty || !result?.delivered) {
        if (previewStatus) previewStatus.textContent = String(result?.message || "오늘은 보낼 브리핑 업무나 일정이 없습니다.");
      } else if (previewStatus) {
        previewStatus.textContent = result?.recovered
          ? "만료된 기기 구독을 자동으로 다시 연결하고 전송했습니다. 지금 도착한 알림이 실제 08:30 브리핑과 같은 문구 형식입니다."
          : "전송 완료 · 지금 도착한 알림이 실제 08:30 브리핑과 같은 문구 형식입니다.";
      }
    } catch (error) {
      if (previewStatus) previewStatus.textContent = String(error?.message || "오늘 브리핑 알림 테스트에 실패했습니다.");
    } finally {
      previewButton.disabled = false;
    }
  }

  function wire() {
    ensurePreviewControls();
    const { morningToggle, morningStatus, afternoonToggle, afternoonStatus, detailToggle, previewButton } = elements();
    if (!morningToggle) return;

    morningToggle.addEventListener("change", async () => {
      const desired = Boolean(morningToggle.checked);
      if (desired) {
        setControlsDisabled(true);
        try {
          await ensurePushConnection(morningStatus);
        } catch (error) {
          render(current);
          if (morningStatus) morningStatus.textContent = String(error?.message || "서버 알림 연결에 실패했습니다.");
          return;
        }
      }
      await savePatch({ morningEnabled: desired }, "아침 업무 알림 설정을 저장하는 중입니다…");
    });

    afternoonToggle?.addEventListener("change", async () => {
      const desired = Boolean(afternoonToggle.checked);
      if (desired) {
        setControlsDisabled(true);
        try {
          await ensurePushConnection(afternoonStatus);
        } catch (error) {
          render(current);
          if (afternoonStatus) afternoonStatus.textContent = String(error?.message || "서버 알림 연결에 실패했습니다.");
          return;
        }
      }
      await savePatch({ afternoonEnabled: desired }, "오후 미완료 업무 알림 설정을 저장하는 중입니다…");
    });

    if (detailToggle) {
      detailToggle.addEventListener("change", async () => {
        await savePatch({ detailEnabled: Boolean(detailToggle.checked) }, "알림 내용 표시 설정을 저장하는 중입니다…");
      });
    }

    previewButton?.addEventListener("click", sendMorningPreview);
    load();
  }

  wire();
  window.addEventListener("worklog:platform-auth-changed", load);
})();
