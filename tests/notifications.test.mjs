import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

function loadNotifications({ userAgent = "Android", standalone = false, permission = "default", existingRegistration = true } = {}) {
  const calls = { permission: 0, shown: [], registered: 0, registrationLookups: 0, updated: 0 };
  const registration = {
    update: async () => { calls.updated += 1; },
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
      getRegistration: async () => {
        calls.registrationLookups += 1;
        return existingRegistration ? registration : undefined;
      },
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

test("notification module load does not touch permission or service worker registration", async () => {
  const { calls } = loadNotifications();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.permission, 0);
  assert.equal(calls.registrationLookups, 0);
  assert.equal(calls.registered, 0);
  assert.equal(calls.updated, 0);
});

test("test notification reuses an existing service worker without forcing update", async () => {
  const { api, calls } = loadNotifications();
  const result = await api.showTestNotification();

  assert.equal(result.ok, true);
  assert.equal(result.code, "shown");
  assert.equal(calls.registrationLookups, 1);
  assert.equal(calls.registered, 0);
  assert.equal(calls.updated, 0);
  assert.equal(calls.permission, 1);
  assert.equal(calls.shown.length, 1);
  assert.equal(calls.shown[0].title, "업무수첩 알림 테스트");
  assert.equal(calls.shown[0].options.data.url, "/");
});

test("test notification registers service worker on demand when none exists", async () => {
  const { api, calls } = loadNotifications({ existingRegistration: false });
  const result = await api.showTestNotification();

  assert.equal(result.ok, true);
  assert.equal(calls.registrationLookups, 1);
  assert.equal(calls.registered, 1);
  assert.equal(calls.updated, 0);
  assert.equal(calls.shown.length, 1);
});

test("iPhone browser requires Home Screen install before notification permission", async () => {
  const { api, calls } = loadNotifications({ userAgent: "iPhone", standalone: false });
  const result = await api.showTestNotification();

  assert.equal(result.ok, false);
  assert.equal(result.code, "ios_install_required");
  assert.equal(calls.permission, 0);
  assert.equal(calls.registrationLookups, 0);
  assert.equal(calls.registered, 0);
  assert.equal(calls.shown.length, 0);
});

test("main app shell defers the notification module to settings", () => {
  const main = fs.readFileSync("public/index.html", "utf8");
  const settings = fs.readFileSync("public/settings.html", "utf8");
  assert.doesNotMatch(main, /\/notifications\.js\?v=/);
  assert.match(main, /\/app\.js/);
  assert.match(settings, /\/notifications\.js\?v=/);
});

test("settings exposes notification start and visible-delivery confirmation controls", () => {
  const html = fs.readFileSync("public/settings.html", "utf8");
  assert.match(html, /id="settingsNotificationTest"/);
  assert.match(html, />알림 시작하기</);
  assert.match(html, /id="settingsNotificationConfirm"/);
  assert.match(html, /id="settingsNotificationSeen"/);
  assert.match(html, />알림이 왔어요</);
  assert.match(html, /id="settingsNotificationMissing"/);
  assert.match(html, />알림이 안 왔어요</);
  assert.match(html, /id="settingsNotificationHelp"/);
  assert.match(html, /\/notifications\.js\?v=/);
});

test("settings does not claim visible delivery before user confirmation and guides blocked Android browser notifications", () => {
  const settings = fs.readFileSync("public/settings.js", "utf8");
  assert.match(settings, /테스트 알림을 전송했습니다\. 실제로 보였는지 아래에서 확인해주세요/);
  assert.match(settings, /휴대폰 설정 → 앱 →/);
  assert.match(settings, /EdgA\|EdgiOS\|Edg\\\//);
});

test("service worker is push-ready and opens the app on notification click", () => {
  const sw = fs.readFileSync("public/sw.js", "utf8");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /\/notifications\.js/);
  assert.match(sw, /showNotification\(title,options\)/);
});
