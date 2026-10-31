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
const safetyMigration = readFileSync(new URL("../supabase/migrations/20260919154119_stage4_notification_scheduler_safety.sql", import.meta.url), "utf8");

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

