import test from "node:test";
import assert from "node:assert/strict";

import {
  TEMP_STORAGE_MAX_RETENTION_HOURS,
  createUnconfiguredStorageAdapter,
  effectiveTemporaryStorageExpiry,
  isPreparedStorageObjectExpired,
  normalizePreparedStorageObject,
  normalizeStorageObjectPath,
} from "../netlify/shared/platform/storage-boundary.mjs";

const prepared = {
  uploadId: "upload-1",
  objectPath: "workspace-1/tmp/file.m4a",
  uploadedAt: "2026-09-13T00:00:00Z",
  expiresAt: "2026-09-14T12:00:00Z",
  sizeBytes: 1234,
  mimeType: "Audio/M4A",
  fileName: "call.m4a",
  metadata: { source: "call" },
};

test("기존 call prepared-upload 핵심 필드를 generic Storage 객체로 정규화한다", () => {
  const result = normalizePreparedStorageObject(prepared);
  assert.equal(result.uploadId, "upload-1");
  assert.equal(result.objectPath, "workspace-1/tmp/file.m4a");
  assert.equal(result.mimeType, "audio/m4a");
  assert.equal(result.sizeBytes, 1234);
  assert.equal(result.metadata.source, "call");
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.metadata), true);
});

test("snake_case 저장 경계도 canonical 필드로 읽는다", () => {
  const result = normalizePreparedStorageObject({
    upload_id: "u-2",
    object_path: "w/tmp/doc.pdf",
    uploaded_at: "2026-09-13T00:00:00Z",
    expires_at: "2026-09-13T01:00:00Z",
    size_bytes: 10,
    mime_type: "application/pdf",
    file_name: "doc.pdf",
  });
  assert.equal(result.uploadId, "u-2");
  assert.equal(result.objectPath, "w/tmp/doc.pdf");
});

test("URL/absolute/traversal object path를 차단한다", () => {
  for (const value of ["https://example.com/a", "/tmp/a", "a/../b", ""]) {
    assert.throws(() => normalizeStorageObjectPath(value), (e) => e?.code === "STORAGE_INVALID_OBJECT_PATH");
  }
});

test("semantic 식별자와 경로를 조용히 자르지 않는다", () => {
  assert.throws(
    () => normalizePreparedStorageObject({ ...prepared, uploadId: "u".repeat(161) }),
    (e) => e?.code === "STORAGE_INVALID_UPLOAD_ID",
  );
  assert.throws(
    () => normalizeStorageObjectPath("a".repeat(501)),
    (e) => e?.code === "STORAGE_INVALID_OBJECT_PATH",
  );
});

test("잘못된 시각과 만료 순서를 차단한다", () => {
  assert.throws(
    () => normalizePreparedStorageObject({ ...prepared, uploadedAt: "bad" }),
    (e) => e?.code === "STORAGE_INVALID_UPLOADED_AT",
  );
  assert.throws(
    () => normalizePreparedStorageObject({ ...prepared, expiresAt: "2026-09-12T00:00:00Z" }),
    (e) => e?.code === "STORAGE_INVALID_EXPIRY_ORDER",
  );
});

test("0 이하/비수치 size를 차단한다", () => {
  for (const sizeBytes of [0, -1, "bad"]) {
    assert.throws(
      () => normalizePreparedStorageObject({ ...prepared, sizeBytes }),
      (e) => e?.code === "STORAGE_INVALID_SIZE",
    );
  }
});

test("임시 저장 effective expiry는 source expiry와 정책 cap 중 빠른 시각을 쓴다", () => {
  assert.equal(TEMP_STORAGE_MAX_RETENTION_HOURS, 24);
  assert.equal(
    effectiveTemporaryStorageExpiry(prepared),
    "2026-09-14T00:00:00.000Z",
  );
  assert.equal(
    effectiveTemporaryStorageExpiry({ ...prepared, expiresAt: "2026-09-13T02:00:00Z" }, { maxRetentionHours: 6 }),
    "2026-09-13T02:00:00.000Z",
  );
});

test("24시간을 넘는 임시 저장 정책을 허용하지 않는다", () => {
  assert.throws(
    () => effectiveTemporaryStorageExpiry(prepared, { maxRetentionHours: 25 }),
    (e) => e?.code === "STORAGE_RETENTION_HOURS_INVALID",
  );
});

test("prepared object 만료 여부를 명시적 시각 기준으로 판단한다", () => {
  assert.equal(isPreparedStorageObjectExpired(prepared, "2026-09-14T11:59:59Z"), false);
  assert.equal(isPreparedStorageObjectExpired(prepared, "2026-09-14T12:00:00Z"), true);
});

test("미연결 Storage adapter는 모든 외부 동작을 잠근다", async () => {
  const adapter = createUnconfiguredStorageAdapter();
  assert.equal(adapter.configured, false);
  for (const action of ["createUploadTicket", "verifyPreparedUpload", "deleteObject"]) {
    await assert.rejects(() => adapter[action]({}), (e) => e?.code === "STORAGE_NOT_CONFIGURED");
  }
});
