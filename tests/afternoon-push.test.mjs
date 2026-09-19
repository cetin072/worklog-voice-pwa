import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildAfternoonPushBody, buildAfternoonPushPayload } from "../netlify/shared/afternoon-push-content.mjs";
import { createNotificationSchedulerClient } from "../netlify/shared/notification-scheduler.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20260916173500_notification_afternoon_incomplete_v1.sql", import.meta.url), "utf8");
const scheduled = readFileSync(new URL("../netlify/functions/afternoon-push.mts", import.meta.url), "utf8");
const preview = readFileSync(new URL("../netlify/functions/afternoon-push-preview.mts", import.meta.url), "utf8");
const preferencesApi = readFileSync(new URL("../netlify/functions/notification-preferences.mts", import.meta.url), "utf8");
const settingsHtml = readFileSync(new URL("../public/settings.html", import.meta.url), "utf8");
const settingsJs = readFileSync(new URL("../public/morning-push-settings.js", import.meta.url), "utf8");
const notificationsJs = readFileSync(new URL("../public/notifications.js", import.meta.url), "utf8");
const safetyMigration = readFileSync(new URL("../supabase/migrations/20260920001000_stage4_notification_scheduler_safety.sql", import.meta.url), "utf8");

test("afternoon reminder shows one priority task and remaining counts", () => {
  assert.equal(
    buildAfternoonPushBody({ todayCount: 2, overdueCount: 1, detailEnabled: false }),
    "오늘 할 일 2건 · 지난 업무 1건",
  );
  assert.equal(
    buildAfternoonPushBody({
      todayCount: 2,
      overdueCount: 1,
      detailEnabled: true,
      primaryWorkTitle: "계약서 확인",
      primaryWorkBucket: "overdue",
    }),
    "지난 업무 · 계약서 확인\n오늘 할 일 2건 · 지난 업무 1건",
  );
  assert.equal(buildAfternoonPushPayload({ todayCount: 0, overdueCount: 0 }), null);
  assert.deepEqual(buildAfternoonPushPayload({ todayCount: 1 }), {
    title: "업무수첩 · 오후 업무 확인",
    body: "오늘 할 일 1건",
    url: "/#briefingCard",
    tag: "worklog-afternoon-incomplete",
  });
});

test("afternoon detail title is clipped and body stays compact", () => {
  const body = buildAfternoonPushBody({
    overdueCount: 3,
    primaryWorkTitle: "가".repeat(100),
    primaryWorkBucket: "overdue",
  });
  assert.ok(body.includes("…"));
  assert.ok(body.length <= 160);
  assert.match(body, /지난 업무 3건$/);
});

test("afternoon schedule is fixed to 16:30 Asia/Seoul and reuses Web Push infrastructure", () => {
  assert.match(scheduled, /schedule:"30 7 \* \* \*"/);
  assert.match(scheduled, /16:30 Asia\/Seoul/);
  assert.match(scheduled, /claimAfternoon/);
  assert.match(scheduled, /sendWebPush/);
  assert.match(scheduled, /client\.finish/);
  assert.doesNotMatch(scheduled, /OneSignal|Firebase Admin|Pusher|Twilio/);
});

test("afternoon preferences default off and claim sends only when due incomplete work remains", () => {
  assert.match(migration, /afternoon_enabled boolean not null default false/);
  assert.match(migration, /afternoon_time time without time zone not null default time '16:30'/);
  assert.match(migration, /kind in \('morning_digest','afternoon_incomplete'\)/);
  assert.match(migration, /ps\.app_origin = p_app_origin/);
  assert.match(migration, /c\.today_count \+ c\.overdue_count > 0/);
  assert.match(migration, /'afternoon_incomplete'/);
  assert.match(migration, /on conflict on constraint notification_deliveries_subscription_id_kind_local_date_key do nothing/);
  assert.match(migration, /SYSTEM_DAILY_BRIEFING/);
  assert.match(migration, /SYSTEM_SPLIT_SOURCE/);
  assert.match(migration, /SYSTEM_TEST/);
  assert.doesNotMatch(migration, /schedule_counts/);
});

test("afternoon claim keeps the scheduler secret and Stage 4-0 moves execution to service_role only", () => {
  assert.match(migration, /_notification_scheduler_secret_ok\(p_scheduler_secret\)/);
  assert.match(migration, /security definer/);
  assert.match(safetyMigration, /revoke all on function public\.claim_afternoon_notification_deliveries[\s\S]*from public, anon, authenticated/);
  assert.match(safetyMigration, /grant execute on function public\.claim_afternoon_notification_deliveries[\s\S]*to service_role/);
});

test("scheduler client normalizes afternoon claims through the shared claim contract", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ url: String(url), body });
    if (body.action === "claim_afternoon") {
      return new Response(JSON.stringify([{
        delivery_id: "delivery-a",
        subscription_id: "subscription-a",
        endpoint: "https://push.example.test/send/a",
        p256dh: "B".repeat(87),
        auth_secret: "A".repeat(22),
        today_count: 2,
        overdue_count: 1,
        schedule_count: 0,
        morning_detail_enabled: true,
        primary_work_title: "계약서 확인",
        primary_work_bucket: "overdue",
        primary_schedule_title: null,
        primary_schedule_time: null,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("true", { status: 200, headers: { "content-type": "application/json" } });
  };

  const client = createNotificationSchedulerClient({
    supabaseUrl: "https://example.supabase.co",
    schedulerSecret: "s".repeat(40),
    fetchImpl,
  });
  const rows = await client.claimAfternoon({ appOrigin: "https://worklog.example.test", localDate: "2026-09-16" });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].todayCount, 2);
  assert.equal(rows[0].overdueCount, 1);
  assert.equal(rows[0].scheduleCount, 0);
  assert.equal(rows[0].detailEnabled, true);
  assert.equal(rows[0].primaryWorkTitle, "계약서 확인");
  assert.equal(calls[0].body.action, "claim_afternoon");
  assert.equal(calls[0].body.localDate, "2026-09-16");
  assert.equal(calls[0].body.appOrigin, "https://worklog.example.test");
});

test("notification settings exposes and persists the afternoon option without weakening Push connection checks", () => {
  assert.match(preferencesApi, /afternoon_enabled/);
  assert.match(preferencesApi, /afternoon_time:"16:30:00"/);
  assert.match(preferencesApi, /afternoonEnabled/);
  assert.match(preferencesApi, /PUSH_SUBSCRIPTION_REQUIRED/);
  assert.match(preferencesApi, /app_origin:`eq\.\$\{origin\}`/);
  assert.match(settingsHtml, /id="settingsAfternoonPushEnabled"/);
  assert.match(settingsHtml, /오후 미완료 업무 알림 · 오후 4:30/);
  assert.match(settingsJs, /afternoonEnabled: desired/);
});

test("afternoon preview uses live Supabase data and never consumes scheduled delivery dedupe", () => {
  assert.match(preview, /get_my_briefing_source/);
  assert.match(preview, /buildMorningPushPreviewState/);
  assert.match(preview, /buildAfternoonPushPayload/);
  assert.match(preview, /app_origin:`eq\.\$\{origin\}`/);
  assert.match(preview, /path:"\/api\/afternoon-push-preview"/);
  assert.doesNotMatch(preview, /notification_deliveries/);
  assert.doesNotMatch(preview, /claim_afternoon_notification_deliveries/);
});

test("afternoon preview is one-tap in diagnostics and uses shared expired-subscription recovery", () => {
  assert.match(settingsJs, /settingsAfternoonPushPreview/);
  assert.match(settingsJs, /오후 업무 알림 보내보기/);
  assert.match(settingsJs, /notifications\?\.sendAfternoonPreviewPush/);
  assert.match(notificationsJs, /sendAfternoonPreviewPush[\s\S]*withServerPushSubscriptionRecovery/);
  assert.match(notificationsJs, /\/api\/afternoon-push-preview/);
  assert.doesNotMatch(settingsJs, /fetch\("\/api\/afternoon-push-preview"/);
});
