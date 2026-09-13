import test from "node:test";
import assert from "node:assert/strict";

import {
  createRetryPlan,
  createUnconfiguredRetrySchedulerAdapter,
  isRetryPlanDue,
  normalizeRetryPolicy,
} from "../netlify/shared/platform/retry-plan.mjs";

function job(overrides = {}) {
  return {
    jobId: "job-1",
    requestId: "req-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    kind: "call",
    status: "processing",
    stage: "analyzing",
    attemptCount: 1,
    errorCode: "AI_TIMEOUT",
    errorMessage: "timeout",
    createdAt: "2026-09-13T00:00:00Z",
    ...overrides,
  };
}

const policy = { maxAttempts: 3, backoffMs: [1000, 5000, 10000] };

test("정책을 명시적으로 정규화하고 error code 중복을 제거한다", () => {
  const normalized = normalizeRetryPolicy({
    ...policy,
    retryableErrorCodes: ["AI_TIMEOUT", "AI_TIMEOUT"],
  });
  assert.deepEqual([...normalized.retryableErrorCodes], ["AI_TIMEOUT"]);
});

test("첫 실패는 첫 backoff로 scheduled plan을 만든다", () => {
  const plan = createRetryPlan(job(), policy, "2026-09-13T00:00:10Z");
  assert.equal(plan.status, "scheduled");
  assert.equal(plan.delayMs, 1000);
  assert.equal(plan.retryAt, "2026-09-13T00:00:11.000Z");
  assert.equal(plan.stage, "analyzing");
});

test("attempt가 증가하면 다음 backoff를 쓰고 마지막 backoff는 반복 가능하다", () => {
  assert.equal(createRetryPlan(job({ attemptCount: 2 }), policy, "2026-09-13T00:00:10Z").delayMs, 5000);
  const repeated = createRetryPlan(
    job({ attemptCount: 3 }),
    { maxAttempts: 5, backoffMs: [1000, 5000] },
    "2026-09-13T00:00:10Z",
  );
  assert.equal(repeated.delayMs, 5000);
});

test("maxAttempts 도달 시 exhausted이며 retryAt을 만들지 않는다", () => {
  const plan = createRetryPlan(job({ attemptCount: 3 }), policy);
  assert.equal(plan.status, "exhausted");
  assert.equal(plan.reason, "max_attempts_reached");
  assert.equal(plan.retryAt, null);
});

test("retryable code 목록에서 제외되면 not_retryable", () => {
  const plan = createRetryPlan(job(), { ...policy, retryableErrorCodes: ["NETWORK"] });
  assert.equal(plan.status, "not_retryable");
  assert.equal(plan.reason, "error_code_not_retryable");
});

test("retry due 여부를 deterministic하게 계산한다", () => {
  const plan = createRetryPlan(job(), policy, "2026-09-13T00:00:10Z");
  assert.equal(isRetryPlanDue(plan, "2026-09-13T00:00:10.999Z"), false);
  assert.equal(isRetryPlanDue(plan, "2026-09-13T00:00:11Z"), true);
});

test("terminal/오류 없는 Job은 retry plan 대상이 아니다", () => {
  assert.throws(
    () => createRetryPlan(job({ status: "failed", finishedAt: "2026-09-13T00:00:01Z" }), policy),
    (error) => error?.code === "RETRY_JOB_NOT_PROCESSING",
  );
  assert.throws(
    () => createRetryPlan(job({ errorCode: "", errorMessage: "" }), policy),
    (error) => error?.code === "RETRY_JOB_ERROR_REQUIRED",
  );
});

test("숨은 backoff 기본값 없이 잘못된 정책을 차단한다", () => {
  assert.throws(
    () => normalizeRetryPolicy({ maxAttempts: 3 }),
    (error) => error?.code === "RETRY_POLICY_BACKOFF_REQUIRED",
  );
  assert.throws(
    () => normalizeRetryPolicy({ maxAttempts: 0, backoffMs: [1] }),
    (error) => error?.code === "RETRY_POLICY_MAX_ATTEMPTS_INVALID",
  );
  assert.throws(
    () => normalizeRetryPolicy({ maxAttempts: 3, backoffMs: [86_400_001] }),
    (error) => error?.code === "RETRY_POLICY_BACKOFF_INVALID",
  );
});

test("error code 길이 초과를 조용히 잘라내지 않는다", () => {
  assert.throws(
    () => normalizeRetryPolicy({
      ...policy,
      retryableErrorCodes: ["X".repeat(101)],
    }),
    (error) => error?.code === "RETRY_POLICY_ERROR_CODES_INVALID",
  );
});

test("미연결 scheduler는 명시적으로 잠긴다", async () => {
  const adapter = createUnconfiguredRetrySchedulerAdapter();
  assert.equal(adapter.configured, false);
  await assert.rejects(
    () => adapter.schedule({}),
    (error) => error?.code === "RETRY_SCHEDULER_NOT_CONFIGURED",
  );
});
