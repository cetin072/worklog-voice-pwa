import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetState,
  createUsageEvent,
  estimateSttCost,
  monthKey,
  normalizeUsageSettings,
  summarizeUsage,
} from "../public/usage-meter.mjs";

test("OpenAI STT 1시간 예상비용을 계산한다", () => {
  const result = estimateSttCost("openai-gpt-transcribe", 3600, { usdKrw: 1400 });
  assert.equal(result.currency, "USD");
  assert.equal(result.nativeCost, 0.27);
  assert.equal(Math.round(result.estimatedKrw), 378);
});

test("CLOVA 1시간 예상비용을 원화로 계산한다", () => {
  const result = estimateSttCost("clova-speech-basic", 3600, { usdKrw: 9999 });
  assert.equal(result.currency, "KRW");
  assert.equal(result.nativeCost, 1200);
  assert.equal(result.estimatedKrw, 1200);
});

test("AssemblyAI 1시간 예상비용을 계산한다", () => {
  const result = estimateSttCost("assemblyai-universal-2", 3600, { usdKrw: 1400 });
  assert.equal(result.nativeCost, 0.15);
  assert.equal(Math.round(result.estimatedKrw), 210);
});

test("이번 달 사용량만 합산한다", () => {
  const events = [
    createUsageEvent({ createdAt: "2026-09-02T00:00:00+09:00", category: "stt", durationSeconds: 600, estimatedCostKrw: 100 }),
    createUsageEvent({ createdAt: "2026-09-03T00:00:00+09:00", category: "ai", inputTokens: 1000, outputTokens: 200, estimatedCostKrw: 50 }),
    createUsageEvent({ createdAt: "2026-08-31T00:00:00+09:00", category: "stt", durationSeconds: 300, estimatedCostKrw: 999 }),
  ];
  const summary = summarizeUsage(events, new Date("2026-09-13T01:00:00+09:00"));
  assert.equal(summary.month, "2026-09");
  assert.equal(summary.events, 2);
  assert.equal(summary.sttCalls, 1);
  assert.equal(summary.aiCalls, 1);
  assert.equal(summary.durationSeconds, 600);
  assert.equal(summary.estimatedCostKrw, 150);
});

test("예산 경고와 초과 상태를 구분한다", () => {
  const settings = normalizeUsageSettings({ monthlyBudgetKrw: 10000, warningPercent: 70, usdKrw: 1400 });
  assert.equal(budgetState({ estimatedCostKrw: 6999 }, settings).warning, false);
  assert.equal(budgetState({ estimatedCostKrw: 7000 }, settings).warning, true);
  assert.equal(budgetState({ estimatedCostKrw: 10000 }, settings).exceeded, true);
});

test("유료 기능 잠금은 설정값으로 해제되지 않는다", () => {
  const settings = normalizeUsageSettings({ paidFeaturesLocked: false });
  assert.equal(settings.paidFeaturesLocked, true);
});

test("monthKey는 한국시간 기준 월 단위 키를 만든다", () => {
  assert.equal(monthKey(new Date("2026-09-13T00:00:00+09:00")), "2026-09");
  assert.equal(monthKey(new Date("2026-08-31T15:30:00Z")), "2026-09");
  assert.equal(monthKey(new Date("2026-08-31T14:30:00Z")), "2026-08");
});
