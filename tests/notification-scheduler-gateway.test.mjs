import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createNotificationSchedulerClient, notificationSchedulerConfig } from "../netlify/shared/notification-scheduler.mjs";

const gateway = readFileSync(new URL("../supabase/functions/notification-scheduler-gateway/index.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260919154119_stage4_notification_scheduler_safety.sql", import.meta.url), "utf8");

test("scheduler config is server-secret only and no longer depends on a public Supabase key", () => {
  const configured = notificationSchedulerConfig((name) => ({
    SUPABASE_URL: "https://example.supabase.co",
    NOTIFICATION_SCHEDULER_SECRET: "s".repeat(40),
  })[name]);
  assert.equal(configured.configured, true);
  assert.equal("publishableKey" in configured, false);

  const missingSecret = notificationSchedulerConfig((name) => ({
    SUPABASE_URL: "https://example.supabase.co",
  })[name]);
  assert.equal(missingSecret.configured, false);
});

test("Netlify scheduler calls one Edge gateway without exposing a service key", async () => {
  const calls = [];
  const client = createNotificationSchedulerClient({
    supabaseUrl: "https://example.supabase.co",
    schedulerSecret: "s".repeat(40),
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options, body: JSON.parse(options.body) });
      return new Response(JSON.stringify([{
        delivery_id: "11111111-1111-4111-8111-111111111111",
        subscription_id: "22222222-2222-4222-8222-222222222222",
        endpoint: "https://push.example.test/send/1",
        p256dh: "B".repeat(87),
        auth_secret: "A".repeat(22),
        today_count: 1,
        overdue_count: 0,
        schedule_count: 0,
      }]), { status: 200, headers: { "content-type": "application/json" } });
    },
  });

  const result = await client.claimMorning({ appOrigin: "https://worklog.example.test", localDate: "2026-09-20" });
  assert.equal(result.length, 1);
  assert.equal(calls[0].url, "https://example.supabase.co/functions/v1/notification-scheduler-gateway");
  assert.equal(calls[0].body.action, "claim_morning");
  assert.equal(calls[0].body.appOrigin, "https://worklog.example.test");
  assert.equal(calls[0].body.localDate, "2026-09-20");
  assert.equal(calls[0].options.headers["x-worklog-scheduler-secret"], "s".repeat(40));
  assert.equal("apikey" in calls[0].options.headers, false);
  assert.equal("authorization" in calls[0].options.headers, false);
});

test("Edge gateway only accepts whitelisted scheduler actions and uses server-only Supabase credentials", () => {
  assert.match(gateway, /const SECRET_HEADER = "x-worklog-scheduler-secret"/);
  assert.match(gateway, /action === "claim_morning" \|\| action === "claim_afternoon"/);
  assert.match(gateway, /action === "finish"/);
  assert.match(gateway, /SUPABASE_SECRET_KEYS/);
  assert.match(gateway, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(gateway, /apikey: secretKey/);
  assert.doesNotMatch(gateway, /authorization:\s*[`"']/i);
  assert.doesNotMatch(gateway, /console\.log\([^\n]*schedulerSecret|console\.error\([^\n]*schedulerSecret/);
});

test("Stage 4-0 migration removes public scheduler execution and grants only service_role", () => {
  for (const name of [
    "claim_morning_notification_deliveries",
    "claim_afternoon_notification_deliveries",
    "finish_notification_delivery",
  ]) {
    assert.match(migration, new RegExp(`revoke all on function public\\.${name}[\\s\\S]*from public, anon, authenticated`, "i"));
    assert.match(migration, new RegExp(`grant execute on function public\\.${name}[\\s\\S]*to service_role`, "i"));
  }
  assert.doesNotMatch(migration, /grant execute[\s\S]*to anon/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/i);
});
