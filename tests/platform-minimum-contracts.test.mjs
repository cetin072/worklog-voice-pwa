import test from "node:test";
import assert from "node:assert/strict";

import {
  createUnconfiguredPermissionEvaluator,
  normalizePermissionDecision,
} from "../netlify/shared/platform/permission-decision.mjs";
import {
  SYNC_STATUSES,
  normalizeSyncState,
} from "../netlify/shared/platform/sync-state.mjs";
import {
  DELETE_STATUSES,
  isRetentionExpired,
  normalizeRetentionDeleteState,
} from "../netlify/shared/platform/retention-delete.mjs";
import {
  AUDIT_OUTCOMES,
  createUnconfiguredAuditWriter,
  normalizeAuditEvent,
} from "../netlify/shared/platform/audit-event.mjs";

const workspaceContext = { userId: "user-1", workspaceId: "workspace-1", role: "owner" };
const now = new Date("2026-09-14T00:00:00Z");

test("Permission Decision은 Workspace Context와 명시적 boolean 판정을 보존한다", () => {
  const decision = normalizePermissionDecision({ permission: "Call.Delete", allowed: false, reason: "owner confirmation required" }, { workspaceContext, now });
  assert.equal(decision.permission, "call.delete");
  assert.equal(decision.allowed, false);
  assert.equal(decision.userId, "user-1");
  assert.equal(decision.workspaceId, "workspace-1");
  assert.equal(decision.role, "owner");
  assert.equal(decision.evaluatedAt, now.toISOString());
});

test("Permission Decision은 truthy/falsy coercion 없이 boolean을 요구한다", () => {
  assert.throws(
    () => normalizePermissionDecision({ permission: "call.delete", allowed: "yes" }, { workspaceContext }),
    (e) => e?.code === "PERMISSION_ALLOWED_REQUIRED",
  );
});

test("미연결 Permission evaluator는 fail-closed", async () => {
  const evaluator = createUnconfiguredPermissionEvaluator();
  await assert.rejects(() => evaluator.evaluate({}), (e) => e?.code === "PERMISSION_EVALUATOR_NOT_CONFIGURED");
});

test("Sync State는 공식 최소 상태 4개만 공개한다", () => {
  assert.deepEqual([...SYNC_STATUSES], ["local", "pending", "synced", "failed"]);
});

test("Sync State는 local/pending 상태를 Workspace 소유권과 함께 정규화한다", () => {
  const local = normalizeSyncState({ recordType: "call_report", recordId: "call-1", status: "local" }, { workspaceContext, now });
  assert.equal(local.status, "local");
  assert.equal(local.workspaceId, "workspace-1");
  assert.equal("role" in local, false);
  const pending = normalizeSyncState({ recordType: "call_report", recordId: "call-1", status: "pending", lastAttemptAt: now }, { workspaceContext, now });
  assert.equal(pending.lastAttemptAt, now.toISOString());
});

test("synced는 syncedAt, failed는 오류정보를 요구한다", () => {
  assert.throws(
    () => normalizeSyncState({ recordType: "x", recordId: "1", status: "synced" }, { workspaceContext }),
    (e) => e?.code === "SYNC_SYNCED_AT_REQUIRED",
  );
  assert.throws(
    () => normalizeSyncState({ recordType: "x", recordId: "1", status: "failed" }, { workspaceContext }),
    (e) => e?.code === "SYNC_ERROR_REQUIRED",
  );
  const synced = normalizeSyncState({ recordType: "x", recordId: "1", status: "synced", syncedAt: now }, { workspaceContext, now });
  assert.equal(synced.syncedAt, now.toISOString());
});

test("Sync semantic ID 길이와 metadata 형식을 조용히 보정하지 않는다", () => {
  assert.throws(
    () => normalizeSyncState({ recordType: "x", recordId: "r".repeat(201), status: "local" }, { workspaceContext }),
    (e) => e?.code === "SYNC_RECORD_ID_INVALID",
  );
  assert.throws(
    () => normalizeSyncState({ recordType: "x", recordId: "1", status: "local", metadata: [] }, { workspaceContext }),
    (e) => e?.code === "SYNC_METADATA_INVALID",
  );
});

test("Retention/Delete는 공식 삭제 상태를 공개하고 none 기본상태를 정규화한다", () => {
  assert.deepEqual([...DELETE_STATUSES], ["none", "requested", "completed", "failed"]);
  const state = normalizeRetentionDeleteState({
    recordType: "call_report",
    recordId: "call-1",
    retentionPolicy: "keep_local",
  }, { workspaceContext });
  assert.equal(state.deleteStatus, "none");
  assert.equal(state.expiresAt, null);
});

test("Retention expiresAt helper는 role 없는 normalized state에서도 동작한다", () => {
  const state = normalizeRetentionDeleteState({
    recordType: "temp_upload",
    recordId: "obj-1",
    retentionPolicy: "temporary",
    expiresAt: "2026-09-14T01:00:00Z",
  }, { workspaceContext });
  assert.equal("role" in state, false);
  assert.equal(isRetentionExpired(state, "2026-09-14T00:59:59Z"), false);
  assert.equal(isRetentionExpired(state, "2026-09-14T01:00:00Z"), true);
});

test("Delete requested/completed/failed 상태별 필수값과 순서를 검증한다", () => {
  assert.throws(
    () => normalizeRetentionDeleteState({ recordType: "x", recordId: "1", retentionPolicy: "keep", deleteStatus: "requested" }, { workspaceContext }),
    (e) => e?.code === "DELETE_REQUESTED_AT_REQUIRED",
  );
  assert.throws(
    () => normalizeRetentionDeleteState({
      recordType: "x", recordId: "1", retentionPolicy: "keep", deleteStatus: "completed",
      deleteRequestedAt: "2026-09-14T02:00:00Z", deleteCompletedAt: "2026-09-14T01:00:00Z",
    }, { workspaceContext }),
    (e) => e?.code === "DELETE_COMPLETION_ORDER_INVALID",
  );
  assert.throws(
    () => normalizeRetentionDeleteState({
      recordType: "x", recordId: "1", retentionPolicy: "keep", deleteStatus: "failed",
      deleteRequestedAt: "2026-09-14T01:00:00Z",
    }, { workspaceContext }),
    (e) => e?.code === "DELETE_ERROR_REQUIRED",
  );
});

test("Delete 상태에 모순되는 완료/실패 필드를 차단한다", () => {
  assert.throws(
    () => normalizeRetentionDeleteState({
      recordType: "x", recordId: "1", retentionPolicy: "keep", deleteStatus: "requested",
      deleteRequestedAt: "2026-09-14T01:00:00Z", deleteErrorCode: "X",
    }, { workspaceContext }),
    (e) => e?.code === "DELETE_STATE_INCONSISTENT",
  );
  assert.throws(
    () => normalizeRetentionDeleteState({
      recordType: "x", recordId: "1", retentionPolicy: "keep", deleteStatus: "failed",
      deleteRequestedAt: "2026-09-14T01:00:00Z", deleteCompletedAt: "2026-09-14T02:00:00Z", deleteErrorCode: "X",
    }, { workspaceContext }),
    (e) => e?.code === "DELETE_STATE_INCONSISTENT",
  );
});

test("Audit Event는 고위험 사건의 actor/workspace/target/outcome을 정규화한다", () => {
  assert.deepEqual([...AUDIT_OUTCOMES], ["success", "failed", "denied"]);
  const event = normalizeAuditEvent({
    eventId: "audit-1",
    action: "delete.request",
    targetType: "call_report",
    targetId: "call-1",
    outcome: "success",
    requestId: "req-1",
    metadata: { source: "user" },
  }, { workspaceContext, now });
  assert.equal(event.userId, "user-1");
  assert.equal(event.workspaceId, "workspace-1");
  assert.equal(event.action, "delete.request");
  assert.equal(event.occurredAt, now.toISOString());
  assert.equal(event.metadata.source, "user");
});

test("Audit Event는 event/target ID와 outcome을 엄격히 검증한다", () => {
  assert.throws(
    () => normalizeAuditEvent({ eventId: "", action: "x", targetType: "x", targetId: "1", outcome: "success" }, { workspaceContext }),
    (e) => e?.code === "AUDIT_EVENT_ID_REQUIRED",
  );
  assert.throws(
    () => normalizeAuditEvent({ eventId: "a", action: "x", targetType: "x", targetId: "1", outcome: "unknown" }, { workspaceContext }),
    (e) => e?.code === "AUDIT_OUTCOME_INVALID",
  );
  assert.throws(
    () => normalizeAuditEvent({ eventId: "a", action: "x", targetType: "x", targetId: "t".repeat(201), outcome: "success" }, { workspaceContext }),
    (e) => e?.code === "AUDIT_TARGET_ID_INVALID",
  );
});

test("미연결 Audit writer는 fail-closed", async () => {
  const writer = createUnconfiguredAuditWriter();
  await assert.rejects(() => writer.append({}), (e) => e?.code === "AUDIT_WRITER_NOT_CONFIGURED");
});
