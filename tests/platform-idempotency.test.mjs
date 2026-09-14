import test from "node:test";
import assert from "node:assert/strict";

import { isValidClientRequestId } from "../netlify/shared/core-logic.mjs";
import {
  IDEMPOTENCY_DOMAIN_KEY_MAX_LENGTH,
  IDEMPOTENCY_REQUIRED_CONSISTENCY,
  buildIdempotencyKey,
  buildLegacyWorklogIdempotencyKey,
  createUnconfiguredIdempotencyStoreAdapter,
  isValidIdempotencyRequestId,
  normalizeCompletedIdempotencyRecord,
  normalizeIdempotencyContext,
  normalizeIdempotencyScope,
} from "../netlify/shared/platform/idempotency.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };

test("Platform request ID 검증은 main 실사용 규칙과 동일하다", () => {
  const samples = [
    "1234567890123456",
    "abc-def-1234567890",
    "short",
    "bad_value_1234567890",
    "a".repeat(100),
    "a".repeat(101),
    "",
    null,
  ];
  for (const sample of samples) {
    assert.equal(isValidIdempotencyRequestId(sample), isValidClientRequestId(sample));
  }
});

test("scope는 소문자 canonical 형태로 정규화하고 잘못된 값은 차단한다", () => {
  assert.equal(normalizeIdempotencyScope(" Worklog.Save "), "worklog.save");
  assert.throws(
    () => normalizeIdempotencyScope("bad scope"),
    (error) => error?.code === "IDEMPOTENCY_SCOPE_INVALID",
  );
});

test("Idempotency Context는 Workspace Context를 선택적으로 소비한다", () => {
  assert.deepEqual(
    normalizeIdempotencyContext({
      scope: "worklog.save",
      clientRequestId: "abc-def-1234567890",
      workspaceContext,
    }),
    {
      schemaVersion: "v1",
      scope: "worklog.save",
      requestId: "abc-def-1234567890",
      userId: "user-1",
      workspaceId: "workspace-1",
    },
  );
});

test("기존 main 호환을 위해 Workspace 없는 legacy Context도 허용한다", () => {
  const context = normalizeIdempotencyContext({
    scope: "worklog.save",
    requestId: "abc-def-1234567890",
  });
  assert.equal(context.userId, "");
  assert.equal(context.workspaceId, "");
});

test("canonical key는 같은 Context에서 안정적이고 Workspace가 다르면 구분된다", () => {
  const input = {
    scope: "call.process",
    requestId: "abc-def-1234567890",
    workspaceContext,
  };
  const key = buildIdempotencyKey(input);
  assert.equal(key, buildIdempotencyKey({ ...input, scope: "CALL.PROCESS" }));
  assert.notEqual(
    key,
    buildIdempotencyKey({
      ...input,
      workspaceContext: { ...workspaceContext, workspaceId: "workspace-2" },
    }),
  );
});

test("domain idempotencyKey가 없으면 기존 request 기반 canonical key를 정확히 유지한다", () => {
  assert.equal(
    buildIdempotencyKey({
      scope: "call.process",
      requestId: "abc-def-1234567890",
      workspaceContext,
    }),
    "idem:v1:call.process:workspace:workspace-1:user:user-1:request:abc-def-1234567890",
  );
});

test("같은 domain idempotencyKey는 requestId가 달라도 같은 canonical key를 만든다", () => {
  const first = buildIdempotencyKey({
    scope: "call.process",
    requestId: "abc-def-1234567890",
    idempotencyKey: "fingerprint:recording-001",
    workspaceContext,
  });
  const second = buildIdempotencyKey({
    scope: "call.process",
    requestId: "xyz-def-1234567890",
    idempotencyKey: "fingerprint:recording-001",
    workspaceContext,
  });
  assert.equal(first, second);
  assert.match(first, /:domain:fingerprint%3Arecording-001$/);
});

test("서로 다른 domain idempotencyKey는 서로 다른 canonical key를 만든다", () => {
  const base = {
    scope: "call.process",
    requestId: "abc-def-1234567890",
    workspaceContext,
  };
  assert.notEqual(
    buildIdempotencyKey({ ...base, idempotencyKey: "fingerprint:recording-001" }),
    buildIdempotencyKey({ ...base, idempotencyKey: "fingerprint:recording-002" }),
  );
});

test("domain idempotencyKey는 조용히 자르지 않고 최대 길이를 초과하면 거부한다", () => {
  assert.equal(
    normalizeIdempotencyContext({
      scope: "call.process",
      requestId: "abc-def-1234567890",
      idempotencyKey: "a".repeat(IDEMPOTENCY_DOMAIN_KEY_MAX_LENGTH),
    }).idempotencyKey.length,
    IDEMPOTENCY_DOMAIN_KEY_MAX_LENGTH,
  );
  assert.throws(
    () => normalizeIdempotencyContext({
      scope: "call.process",
      requestId: "abc-def-1234567890",
      idempotencyKey: "a".repeat(IDEMPOTENCY_DOMAIN_KEY_MAX_LENGTH + 1),
    }),
    (error) => error?.code === "IDEMPOTENCY_DOMAIN_KEY_TOO_LONG",
  );
});

test("기존 worklog Blob key 형식은 정확히 보존한다", () => {
  assert.equal(
    buildLegacyWorklogIdempotencyKey("abc-def-1234567890"),
    "request:abc-def-1234567890",
  );
});

test("잘못된 request ID는 legacy/canonical 양쪽에서 차단한다", () => {
  assert.throws(
    () => buildLegacyWorklogIdempotencyKey("short"),
    (error) => error?.code === "IDEMPOTENCY_REQUEST_ID_INVALID",
  );
  assert.throws(
    () => normalizeIdempotencyContext({ scope: "worklog.save", requestId: "short" }),
    (error) => error?.code === "IDEMPOTENCY_REQUEST_ID_INVALID",
  );
});

test("완료 record는 generic result를 보존하고 Workspace 소유권을 포함한다", () => {
  const record = normalizeCompletedIdempotencyRecord({
    scope: "worklog.save",
    requestId: "abc-def-1234567890",
    result: { pageId: "page-1", url: "https://example.invalid/page-1" },
    createdAt: "2026-09-13T00:00:00.000Z",
  }, { workspaceContext });

  assert.equal(record.status, "completed");
  assert.equal(record.workspaceId, "workspace-1");
  assert.equal(record.userId, "user-1");
  assert.equal(record.result.pageId, "page-1");
  assert.equal(record.completedAt, "2026-09-13T00:00:00.000Z");
  assert.equal(Object.isFrozen(record), true);
  assert.equal(Object.isFrozen(record.result), true);
});

test("완료 record는 optional domain idempotencyKey를 보존한다", () => {
  const record = normalizeCompletedIdempotencyRecord({
    scope: "call.process",
    requestId: "abc-def-1234567890",
    idempotencyKey: "fingerprint:recording-001",
    result: { callId: "call-1" },
    completedAt: "2026-09-13T00:00:00.000Z",
  }, { workspaceContext });

  assert.equal(record.idempotencyKey, "fingerprint:recording-001");
});

test("완료 record는 result 객체가 없으면 명시적으로 실패한다", () => {
  assert.throws(
    () => normalizeCompletedIdempotencyRecord({
      scope: "worklog.save",
      requestId: "abc-def-1234567890",
    }, { workspaceContext }),
    (error) => error?.code === "IDEMPOTENCY_RESULT_REQUIRED",
  );
});

test("미연결 store adapter는 strong consistency 요구를 드러내고 명시적으로 잠긴다", async () => {
  const adapter = createUnconfiguredIdempotencyStoreAdapter();
  assert.equal(adapter.configured, false);
  assert.equal(adapter.consistency, IDEMPOTENCY_REQUIRED_CONSISTENCY);
  await assert.rejects(
    () => adapter.get("key"),
    (error) => error?.code === "IDEMPOTENCY_STORE_NOT_CONFIGURED",
  );
  await assert.rejects(
    () => adapter.put("key", {}),
    (error) => error?.code === "IDEMPOTENCY_STORE_NOT_CONFIGURED",
  );
});
