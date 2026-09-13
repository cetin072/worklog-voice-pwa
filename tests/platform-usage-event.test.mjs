import test from "node:test";
import assert from "node:assert/strict";

import {
  USAGE_EVENT_SCHEMA_VERSION,
  buildUsageEventKey,
  createUnconfiguredUsageLedgerAdapter,
  normalizeUsageEvent,
} from "../netlify/shared/platform/usage-event.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };
const fixedNow = new Date("2026-09-14T00:00:00+09:00");

test("canonical Usage Event는 Workspace Context를 소비하고 role은 저장하지 않는다", () => {
  const event = normalizeUsageEvent({
    requestId: "req-1234567890123456",
    feature: "call_summary",
    service: "ai",
    operation: "summarize",
    provider: "OpenAI",
    model: "gpt-x",
    inputTokens: 100,
    outputTokens: 20,
    estimatedCostKrw: 50,
  }, { workspaceContext, now: fixedNow });

  assert.equal(event.schemaVersion, USAGE_EVENT_SCHEMA_VERSION);
  assert.equal(event.userId, "user-1");
  assert.equal(event.workspaceId, "workspace-1");
  assert.equal("role" in event, false);
  assert.equal(event.eventKey, "req-1234567890123456:ai:summarize");
  assert.equal(event.provider, "openai");
  assert.equal(event.createdAt, fixedNow.toISOString());
  assert.equal(Object.isFrozen(event), true);
});

test("기존 server ledger shape를 Workspace Context와 함께 정규화한다", () => {
  const event = normalizeUsageEvent({
    eventKey: "req-1:stt:provider-1",
    requestId: "req-1",
    feature: "call_transcription",
    service: "stt",
    provider: "clova",
    model: "basic",
    audioSeconds: 61.5,
    providerRequestId: "provider-1",
    status: "success",
  }, { workspaceContext, now: fixedNow });

  assert.equal(event.eventKey, "req-1:stt:provider-1");
  assert.equal(event.audioSeconds, 61.5);
  assert.equal(event.providerRequestId, "provider-1");
});

test("기존 client usage-meter shape는 id/userLabel/category/durationSeconds를 보존해 변환한다", () => {
  const event = normalizeUsageEvent({
    id: "legacy-local-1",
    createdAt: "2026-09-13T15:00:00.000Z",
    userLabel: "대표",
    feature: "call_transcription",
    category: "stt",
    durationSeconds: 32,
    imageCount: 2,
    estimatedCostKrw: 17,
  }, { workspaceContext });

  assert.equal(event.eventKey, "legacy-local-1");
  assert.equal(event.service, "stt");
  assert.equal(event.audioSeconds, 32);
  assert.equal(event.imageCount, 2);
  assert.equal(event.metadata.legacyUserLabel, "대표");
  assert.equal(event.metadata.legacyEventId, "legacy-local-1");
});

test("snake_case DB shape도 canonical field로 정규화한다", () => {
  const event = normalizeUsageEvent({
    event_key: "db-event-1",
    request_id: "db-request-1",
    user_id: "user-db",
    workspace_id: "workspace-db",
    service: "storage",
    feature: "scan_pdf",
    storage_bytes: 1234,
    provider_request_id: "storage-req",
    estimated_cost_krw: 3,
    actual_cost_krw: null,
    created_at: "2026-09-13T14:00:00.000Z",
  });

  assert.equal(event.userId, "user-db");
  assert.equal(event.workspaceId, "workspace-db");
  assert.equal(event.storageBytes, 1234);
  assert.equal(event.actualCostKrw, null);
});

test("음수 사용량과 비용은 0으로 정규화하고 actualCost null은 보존한다", () => {
  const event = normalizeUsageEvent({
    eventKey: "negative-test",
    feature: "call_summary",
    service: "ai",
    inputTokens: -3,
    outputTokens: -4,
    apiCalls: -1,
    nativeCost: -10,
    estimatedCostKrw: -20,
    actualCostKrw: null,
  }, { workspaceContext, now: fixedNow });

  assert.equal(event.inputTokens, 0);
  assert.equal(event.outputTokens, 0);
  assert.equal(event.apiCalls, 0);
  assert.equal(event.nativeCost, 0);
  assert.equal(event.estimatedCostKrw, 0);
  assert.equal(event.actualCostKrw, null);
});

test("deterministic eventKey는 같은 입력에 안정적이고 providerRequestId가 다르면 구분된다", () => {
  const base = { requestId: "req-22", service: "stt", feature: "call_transcription" };
  assert.equal(buildUsageEventKey(base), buildUsageEventKey(base));
  assert.notEqual(
    buildUsageEventKey({ ...base, providerRequestId: "a" }),
    buildUsageEventKey({ ...base, providerRequestId: "b" }),
  );
});

test("eventKey를 만들 정보가 없으면 명시적으로 실패한다", () => {
  assert.throws(
    () => normalizeUsageEvent({ feature: "call_summary", service: "ai" }, { workspaceContext, now: fixedNow }),
    (error) => error?.code === "USAGE_EVENT_KEY_REQUIRES_REQUEST_AND_SERVICE",
  );
});

test("Workspace 소유권이 없으면 Usage Event 생성을 차단한다", () => {
  assert.throws(
    () => normalizeUsageEvent({ eventKey: "event-1", feature: "call_summary", service: "ai" }, { now: fixedNow }),
    (error) => error?.code === "USAGE_EVENT_USER_REQUIRED",
  );
});

test("직접 전달된 userId/workspaceId 길이 초과를 조용히 자르지 않는다", () => {
  assert.throws(
    () => normalizeUsageEvent({
      eventKey: "event-1",
      userId: "u".repeat(201),
      workspaceId: "workspace-1",
      feature: "call_summary",
      service: "ai",
    }, { now: fixedNow }),
    (error) => error?.code === "USAGE_EVENT_USER_INVALID",
  );
});

test("feature/service 누락은 canonical Usage Event에서 차단한다", () => {
  assert.throws(
    () => normalizeUsageEvent({ eventKey: "event-1" }, { workspaceContext, now: fixedNow }),
    (error) => error?.code === "USAGE_EVENT_FEATURE_REQUIRED",
  );
  assert.throws(
    () => normalizeUsageEvent({ eventKey: "event-1", feature: "call_summary" }, { workspaceContext, now: fixedNow }),
    (error) => error?.code === "USAGE_EVENT_SERVICE_REQUIRED",
  );
});

test("잘못된 status는 success로 조용히 바꾸지 않는다", () => {
  assert.throws(
    () => normalizeUsageEvent({
      eventKey: "event-1",
      feature: "call_summary",
      service: "ai",
      status: "unknown",
    }, { workspaceContext, now: fixedNow }),
    (error) => error?.code === "USAGE_EVENT_STATUS_INVALID",
  );
});

test("잘못된 createdAt은 조용히 현재시각으로 바꾸지 않는다", () => {
  assert.throws(
    () => normalizeUsageEvent({
      eventKey: "event-1",
      feature: "call_summary",
      service: "ai",
      createdAt: "bad",
    }, { workspaceContext }),
    (error) => error?.code === "USAGE_EVENT_CREATED_AT_INVALID",
  );
});

test("미연결 Usage Ledger adapter는 비용 발생 경로를 명시적으로 잠근다", async () => {
  const adapter = createUnconfiguredUsageLedgerAdapter();
  assert.equal(adapter.configured, false);
  await assert.rejects(
    () => adapter.record({}),
    (error) => error?.code === "USAGE_LEDGER_NOT_CONFIGURED",
  );
});
