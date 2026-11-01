import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMorningPushPayload } from "../netlify/shared/morning-push-content.mjs";
import { buildMorningPushPreviewState } from "../netlify/shared/morning-push-preview-source.mjs";

const previewFunction = readFileSync(new URL("../netlify/functions/morning-push-preview.mts", import.meta.url), "utf8");

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

