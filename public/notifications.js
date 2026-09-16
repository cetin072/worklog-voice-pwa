(() => {
  const SW_URL = "/sw.js";
  const TEST_TAG = "worklog-notification-test";

  function isIos() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isStandalone() {
    return window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true;
  }

  function isSupported() {
    return Boolean(
      "serviceWorker" in navigator
      && "Notification" in window
      && typeof ServiceWorkerRegistration !== "undefined"
      && "showNotification" in ServiceWorkerRegistration.prototype
    );
  }

  function isServerPushSupported() {
    return Boolean(isSupported() && "PushManager" in window);
  }

  function getStatus() {
    const supported = isSupported();
    const permission = supported ? Notification.permission : "unsupported";
    const ios = isIos();
    const standalone = isStandalone();
    return Object.freeze({
      supported,
      serverPushSupported: isServerPushSupported(),
      permission,
      ios,
      standalone,
      requiresInstall: ios && !standalone,
    });
  }

  async function ensureServiceWorker() {
    if (!("serviceWorker" in navigator)) {
      const error = new Error("service_worker_unsupported");
      error.code = "service_worker_unsupported";
      throw error;
    }

    const existing = await navigator.serviceWorker.getRegistration?.("/");
    if (existing) return existing;

    return navigator.serviceWorker.register(SW_URL, { scope: "/" });
  }

  async function requestPermissionFromUserGesture() {
    const status = getStatus();
    if (!status.supported) return { ok: false, code: "unsupported", status };
    if (status.requiresInstall) return { ok: false, code: "ios_install_required", status };

    await ensureServiceWorker();

    let permission = Notification.permission;
    if (permission === "default") {
      permission = await Notification.requestPermission();
    }

    if (permission !== "granted") {
      return { ok: false, code: permission === "denied" ? "denied" : "not_granted", status: getStatus() };
    }

    return { ok: true, code: "granted", status: getStatus() };
  }

  async function showTestNotification() {
    const permission = await requestPermissionFromUserGesture();
    if (!permission.ok) return permission;

    const registration = await navigator.serviceWorker.ready;
    await registration.showNotification("업무수첩 알림 테스트", {
      body: "알림이 정상적으로 연결되었습니다.",
      icon: "/icons/icon-192-v3.png",
      tag: TEST_TAG,
      data: { url: "/" },
    });

    return { ok: true, code: "shown", status: getStatus() };
  }

  function base64UrlToUint8Array(value) {
    const input = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padded = input + "=".repeat((4 - (input.length % 4)) % 4);
    const raw = atob(padded);
    return Uint8Array.from(raw, (char) => char.charCodeAt(0));
  }

  function applicationServerKeyBytes(value) {
    if (!value) return null;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
    return null;
  }

  function subscriptionMatchesServerKey(subscription, publicKey) {
    const current = applicationServerKeyBytes(subscription?.options?.applicationServerKey);
    if (!current) return true;
    const expected = base64UrlToUint8Array(publicKey);
    if (current.byteLength !== expected.byteLength) return false;
    for (let index = 0; index < current.byteLength; index += 1) {
      if (current[index] !== expected[index]) return false;
    }
    return true;
  }

  function subscriptionJson(subscription) {
    const json = subscription?.toJSON?.() || {};
    return {
      endpoint: String(json.endpoint || subscription?.endpoint || ""),
      keys: {
        p256dh: String(json?.keys?.p256dh || ""),
        auth: String(json?.keys?.auth || ""),
      },
    };
  }

  function authSession() {
    const session = window.WorklogPlatformAuth?.readSession?.();
    return session?.access_token ? session : null;
  }

  async function apiJson(path, options = {}) {
    const response = await fetch(path, { cache: "no-store", ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(String(data?.message || "서버 알림 요청에 실패했습니다."));
      error.code = String(data?.error || "SERVER_PUSH_FAILED");
      error.status = response.status;
      throw error;
    }
    return data;
  }

  async function ensureServerPushSubscription() {
    const state = getStatus();
    if (!state.serverPushSupported) {
      const error = new Error("이 브라우저는 서버 Push를 지원하지 않습니다.");
      error.code = "push_manager_unsupported";
      throw error;
    }
    if (state.requiresInstall) {
      const error = new Error("iPhone/iPad에서는 홈 화면에 설치한 앱에서 서버 알림을 연결해주세요.");
      error.code = "ios_install_required";
      throw error;
    }

    const session = authSession();
    if (!session) {
      const error = new Error("로그인 후 서버 알림을 연결할 수 있습니다.");
      error.code = "login_required";
      throw error;
    }

    const permission = await requestPermissionFromUserGesture();
    if (!permission.ok) {
      const error = new Error("알림 권한이 필요합니다.");
      error.code = permission.code;
      throw error;
    }

    const config = await apiJson("/api/push-subscription");
    if (!config?.configured || !config?.publicKey) {
      const error = new Error("서버 Push 설정이 아직 준비되지 않았습니다.");
      error.code = "server_push_not_configured";
      throw error;
    }

    const registration = await navigator.serviceWorker.ready;
    let subscription = await registration.pushManager.getSubscription();
    if (subscription && !subscriptionMatchesServerKey(subscription, config.publicKey)) {
      await subscription.unsubscribe();
      subscription = null;
    }
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: base64UrlToUint8Array(config.publicKey),
      });
    }

    const saved = await apiJson("/api/push-subscription", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subscription: subscriptionJson(subscription) }),
    });

    return Object.freeze({
      ok: true,
      subscription,
      subscriptionId: String(saved?.subscriptionId || ""),
    });
  }

  async function refreshServerPushSubscription() {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      try {
        await existing.unsubscribe();
      } catch {
        // Continue to a fresh subscribe attempt even when browser cleanup is imperfect.
      }
    }
    return ensureServerPushSubscription();
  }

  function isRecoverableSubscriptionError(error) {
    return Number(error?.status || 0) === 410
      || Number(error?.status || 0) === 404
      || error?.code === "SUBSCRIPTION_NOT_FOUND";
  }

  async function withServerPushSubscriptionRecovery(send) {
    let connected = await ensureServerPushSubscription();
    if (!connected.subscriptionId) {
      const error = new Error("서버 알림 구독 ID를 확인하지 못했습니다.");
      error.code = "subscription_id_missing";
      throw error;
    }

    try {
      const result = await send(connected.subscriptionId);
      return Object.freeze({ result, subscriptionId: connected.subscriptionId, recovered: false });
    } catch (error) {
      if (!isRecoverableSubscriptionError(error)) throw error;
      connected = await refreshServerPushSubscription();
      if (!connected.subscriptionId) {
        const missing = new Error("새 서버 알림 구독 ID를 확인하지 못했습니다.");
        missing.code = "subscription_id_missing";
        throw missing;
      }
      const result = await send(connected.subscriptionId);
      return Object.freeze({ result, subscriptionId: connected.subscriptionId, recovered: true });
    }
  }

  async function sendServerTestPush() {
    const session = authSession();
    if (!session) {
      const error = new Error("로그인 후 서버 알림을 테스트할 수 있습니다.");
      error.code = "login_required";
      throw error;
    }
    const sent = await withServerPushSubscriptionRecovery((subscriptionId) => apiJson("/api/push-test", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subscriptionId }),
    }));
    return Object.freeze({ ok: true, ...sent.result, subscriptionId: sent.subscriptionId, recovered: sent.recovered });
  }

  async function sendMorningPreviewPush() {
    const session = authSession();
    if (!session) {
      const error = new Error("로그인 후 오늘 브리핑 알림을 테스트할 수 있습니다.");
      error.code = "login_required";
      throw error;
    }
    const sent = await withServerPushSubscriptionRecovery((subscriptionId) => apiJson("/api/morning-push-preview", {
      method: "POST",
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subscriptionId }),
    }));
    return Object.freeze({ ok: true, ...sent.result, subscriptionId: sent.subscriptionId, recovered: sent.recovered });
  }

  async function scheduleClosedAppServerPushTest() {
    const session = authSession();
    if (!session) {
      const error = new Error("로그인 후 서버 알림을 테스트할 수 있습니다.");
      error.code = "login_required";
      throw error;
    }
    const connected = await ensureServerPushSubscription();
    if (!connected.subscriptionId) {
      const error = new Error("서버 알림 구독 ID를 확인하지 못했습니다.");
      error.code = "subscription_id_missing";
      throw error;
    }
    const response = await fetch("/api/push-test-closed", {
      method: "POST",
      cache: "no-store",
      keepalive: true,
      headers: {
        authorization: `Bearer ${session.access_token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ subscriptionId: connected.subscriptionId }),
    });
    if (!response.ok && response.status !== 202) {
      const error = new Error("앱 종료 테스트를 예약하지 못했습니다.");
      error.code = "closed_app_test_failed";
      error.status = response.status;
      throw error;
    }
    return Object.freeze({ ok: true, scheduled: true, delaySeconds: 8, subscriptionId: connected.subscriptionId });
  }

  window.WorklogNotifications = Object.freeze({
    getStatus,
    ensureServiceWorker,
    showTestNotification,
    ensureServerPushSubscription,
    refreshServerPushSubscription,
    sendServerTestPush,
    sendMorningPreviewPush,
    scheduleClosedAppServerPushTest,
  });
})();
