import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const notificationsSource = readFileSync(new URL("../public/notifications.js", import.meta.url), "utf8");
const morningSettingsSource = readFileSync(new URL("../public/morning-push-settings.js", import.meta.url), "utf8");

function pushSubscription(endpoint, onUnsubscribe) {
  return {
    endpoint,
    options: { applicationServerKey: null },
    toJSON() {
      return {
        endpoint,
        keys: {
          p256dh: "B".repeat(87),
          auth: "A".repeat(22),
        },
      };
    },
    async unsubscribe() {
      onUnsubscribe?.();
      return true;
    },
  };
}

function browserHarness() {
  let current;
  let unsubscribeCount = 0;
  let subscribeCount = 0;
  const pushTestIds = [];

  const stale = pushSubscription("https://push.example.test/stale", () => {
    unsubscribeCount += 1;
    if (current === stale) current = null;
  });
  current = stale;

  const registration = {
    async showNotification() {},
    pushManager: {
      async getSubscription() {
        return current;
      },
      async subscribe() {
        subscribeCount += 1;
        const fresh = pushSubscription(`https://push.example.test/fresh-${subscribeCount}`, () => {
          unsubscribeCount += 1;
          if (current === fresh) current = null;
        });
        current = fresh;
        return fresh;
      },
    },
  };

  class ServiceWorkerRegistration {
    async showNotification() {}
  }

  const navigator = {
    userAgent: "Chrome Test",
    standalone: false,
    serviceWorker: {
      async getRegistration() {
        return registration;
      },
      async register() {
        return registration;
      },
      ready: Promise.resolve(registration),
    },
  };

  const Notification = {
    permission: "granted",
    async requestPermission() {
      return "granted";
    },
  };

  const window = {
    navigator,
    Notification,
    PushManager: function PushManager() {},
    ServiceWorkerRegistration,
    matchMedia() {
      return { matches: false };
    },
    WorklogPlatformAuth: {
      readSession() {
        return { access_token: "test-access-token" };
      },
    },
  };

  async function fetchImpl(path, options = {}) {
    if (path === "/api/push-subscription" && !options.method) {
      return new Response(JSON.stringify({ configured: true, publicKey: "AQ" }), { status: 200 });
    }
    if (path === "/api/push-subscription" && options.method === "POST") {
      const body = JSON.parse(options.body);
      const isFresh = String(body?.subscription?.endpoint || "").includes("fresh-");
      return new Response(JSON.stringify({ subscriptionId: isFresh ? "fresh-id" : "stale-id" }), { status: 200 });
    }
    if (path === "/api/push-test") {
      const body = JSON.parse(options.body);
      pushTestIds.push(body.subscriptionId);
      if (body.subscriptionId === "stale-id") {
        return new Response(JSON.stringify({ error: "WEB_PUSH_DELIVERY_FAILED", message: "expired" }), { status: 410 });
      }
      return new Response(JSON.stringify({ ok: true, delivered: true }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${path}`);
  }

  const context = {
    window,
    navigator,
    Notification,
    ServiceWorkerRegistration,
    fetch: fetchImpl,
    Response,
    URL,
    ArrayBuffer,
    Uint8Array,
    atob,
    console,
  };
  vm.runInNewContext(notificationsSource, context, { filename: "notifications.js" });

  return {
    notifications: context.window.WorklogNotifications,
    stats() {
      return { unsubscribeCount, subscribeCount, pushTestIds: [...pushTestIds] };
    },
  };
}

test("expired Web Push subscription is replaced and the request is retried once", async () => {
  const harness = browserHarness();
  const result = await harness.notifications.sendServerTestPush();
  assert.equal(result.delivered, true);
  assert.equal(result.recovered, true);
  assert.equal(result.subscriptionId, "fresh-id");
  assert.deepEqual(harness.stats(), {
    unsubscribeCount: 1,
    subscribeCount: 1,
    pushTestIds: ["stale-id", "fresh-id"],
  });
});

test("morning and afternoon previews use the shared subscription recovery path", () => {
  assert.match(notificationsSource, /sendMorningPreviewPush[\s\S]*withServerPushSubscriptionRecovery/);
  assert.match(notificationsSource, /sendAfternoonPreviewPush[\s\S]*withServerPushSubscriptionRecovery/);
  assert.match(notificationsSource, /Number\(error\?\.status \|\| 0\) === 410/);
  assert.match(notificationsSource, /await existing\.unsubscribe\(\)/);
  assert.match(morningSettingsSource, /notifications\?\.sendMorningPreviewPush/);
  assert.match(morningSettingsSource, /notifications\?\.sendAfternoonPreviewPush/);
  assert.doesNotMatch(morningSettingsSource, /fetch\("\/api\/(?:morning|afternoon)-push-preview"/);
});
