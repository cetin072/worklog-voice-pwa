import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMorningPushBody, buildMorningPushPayload } from "../netlify/shared/morning-push-content.mjs";
import { createNotificationSchedulerClient, notificationSchedulerConfig } from "../netlify/shared/notification-scheduler.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20260916140000_notification_morning_digest_v1.sql", import.meta.url), "utf8");
const scheduled = readFileSync(new URL("../netlify/functions/morning-push.mts", import.meta.url), "utf8");
const preferencesApi = readFileSync(new URL("../netlify/functions/notification-preferences.mts", import.meta.url), "utf8");
const subscriptionApi = readFileSync(new URL("../netlify/functions/push-subscription.mts", import.meta.url), "utf8");
const settingsHtml = readFileSync(new URL("../public/settings.html", import.meta.url), "utf8");
const settingsJs = readFileSync(new URL("../public/morning-push-settings.js", import.meta.url), "utf8");

test("morning digest content includes only non-zero relevant counts", () => {
  assert.equal(buildMorningPushBody({ todayCount: 2, overdueCount: 3, scheduleCount: 1 }), "오늘 할 일 2건 · 지난 업무 3건 · 오늘 일정 1건");
  assert.equal(buildMorningPushBody({ todayCount: 0, overdueCount: 2, scheduleCount: 0 }), "지난 업무 2건");
  assert.equal(buildMorningPushPayload({ todayCount: 0, overdueCount: 0, scheduleCount: 0 }), null);
  assert.deepEqual(buildMorningPushPayload({ scheduleCount: 1 }), {
    title: "업무수첩 · 아침 브리핑",
    body: "오늘 일정 1건",
    url: "/#briefingCard",
    tag: "worklog-morning-digest",
  });
});

test("morning schedule is fixed to 08:30 Asia/Seoul and uses existing free infrastructure", () => {
  assert.match(scheduled, /schedule:"30 23 \* \* \*"/);
  assert.match(scheduled, /08:30 Asia\/Seoul/);
  assert.match(scheduled, /sendWebPush/);
  assert.match(scheduled, /claimMorning/);
  assert.doesNotMatch(scheduled, /OneSignal|Firebase Admin|Pusher|Twilio/);
});

test("morning preferences default off and delivery claim skips empty state with per-device daily dedupe", () => {
  assert.match(migration, /morning_enabled boolean not null default false/);
  assert.match(migration, /morning_time time without time zone not null default time '08:30'/);
  assert.match(migration, /timezone text not null default 'Asia\/Seoul'/);
  assert.match(migration, /unique \(subscription_id, kind, local_date\)/);
  assert.match(migration, /where today_count \+ overdue_count \+ schedule_count > 0/);
  assert.match(migration, /ps\.app_origin = p_app_origin/);
  assert.match(migration, /on conflict \(subscription_id, kind, local_date\) do nothing/);
});

test("scheduled RPC is protected by a hashed server secret and fail-closed grants", () => {
  assert.match(migration, /extensions\.digest\(coalesce\(p_secret, ''\), 'sha256'\)/);
  assert.match(migration, /security definer/);
  assert.match(migration, /revoke all on function public\._notification_scheduler_secret_ok\(text\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.claim_morning_notification_deliveries[\s\S]*to anon/);
  assert.doesNotMatch(migration, /NOTIFICATION_SCHEDULER_SECRET/);
});

test("preference API requires current-origin Push connection before enabling morning alerts", () => {
  assert.match(preferencesApi, /PUSH_SUBSCRIPTION_REQUIRED/);
  assert.match(preferencesApi, /app_origin:`eq\.\$\{origin\}`/);
  assert.match(preferencesApi, /morning_time:"08:30:00"/);
  assert.match(preferencesApi, /timezone:"Asia\/Seoul"/);
  assert.match(subscriptionApi, /app_origin:origin/);
});

test("settings exposes an explicit opt-in and connects Push from the same user gesture", () => {
  assert.match(settingsHtml, /id="settingsMorningPushEnabled"/);
  assert.match(settingsHtml, /아침 업무 알림 · 오전 8:30/);
  assert.match(settingsHtml, /모두 0건이면 알림을 보내지 않습니다/);
  assert.match(settingsJs, /ensureServerPushSubscription\(\)/);
  assert.match(settingsJs, /morningEnabled: desired/);
});

test("scheduler config fails closed without a long server secret", () => {
  const missing = notificationSchedulerConfig((name) => ({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    NOTIFICATION_SCHEDULER_SECRET: "short",
  })[name]);
  assert.equal(missing.configured, false);

  const configured = notificationSchedulerConfig((name) => ({
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
    NOTIFICATION_SCHEDULER_SECRET: "x".repeat(40),
  })[name]);
  assert.equal(configured.configured, true);
});

test("scheduler client sends origin-scoped claim and preserves null failure status", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url, body });
    if (String(url).endsWith("/claim_morning_notification_deliveries")) {
      return new Response(JSON.stringify([{
        delivery_id: "delivery-1",
        subscription_id: "subscription-1",
        endpoint: "https://push.example.test/send/123",
        p256dh: "B".repeat(87),
        auth_secret: "A".repeat(22),
        today_count: 1,
        overdue_count: 0,
        schedule_count: 2,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
  };

  const client = createNotificationSchedulerClient({
    supabaseUrl: "https://example.supabase.co",
    publishableKey: "sb_publishable_test",
    schedulerSecret: "s".repeat(40),
    fetchImpl,
  });
  const rows = await client.claimMorning({ appOrigin: "https://worklog.example.test", localDate: "2026-09-16" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].scheduleCount, 2);
  assert.equal(calls[0].body.p_app_origin, "https://worklog.example.test");
  assert.equal(calls[0].body.p_local_date, "2026-09-16");

  await client.finish({ deliveryId: "delivery-1", success: false, status: null, code: "NETWORK_ERROR" });
  assert.equal(calls[1].body.p_status, null);
  assert.equal(calls[1].body.p_code, "NETWORK_ERROR");
});
