import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUsageEventKey,
  createUnconfiguredUsageLedgerAdapter,
  normalizeUsageLedgerEvent,
} from "../netlify/shared/usage-ledger-contract.mjs";

test("동일 공급자 요청은 동일 eventKey를 만든다", () => {
  const first = buildUsageEventKey({ requestId: "job-1", service: "stt", providerRequestId: "provider-77" });
  const second = buildUsageEventKey({ requestId: "job-1", service: "stt", providerRequestId: "provider-77" });
  assert.equal(first, second);
  assert.equal(first, "job-1:stt:provider-77");
});

test("usage 이벤트를 중앙 원장용 표준 형태로 정규화한다", () => {
  const event = normalizeUsageLedgerEvent({
    feature: "call_transcription",
    service: "stt",
    provider: "clova",
    model: "example",
    audioSeconds: 63.2,
    estimatedCostKrw: 30,
    providerRequestId: "provider-77",
  }, { requestId: "job-1", relatedType: "call", relatedId: "call-1" });
  assert.equal(event.eventKey, "job-1:stt:provider-77");
  assert.equal(event.audioSeconds, 63.2);
  assert.equal(event.relatedType, "call");
  assert.equal(event.relatedId, "call-1");
});

test("requestId 또는 service 없는 usage 이벤트는 idempotency 키를 만들지 않는다", () => {
  assert.throws(() => buildUsageEventKey({ service: "stt" }), /USAGE_EVENT_KEY_REQUIRES_REQUEST_AND_SERVICE/);
});

test("미연결 usage ledger는 기록을 수행하지 않고 잠긴다", async () => {
  const adapter = createUnconfiguredUsageLedgerAdapter();
  assert.equal(adapter.configured, false);
  await assert.rejects(adapter.record({}), (error) => error.code === "USAGE_LEDGER_NOT_CONFIGURED");
});
