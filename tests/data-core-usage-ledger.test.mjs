import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnconfiguredDataCoreUsageWriter,
  toUsageEventRow,
} from "../netlify/shared/data-core/usage-ledger.mjs";

const context = Object.freeze({
  userId: "user_usage_1",
  workspaceId: "workspace_usage_1",
  requestId: "request_usage_1",
  jobId: "job_usage_1",
  feature: "call",
  relatedType: "call",
  relatedId: "call_1",
  now: new Date("2026-09-15T00:00:00.000Z"),
});

test("Platform Usage Event V1을 Data Core usage_events row로 보존한다", () => {
  const row = toUsageEventRow({
    service: "stt",
    operation: "transcribe",
    provider: "fixture-stt",
    model: "ko-fast",
    providerRequestId: "provider_req_1",
    audioSeconds: 95.25,
    inputTokens: 12,
    outputTokens: 7,
    imageCount: 0,
    storageBytes: 4096,
    apiCalls: 2,
    nativeCost: 0.01234567,
    nativeCurrency: "usd",
    estimatedCostKrw: 18.5,
    actualCostKrw: 17.25,
    pricingVersion: "fixture-2026-09",
    metadata: { source: "unit-test" },
  }, context);

  assert.equal(row.schema_version, "v1");
  assert.equal(row.user_id, context.userId);
  assert.equal(row.workspace_id, context.workspaceId);
  assert.equal(row.request_id, context.requestId);
  assert.equal(row.job_id, context.jobId);
  assert.equal(row.event_key, "request_usage_1:stt:provider_req_1");
  assert.equal(row.feature, "call");
  assert.equal(row.service, "stt");
  assert.equal(row.audio_seconds, 95.25);
  assert.equal(row.input_tokens, 12);
  assert.equal(row.output_tokens, 7);
  assert.equal(row.storage_bytes, 4096);
  assert.equal(row.api_calls, 2);
  assert.equal(row.native_currency, "USD");
  assert.equal(row.estimated_cost_krw, 18.5);
  assert.equal(row.actual_cost_krw, 17.25);
  assert.equal(row.related_type, "call");
  assert.equal(row.related_id, "call_1");
  assert.equal(row.created_at, "2026-09-15T00:00:00.000Z");
  assert.deepEqual(row.metadata, { source: "unit-test" });
});

test("비어 있는 optional Usage 필드는 DB nullable 형태로 변환한다", () => {
  const row = toUsageEventRow({
    service: "ai",
    operation: "analyze",
    estimatedCostKrw: 3,
  }, context);

  assert.equal(row.job_id, context.jobId);
  assert.equal(row.provider, null);
  assert.equal(row.model, null);
  assert.equal(row.provider_request_id, null);
  assert.equal(row.pricing_version, null);
  assert.equal(row.actual_cost_krw, null);
  assert.equal(row.status, "success");
});

test("Usage 소유권이 없으면 Data Core row 생성도 fail-closed 한다", () => {
  assert.throws(
    () => toUsageEventRow({ feature: "call", service: "stt", requestId: "req_missing_owner" }),
    (error) => error?.code === "USAGE_EVENT_USER_REQUIRED",
  );
});

test("trusted writer가 연결되지 않은 상태에서는 기록을 성공 처리하지 않는다", async () => {
  const writer = createUnconfiguredDataCoreUsageWriter();
  assert.equal(writer.configured, false);
  await assert.rejects(
    () => writer.record({}),
    (error) => error?.code === "DATA_CORE_USAGE_WRITER_NOT_CONFIGURED",
  );
});
