import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeCallPreparedAudio,
  verifyCallPreparedAudio,
} from "../netlify/shared/call-storage-adapter.mjs";

function callJob(overrides = {}) {
  return {
    jobId: "job-call-001",
    requestId: "req-call-001",
    userId: "user-001",
    workspaceId: "workspace-001",
    kind: "call",
    operation: "process",
    status: "queued",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

function verifiedAudio(overrides = {}) {
  return {
    uploadId: "upload-001",
    objectPath: "tmp/calls/workspace-001/upload-001.m4a",
    uploadedAt: "2026-09-15T00:00:00.000Z",
    expiresAt: "2026-09-17T00:00:00.000Z",
    sizeBytes: 1024,
    mimeType: "audio/mp4",
    fileName: "call-001.m4a",
    metadata: { checksum: "sha256:fixture" },
    ...overrides,
  };
}

test("Call prepared audio reuses Platform 24h retention cap and job ownership", () => {
  const normalized = normalizeCallPreparedAudio(verifiedAudio(), {
    job: callJob(),
    now: "2026-09-15T00:10:00.000Z",
  });

  assert.equal(normalized.jobId, "job-call-001");
  assert.equal(normalized.requestId, "req-call-001");
  assert.equal(normalized.userId, "user-001");
  assert.equal(normalized.workspaceId, "workspace-001");
  assert.equal(normalized.effectiveExpiresAt, "2026-09-16T00:00:00.000Z");
  assert.equal(normalized.sourceExpiresAt, "2026-09-17T00:00:00.000Z");
  assert.deepEqual(normalized.sourceAudioRef, {
    sourceId: "upload-001",
    objectPath: "tmp/calls/workspace-001/upload-001.m4a",
  });
});

test("source expiry earlier than policy cap remains authoritative", () => {
  const normalized = normalizeCallPreparedAudio(verifiedAudio({
    expiresAt: "2026-09-15T06:00:00.000Z",
  }), {
    job: callJob(),
    now: "2026-09-15T00:10:00.000Z",
  });

  assert.equal(normalized.effectiveExpiresAt, "2026-09-15T06:00:00.000Z");
});

test("expired prepared audio fails closed before STT can consume it", () => {
  assert.throws(() => normalizeCallPreparedAudio(verifiedAudio({
    expiresAt: "2026-09-15T00:05:00.000Z",
  }), {
    job: callJob(),
    now: "2026-09-15T00:10:00.000Z",
  }), (error) => error?.code === "CALL_PREPARED_AUDIO_EXPIRED");
});

test("Call adapter rejects non-call Processing Jobs", () => {
  assert.throws(() => normalizeCallPreparedAudio(verifiedAudio(), {
    job: callJob({ kind: "meeting" }),
    now: "2026-09-15T00:10:00.000Z",
  }), (error) => error?.code === "CALL_PROCESSING_JOB_REQUIRED");
});

test("server verified storage result is canonical instead of client supplied objectPath", async () => {
  let received = null;
  const storageAdapter = {
    configured: true,
    async verifyPreparedUpload(input) {
      received = input;
      return verifiedAudio({
        objectPath: "tmp/calls/workspace-001/server-verified.m4a",
        metadata: { verifiedBy: "server" },
      });
    },
  };

  const normalized = await verifyCallPreparedAudio(storageAdapter, {
    job: callJob(),
    preparedUpload: {
      uploadId: "upload-001",
      objectPath: "client/spoofed/path.m4a",
      metadata: { workspaceId: "spoofed-workspace" },
    },
  }, {
    now: "2026-09-15T00:10:00.000Z",
  });

  assert.equal(received.preparedUpload.objectPath, "client/spoofed/path.m4a");
  assert.equal(normalized.objectPath, "tmp/calls/workspace-001/server-verified.m4a");
  assert.equal(normalized.workspaceId, "workspace-001");
  assert.equal(normalized.storageMetadata.verifiedBy, "server");
  assert.equal(normalized.sourceAudioRef.objectPath, "tmp/calls/workspace-001/server-verified.m4a");
});

test("prepared upload requires a server-issued uploadId before verification", async () => {
  let called = false;
  const storageAdapter = {
    configured: true,
    async verifyPreparedUpload() {
      called = true;
      return verifiedAudio();
    },
  };

  await assert.rejects(() => verifyCallPreparedAudio(storageAdapter, {
    job: callJob(),
    preparedUpload: { objectPath: "client/arbitrary/path.m4a" },
  }), (error) => error?.code === "CALL_PREPARED_UPLOAD_ID_REQUIRED");
  assert.equal(called, false);
});

test("unconfigured Storage adapter fails closed without verification", async () => {
  let called = false;
  const storageAdapter = {
    configured: false,
    async verifyPreparedUpload() {
      called = true;
      return verifiedAudio();
    },
  };

  await assert.rejects(() => verifyCallPreparedAudio(storageAdapter, {
    job: callJob(),
    preparedUpload: { uploadId: "upload-001" },
  }), (error) => error?.code === "STORAGE_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("server verification must correlate to the requested uploadId", async () => {
  const storageAdapter = {
    configured: true,
    async verifyPreparedUpload() {
      return verifiedAudio({ uploadId: "upload-other" });
    },
  };

  await assert.rejects(() => verifyCallPreparedAudio(storageAdapter, {
    job: callJob(),
    preparedUpload: { uploadId: "upload-001" },
  }, {
    now: "2026-09-15T00:10:00.000Z",
  }), (error) => error?.code === "CALL_STORAGE_VERIFICATION_MISMATCH");
});

test("Call adapter cannot silently exceed Platform temporary retention limit", () => {
  assert.throws(() => normalizeCallPreparedAudio(verifiedAudio(), {
    job: callJob(),
    now: "2026-09-15T00:10:00.000Z",
    maxRetentionHours: 25,
  }), (error) => error?.code === "STORAGE_RETENTION_HOURS_INVALID");
});
