import test from "node:test";
import assert from "node:assert/strict";
import {
  createUnconfiguredCallStorageAdapter,
  normalizePreparedAudioSource,
} from "../netlify/shared/call-storage-contract.mjs";

test("검증된 직접 업로드 메타데이터를 내부 표준으로 정규화한다", () => {
  const result = normalizePreparedAudioSource({
    uploadId: "up-1",
    objectPath: "call-temp/user-1/up-1.m4a",
    uploadedAt: "2026-09-13T09:00:00Z",
    expiresAt: "2026-09-14T09:00:00Z",
    sizeBytes: 12_345_678,
    mimeType: "audio/mp4",
    fileName: "통화녹음.m4a",
  });
  assert.equal(result.objectPath, "call-temp/user-1/up-1.m4a");
  assert.equal(result.sizeBytes, 12_345_678);
  assert.equal(result.mimeType, "audio/mp4");
});

test("외부 URL이나 상위경로 이동이 들어간 objectPath는 거부한다", () => {
  assert.throws(() => normalizePreparedAudioSource({
    uploadId: "up-1",
    objectPath: "https://example.com/file.m4a",
    uploadedAt: "2026-09-13T09:00:00Z",
    expiresAt: "2026-09-14T09:00:00Z",
    sizeBytes: 1,
  }), /STORAGE_INVALID_OBJECT_PATH/);

  assert.throws(() => normalizePreparedAudioSource({
    uploadId: "up-2",
    objectPath: "call-temp/../secret.m4a",
    uploadedAt: "2026-09-13T09:00:00Z",
    expiresAt: "2026-09-14T09:00:00Z",
    sizeBytes: 1,
  }), /STORAGE_INVALID_OBJECT_PATH/);
});

test("만료시각은 업로드시각보다 뒤여야 한다", () => {
  assert.throws(() => normalizePreparedAudioSource({
    uploadId: "up-1",
    objectPath: "call-temp/up-1.m4a",
    uploadedAt: "2026-09-14T09:00:00Z",
    expiresAt: "2026-09-13T09:00:00Z",
    sizeBytes: 1,
  }), /STORAGE_INVALID_EXPIRY_ORDER/);
});

test("미연결 저장소 어댑터는 실제 업로드를 시도하지 않고 잠긴다", async () => {
  const adapter = createUnconfiguredCallStorageAdapter();
  assert.equal(adapter.configured, false);
  await assert.rejects(adapter.createUploadTicket(), (error) => error.code === "STORAGE_NOT_CONFIGURED");
});
