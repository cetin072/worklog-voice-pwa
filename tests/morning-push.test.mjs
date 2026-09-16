import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMorningPushBody, buildMorningPushPayload } from "../netlify/shared/morning-push-content.mjs";
import { createNotificationSchedulerClient, notificationSchedulerConfig } from "../netlify/shared/notification-scheduler.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20260916140000_notification_morning_digest_v1.sql", import.meta.url), "utf8");
const contentMigration = readFileSync(new URL("../supabase/migrations/20260916152000_notification_content_settings_v1.sql", import.meta.url), "utf8");
const scheduled = readFileSync(new URL("../netlify/functions/morning-push.mts", import.meta.url), "utf8");
const preferencesApi = readFileSync(new URL("../netlify/functions/notification-preferences.mts", import.meta.url), "utf8");
const subscriptionApi = readFileSync(new URL("../netlify/functions/push-subscription.mts", import.meta.url), "utf8");
const settingsHtml = readFileSync(new URL("../public/settings.html", import.meta.url), "utf8");
const settingsJs = readFileSync(new URL("../public/morning-push-settings.js", import.meta.url), "utf8");

test("morning digest keeps count summary and can show two useful titles", () => {
  assert.equal(
    buildMorningPushBody({ todayCount: 2, overdueCount: 3, scheduleCount: 1, detailEnabled: false }),
    "오늘 할 일 2건 · 지난 업무 3건 · 오늘 일정 1건",
  );
  assert.equal(buildMorningPushBody({ todayCount: 0, overdueCount: 2, scheduleCount: 0, detailEnabled: false }), "지난 업무 2건");
  assert.equal(
    buildMorningPushBody({
      todayCount: 2,
      overdueCount: 3,
      scheduleCount: 1,
      primaryScheduleTitle: "거래처 미팅",
      primaryScheduleTime: "10:00",
      primaryWorkTitle: "계약서 확인",
      primaryWorkBucket: "overdue",
    }),
    "10:00 거래처 미팅\n지난 업무 · 계약서 확인\n오늘 할 일 2건 · 지난 업무 3건 · 오늘 일정 1건",
  );
  assert.equal(buildMorningPushPayload({ todayCount: 0, overdueCount: 0, scheduleCount: 0 }), null);
  assert.deepEqual(buildMorningPushPayload({ scheduleCount: 1 }), {
    title: "업무수첩 · 오늘 브리핑",
    body: "오늘 일정 1건",
    url: "/#briefingCard",
    tag: "worklog-morning-digest",
  });
});

test("morning detail titles are clipped and the notification body stays compact", () => {
  const body = buildMorningPushBody({
    todayCount: 1,
    scheduleCount: 1,
    primaryScheduleTitle: "가".repeat(100),
    primaryScheduleTime: "종일",
    primaryWorkTitle: "나".repeat(100),
    primaryWorkBucket: "today",
  });
  assert.ok(body.includes("…"));
  assert.ok(body.length <= 180);
  assert.match(body, /오늘 할 일 1건 · 오늘 일정 1건$/);
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

test("detail preference and focus titles are transient scheduler fields, not delivery history content", () => {
  assert.match(contentMigration, /morning_detail_enabled boolean not null default true/);
  assert.match(contentMigration, /primary_work_title text/);
  assert.match(contentMigration, /primary_schedule_title text/);
  assert.match(contentMigration, /btrim\(wr\.title\)/);
  assert.match(contentMigration, /btrim\(s\.title\)/);
  assert.match(contentMigration, /on conflict on constraint notification_deliveries_subscription_id_kind_local_date_key do nothing/);
  assert.doesNotMatch(contentMigration, /'primaryWorkTitle'/);
  assert.doesNotMatch(contentMigration, /'primaryScheduleTitle'/);
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
  assert.match(preferencesApi, /morning_detail_enabled/);
  assert.match(preferencesApi, /detailEnabled/);
  assert.match(subscriptionApi, /app_origin:origin/);
});

test("settings separates everyday notification options from collapsed diagnostics", () => {
  assert.match(settingsHtml, /<h2>알림 설정<\/h2>/);
  assert.match(settingsHtml, /id="settingsMorningPushEnabled"/);
  assert.match(settingsHtml, /id="settingsMorningPushDetailEnabled"/);
  assert.match(settingsHtml, /업무·일정 제목 표시/);
  assert.match(settingsHtml, /id="settingsNotificationDiagnostics"/);
  assert.match(settingsHtml, /알림 테스트·문제 해결/);
  assert.doesNotMatch(settingsHtml, /<details[^>]*id="settingsNotificationDiagnostics"[^>]*\sopen(?:\s|=|>)/);
  assert.match(settingsJs, /ensureServerPushSubscription\(\)/);
  assert.match(settingsJs, /morningEnabled: desired/);
  assert.match(settingsJs, /detailEnabled: Boolean\(detailToggle\.checked\)/);
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

test("scheduler client normalizes detail fields and preserves null failure status", async () => {
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
        morning_detail_enabled: true,
        primary_work_title: "계약서 확인",
        primary_work_bucket: "today",
        primary_schedule_title: "거래처 미팅",
        primary_schedule_time: "10:00",
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
  assert.equal(rows[0].detailEnabled, true);
  assert.equal(rows[0].primaryScheduleTime, "10:00");
  assert.equal(rows[0].primaryWorkTitle, "계약서 확인");
  assert.equal(calls[0].body.p_app_origin, "https://worklog.example.test");
  assert.equal(calls[0].body.p_local_date, "2026-09-16");

  await client.finish({ deliveryId: "delivery-1", success: false, status: null, code: "NETWORK_ERROR" });
  assert.equal(calls[1].body.p_status, null);
  assert.equal(calls[1].body.p_code, "NETWORK_ERROR");
});
