import test from "node:test";
import assert from "node:assert/strict";
import { createUsageEvent } from "../public/usage-meter.mjs";
import { mergeUsageEvents, summarizeUsageByUser } from "../public/usage-sync.mjs";

function storageMock() {
  const values = new Map();
  return {
    getItem: (key) => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

test("다른 개발자 사용량을 병합하고 같은 이벤트 ID는 중복 제외한다", () => {
  const storage = storageMock();
  const first = createUsageEvent({
    id: "evt-a",
    createdAt: "2026-09-13T01:00:00+09:00",
    userLabel: "개발자 A",
    category: "stt",
    durationSeconds: 600,
    estimatedCostKrw: 100,
  });
  const second = createUsageEvent({
    id: "evt-b",
    createdAt: "2026-09-13T01:05:00+09:00",
    userLabel: "개발자 B",
    category: "stt",
    durationSeconds: 1200,
    estimatedCostKrw: 200,
  });

  const initial = mergeUsageEvents([first], storage);
  assert.equal(initial.added, 1);

  const merged = mergeUsageEvents([first, second], storage);
  assert.equal(merged.added, 1);
  assert.equal(merged.duplicate, 1);
  assert.equal(merged.total, 2);
});

test("이번 달 사용량을 개발자별로 나눠 합산한다", () => {
  const events = [
    createUsageEvent({ id: "a1", createdAt: "2026-09-02T10:00:00+09:00", userLabel: "개발자 A", category: "stt", durationSeconds: 600, estimatedCostKrw: 100 }),
    createUsageEvent({ id: "a2", createdAt: "2026-09-03T10:00:00+09:00", userLabel: "개발자 A", category: "ai", estimatedCostKrw: 50 }),
    createUsageEvent({ id: "b1", createdAt: "2026-09-04T10:00:00+09:00", userLabel: "개발자 B", category: "stt", durationSeconds: 1200, estimatedCostKrw: 250 }),
    createUsageEvent({ id: "old", createdAt: "2026-08-31T10:00:00+09:00", userLabel: "개발자 B", category: "stt", durationSeconds: 999, estimatedCostKrw: 999 }),
  ];

  const result = summarizeUsageByUser(events, new Date("2026-09-13T01:00:00+09:00"));
  assert.equal(result.length, 2);

  const developerB = result.find((item) => item.userLabel === "개발자 B");
  const developerA = result.find((item) => item.userLabel === "개발자 A");
  assert.equal(developerB.estimatedCostKrw, 250);
  assert.equal(developerB.durationSeconds, 1200);
  assert.equal(developerA.estimatedCostKrw, 150);
  assert.equal(developerA.sttCalls, 1);
  assert.equal(developerA.aiCalls, 1);
});
