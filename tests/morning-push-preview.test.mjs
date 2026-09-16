import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMorningPushPayload } from "../netlify/shared/morning-push-content.mjs";
import { buildMorningPushPreviewState } from "../netlify/shared/morning-push-preview-source.mjs";

const previewFunction = readFileSync(new URL("../netlify/functions/morning-push-preview.mts", import.meta.url), "utf8");
const settingsJs = readFileSync(new URL("../public/morning-push-settings.js", import.meta.url), "utf8");

test("live morning preview mirrors today/overdue/schedule rules and excludes system rows", () => {
  const state = buildMorningPushPreviewState({
    today: "2026-09-16",
    tasks: [
      { title: "어제 미완료 계약서", status: "in_progress", due_at: "2026-09-15T09:00:00+09:00", updated_at: "2026-09-15T11:00:00Z", metadata: {} },
      { title: "오늘 확인 업무", status: "needs_review", due_at: "2026-09-16T15:00:00+09:00", updated_at: "2026-09-16T02:00:00Z", metadata: {} },
      { title: "시스템 브리핑", status: "in_progress", due_at: "2026-09-16T10:00:00+09:00", metadata: { project: "SYSTEM_DAILY_BRIEFING" } },
      { title: "미래 업무", status: "waiting", due_at: "2026-09-17T09:00:00+09:00", metadata: {} },
    ],
    schedules: [
      { title: "거래처 미팅", status: "confirmed", starts_at: "2026-09-16T01:00:00Z", all_day: false },
      { title: "내일 일정", status: "confirmed", starts_at: "2026-09-17T01:00:00Z", all_day: false },
    ],
  }, { detailEnabled: true });

  assert.equal(state.todayCount, 1);
  assert.equal(state.overdueCount, 1);
  assert.equal(state.scheduleCount, 1);
  assert.equal(state.primaryWorkTitle, "어제 미완료 계약서");
  assert.equal(state.primaryWorkBucket, "overdue");
  assert.equal(state.primaryScheduleTitle, "거래처 미팅");
  assert.equal(state.primaryScheduleTime, "10:00");
  assert.deepEqual(buildMorningPushPayload(state), {
    title: "업무수첩 · 오늘 브리핑",
    body: "10:00 거래처 미팅\n지난 업무 · 어제 미완료 계약서\n오늘 할 일 1건 · 지난 업무 1건 · 오늘 일정 1건",
    url: "/#briefingCard",
    tag: "worklog-morning-digest",
  });
});

test("live morning preview sends nothing when there is no relevant work", () => {
  const state = buildMorningPushPreviewState({
    today: "2026-09-16",
    tasks: [{ title: "미래 업무", status: "waiting", due_at: "2026-09-20T09:00:00+09:00", metadata: {} }],
    schedules: [],
  });
  assert.equal(buildMorningPushPayload(state), null);
});

test("preview endpoint uses current briefing source without consuming scheduled delivery dedupe", () => {
  assert.match(previewFunction, /get_my_briefing_source/);
  assert.match(previewFunction, /buildMorningPushPreviewState/);
  assert.match(previewFunction, /buildMorningPushPayload/);
  assert.match(previewFunction, /app_origin:`eq\.\$\{origin\}`/);
  assert.match(previewFunction, /path:"\/api\/morning-push-preview"/);
  assert.doesNotMatch(previewFunction, /notification_deliveries/);
  assert.doesNotMatch(previewFunction, /claim_morning_notification_deliveries/);
});

test("settings diagnostics exposes a one-tap real morning message preview", () => {
  assert.match(settingsJs, /settingsMorningPushPreview/);
  assert.match(settingsJs, /오늘 브리핑 알림 보내보기/);
  assert.match(settingsJs, /\/api\/morning-push-preview/);
  assert.match(settingsJs, /ensureServerPushSubscription\(\)/);
  assert.match(settingsJs, /중복방지 이력에는 영향을 주지 않습니다/);
});
