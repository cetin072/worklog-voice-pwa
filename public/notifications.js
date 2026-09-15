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

  function getStatus() {
    const supported = isSupported();
    const permission = supported ? Notification.permission : "unsupported";
    const ios = isIos();
    const standalone = isStandalone();
    return Object.freeze({
      supported,
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
    if (existing) {
      existing.update?.().catch(() => {});
      return existing;
    }

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

  window.WorklogNotifications = Object.freeze({
    getStatus,
    ensureServiceWorker,
    showTestNotification,
  });

  if ("serviceWorker" in navigator) {
    ensureServiceWorker().catch(() => {});
  }
})();
