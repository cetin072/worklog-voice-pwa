import test from "node:test";
import assert from "node:assert/strict";

import { isValidIdempotencyRequestId } from "../netlify/shared/platform/idempotency.mjs";
import {
  buildCallPlatformIdempotency,
  buildPlatformRequestIdFromCallRequestId,
} from "../netlify/shared/call-idempotency-adapter.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };

test("통화의 legacy attempt requestId를 Platform 호환 ID로 손실 없이 변환한다", () => {
  const callRequestId = "req_1720000000000_abc123";
  const platformRequestId = buildPlatformRequestIdFromCallRequestId(callRequestId);

  assert.notEqual(platformRequestId, callRequestId);
  assert.match(platformRequestId, /^call-[a-f0-9]+$/);
  assert.equal(isValidIdempotencyRequestId(platformRequestId), true);
  assert.equal(buildPlatformRequestIdFromCallRequestId(callRequestId), platformRequestId);
});

test("통화 fingerprint는 서로 다른 attempt에서도 Platform canonical key의 deduplication 기준으로 유지한다", () => {
  const first = buildCallPlatformIdempotency({
    requestId: "req_1720000000000_first001",
    idempotencyKey: "call_fingerprint_001",
    workspaceContext,
  });
  const second = buildCallPlatformIdempotency({
    requestId: "req_1720000001000_second02",
    idempotencyKey: "call_fingerprint_001",
    workspaceContext,
  });

  assert.equal(first.callRequestId, "req_1720000000000_first001");
  assert.equal(second.callRequestId, "req_1720000001000_second02");
  assert.notEqual(first.requestId, second.requestId);
  assert.equal(first.canonicalKey, second.canonicalKey);
  assert.match(first.canonicalKey, /:domain:call_fingerprint_001$/);
});

test("다른 통화 fingerprint는 같은 attempt ID여도 서로 다른 Platform canonical key를 만든다", () => {
  const base = {
    requestId: "req_1720000000000_same0001",
    workspaceContext,
  };
  assert.notEqual(
    buildCallPlatformIdempotency({ ...base, idempotencyKey: "call_fingerprint_001" }).canonicalKey,
    buildCallPlatformIdempotency({ ...base, idempotencyKey: "call_fingerprint_002" }).canonicalKey,
  );
});

test("fingerprint와 attempt ID는 조용히 생략하거나 잘라내지 않는다", () => {
  assert.throws(
    () => buildCallPlatformIdempotency({ requestId: "req_1720000000000_missing", workspaceContext }),
    (error) => error?.code === "CALL_IDEMPOTENCY_KEY_REQUIRED",
  );
  assert.throws(
    () => buildPlatformRequestIdFromCallRequestId("a".repeat(48)),
    (error) => error?.code === "CALL_REQUEST_ID_TOO_LONG_FOR_PLATFORM",
  );
});
