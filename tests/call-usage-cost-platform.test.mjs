import test from "node:test";
import assert from "node:assert/strict";

import { normalizeProcessingJob } from "../netlify/shared/platform/processing-job.mjs";
import {
  CALL_PAID_PROCESSING_REQUIRED_APPROVALS,
  assertCallPaidProcessingAllowed,
  evaluateCallPaidProcessingCostGate,
  normalizeCallUsageEvents,
} from "../netlify/shared/call-usage-cost-adapter.mjs";

const now = new Date("2026-09-15T00:00:00+09:00");
const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };

function callJob(overrides = {}) {
  return normalizeProcessingJob({
    jobId: "job-call-1",
    requestId: "req-call-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    kind: "call",
    operation: "process",
    status: "queued",
    createdAt: now,
    updatedAt: now,
    ...overrides,
  });
}

test("STT usage를 Call Processing Job 소유권과 Platform Usage Event로 연결한다", () => {
  const events = normalizeCallUsageEvents({
    providerRequestId: "stt-provider-1",
    usage: {
      service: "stt",
      provider: "OpenAI",
      model: "stt-model",
      audioSeconds: 93.5,
      apiCalls: 1,
      nativeCost: 0.01,
      nativeCurrency: "USD",
      estimatedCostKrw: 14.2,
      actualCostKrw: 13.9,
    },
  }, { job: callJob(), callId: "call-1", now });

  assert.equal(events.length, 1);
  const [event] = events;
  assert.equal(event.schemaVersion, "v1");
  assert.equal(event.eventKey, "req-call-1:stt:stt-provider-1");
  assert.equal(event.requestId, "req-call-1");
  assert.equal(event.jobId, "job-call-1");
  assert.equal(event.userId, "user-1");
  assert.equal(event.workspaceId, "workspace-1");
  assert.equal(event.relatedType, "call");
  assert.equal(event.relatedId, "call-1");
  assert.equal(event.feature, "call_transcription");
  assert.equal(event.service, "stt");
  assert.equal(event.provider, "openai");
  assert.equal(event.model, "stt-model");
  assert.equal(event.providerRequestId, "stt-provider-1");
  assert.equal(event.audioSeconds, 93.5);
  assert.equal(event.apiCalls, 1);
  assert.equal(event.estimatedCostKrw, 14.2);
  assert.equal(event.actualCostKrw, 13.9);
});

test("AI token usage와 Storage bytes를 각각 보존한다", () => {
  const ai = normalizeCallUsageEvents({
    providerRequestId: "ai-provider-1",
    usage: {
      service: "ai",
      provider: "openai",
      model: "analysis-model",
      inputTokens: 1200,
      outputTokens: 240,
      apiCalls: 1,
      estimatedCostKrw: 21,
      actualCostKrw: null,
    },
  }, { job: callJob(), callId: "call-1", now });

  assert.equal(ai[0].feature, "call_summary");
  assert.equal(ai[0].inputTokens, 1200);
  assert.equal(ai[0].outputTokens, 240);
  assert.equal(ai[0].actualCostKrw, null);

  const storage = normalizeCallUsageEvents({
    usage: {
      service: "storage",
      operation: "temp_upload",
      provider: "object-store",
      storageBytes: 5_000_000,
      apiCalls: 1,
      estimatedCostKrw: 2,
    },
  }, { job: callJob(), callId: "call-1", now });

  assert.equal(storage[0].feature, "call_storage");
  assert.equal(storage[0].operation, "temp_upload");
  assert.equal(storage[0].storageBytes, 5_000_000);
  assert.equal(storage[0].eventKey, "req-call-1:storage:temp_upload");
});

test("같은 반환 payload의 동일 eventKey Usage Event는 한 건만 남긴다", () => {
  const usage = {
    service: "stt",
    feature: "call_transcription",
    provider: "clova",
    audioSeconds: 60,
    providerRequestId: "provider-same",
    estimatedCostKrw: 10,
  };
  const events = normalizeCallUsageEvents({ usage: [usage, { ...usage }] }, {
    job: callJob(),
    callId: "call-1",
    now,
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].eventKey, "req-call-1:stt:provider-same");
});

test("같은 eventKey에 서로 다른 usage가 충돌하면 조용히 덮어쓰지 않는다", () => {
  assert.throws(
    () => normalizeCallUsageEvents({
      usage: [
        { service: "ai", providerRequestId: "same", inputTokens: 100 },
        { service: "ai", providerRequestId: "same", inputTokens: 200 },
      ],
    }, { job: callJob(), callId: "call-1", now }),
    (error) => error?.code === "CALL_USAGE_EVENT_KEY_CONFLICT",
  );
});

test("provider payload가 소유권/eventKey를 주장해도 Call Job + Platform identity를 사용한다", () => {
  const [event] = normalizeCallUsageEvents({
    usage: {
      service: "ai",
      eventKey: "provider-event-key",
      id: "provider-legacy-id",
      userId: "provider-user",
      workspaceId: "provider-workspace",
      requestId: "provider-request",
      jobId: "provider-job",
      inputTokens: 10,
    },
  }, { job: callJob(), callId: "call-1", now });

  assert.equal(event.userId, "user-1");
  assert.equal(event.workspaceId, "workspace-1");
  assert.equal(event.requestId, "req-call-1");
  assert.equal(event.jobId, "job-call-1");
  assert.equal(event.eventKey, "req-call-1:ai:call_summary");
});

test("통화가 아닌 Processing Job은 Usage Adapter에서 차단한다", () => {
  assert.throws(
    () => normalizeCallUsageEvents({ usage: { service: "ai" } }, {
      job: callJob({ kind: "scan" }),
      now,
    }),
    (error) => error?.code === "CALL_PROCESSING_JOB_REQUIRED",
  );
});

test("기존 2인 유료 승인 의미를 Platform Cost Gate decision으로 표현한다", () => {
  assert.equal(CALL_PAID_PROCESSING_REQUIRED_APPROVALS, 2);

  const disabled = evaluateCallPaidProcessingCostGate({
    PAID_PROCESSING_ENABLED: "false",
    PAID_PROCESSING_APPROVAL_COUNT: "2",
  }, { workspaceContext, now });
  assert.equal(disabled.allowed, false);
  assert.equal(disabled.reason, "paid_processing_disabled");

  const insufficient = evaluateCallPaidProcessingCostGate({
    PAID_PROCESSING_ENABLED: "true",
    PAID_PROCESSING_APPROVAL_COUNT: "1",
  }, { workspaceContext, now });
  assert.equal(insufficient.allowed, false);
  assert.equal(insufficient.reason, "insufficient_approvals");
  assert.equal(insufficient.metadata.requiredApprovals, 2);

  const approved = evaluateCallPaidProcessingCostGate({
    PAID_PROCESSING_ENABLED: "true",
    PAID_PROCESSING_APPROVAL_COUNT: "2",
  }, { workspaceContext, now });
  assert.equal(approved.allowed, true);
  assert.equal(approved.reason, "approved");
  assert.equal(approved.feature, "call_processing");
  assert.equal(approved.service, "stt_ai");
  assert.equal(approved.userId, "user-1");
  assert.equal(approved.workspaceId, "workspace-1");
});

test("Cost Gate는 Workspace Context 없이는 fail-closed 한다", () => {
  assert.throws(
    () => evaluateCallPaidProcessingCostGate({
      PAID_PROCESSING_ENABLED: "true",
      PAID_PROCESSING_APPROVAL_COUNT: "2",
    }, { now }),
    (error) => error?.code === "WORKSPACE_CONTEXT_USER_REQUIRED",
  );
});

test("assert helper는 미승인 유료 처리를 차단하고 승인만 통과시킨다", () => {
  assert.throws(
    () => assertCallPaidProcessingAllowed({
      PAID_PROCESSING_ENABLED: "true",
      PAID_PROCESSING_APPROVAL_COUNT: "1",
    }, { workspaceContext, now }),
    (error) => error?.code === "COST_GATE_NOT_ALLOWED",
  );

  const approved = assertCallPaidProcessingAllowed({
    PAID_PROCESSING_ENABLED: "true",
    PAID_PROCESSING_APPROVAL_COUNT: "2",
  }, { workspaceContext, now });
  assert.equal(approved.allowed, true);
});
