import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadNotifications({ userAgent = "Android", standalone = false, permission = "default" } = {}) {
  const calls = { permission: 0, shown: [], registered: 0 };
  const registration = {
    update: async () => {},
    showNotification: async (title, options) => calls.shown.push({ title, options }),
  };

  const NotificationApi = {
    permission,
    requestPermission: async () => {
      calls.permission += 1;
      NotificationApi.permission = "granted";
      return "granted";
    },
  };

  class ServiceWorkerRegistrationMock {}
  ServiceWorkerRegistrationMock.prototype.showNotification = async function showNotification() {};

  const navigator = {
    userAgent,
    standalone,
    serviceWorker: {
      getRegistration: async () => registration,
      register: async () => {
        calls.registered += 1;
        return registration;
      },
      ready: Promise.resolve(registration),
    },
  };

  const window = {
    navigator,
    Notification: NotificationApi,
    matchMedia: () => ({ matches: standalone }),
  };
  window.window = window;

  const context = {
    window,
    navigator,
    Notification: NotificationApi,
    ServiceWorkerRegistration: ServiceWorkerRegistrationMock,
    console,
    Object,
    Error,
  };

  vm.createContext(context);
  vm.runInContext(fs.readFileSync("public/notifications.js", "utf8"), context);
  return { api: window.WorklogNotifications, calls, NotificationApi };
}

test("notification permission is never requested during module load", async () => {
  const { calls } = loadNotifications();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.permission, 0);
});

test("test notification requests permission from the button flow and uses service worker notification", async () => {
  const { api, calls } = loadNotifications();
  const result = await api.showTestNotification();

  assert.equal(result.ok, true);
  assert.equal(result.code, "shown");
  assert.equal(calls.permission, 1);
  assert.equal(calls.shown.length, 1);
  assert.equal(calls.shown[0].title, "업무수첩 알림 테스트");
  assert.equal(calls.shown[0].options.data.url, "/");
});

test("iPhone browser requires Home Screen install before notification permission", async () => {
  const { api, calls } = loadNotifications({ userAgent: "iPhone", standalone: false });
  const result = await api.showTestNotification();

  assert.equal(result.ok, false);
  assert.equal(result.code, "ios_install_required");
  assert.equal(calls.permission, 0);
  assert.equal(calls.shown.length, 0);
});

test("settings exposes explicit notification test control", () => {
  const html = fs.readFileSync("public/settings.html", "utf8");
  assert.match(html, /id="settingsNotificationTest"/);
  assert.match(html, /\/notifications\.js\?v=/);
});

test("service worker is push-ready and opens the app on notification click", () => {
  const sw = fs.readFileSync("public/sw.js", "utf8");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /\/notifications\.js/);
  assert.match(sw, /showNotification\(title,options\)/);
});
