import test from "node:test";
import assert from "node:assert/strict";

import {
  createCallTemporaryAudioRetention,
  deleteCallTemporaryAudio,
  retryCallTemporaryAudioDelete,
} from "../netlify/shared/call-retention-delete-adapter.mjs";

function callJob(overrides = {}) {
  return {
    jobId: "job-cleanup-1",
    requestId: "req-cleanup-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    kind: "call",
    operation: "process",
    status: "queued",
    createdAt: "2026-09-15T00:00:00.000Z",
    updatedAt: "2026-09-15T00:00:00.000Z",
    ...overrides,
  };
}

function preparedAudio(overrides = {}) {
  return {
    jobId: "job-cleanup-1",
    requestId: "req-cleanup-1",
    userId: "user-1",
    workspaceId: "workspace-1",
    uploadId: "upload-cleanup-1",
    objectPath: "tmp/calls/workspace-1/upload-cleanup-1.m4a",
    effectiveExpiresAt: "2026-09-15T06:00:00.000Z",
    ...overrides,
  };
}

function workspaceContext(overrides = {}) {
  return {
    userId: "user-1",
    workspaceId: "workspace-1",
    role: "owner",
    ...overrides,
  };
}

test("temporary audio retention reuses verified expiry and authorized call ownership", () => {
  const state = createCallTemporaryAudioRetention({
    job: callJob(),
    preparedAudio: preparedAudio(),
  }, { workspaceContext: workspaceContext() });

  assert.equal(state.recordType, "call_audio");
  assert.equal(state.recordId, "upload-cleanup-1");
  assert.equal(state.userId, "user-1");
  assert.equal(state.workspaceId, "workspace-1");
  assert.equal(state.retentionPolicy, "temporary_audio");
  assert.equal(state.expiresAt, "2026-09-15T06:00:00.000Z");
  assert.equal(state.deleteStatus, "none");
});

test("successful cleanup calls only canonical delete target and completes retention state", async () => {
  let deleteInput = null;
  const storageAdapter = {
    configured: true,
    async deleteObject(input) {
      deleteInput = input;
    },
  };

  const result = await deleteCallTemporaryAudio(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio(),
  }, {
    workspaceContext: workspaceContext(),
    now: "2026-09-15T00:20:00.000Z",
    completedAt: "2026-09-15T00:20:01.000Z",
  });

  assert.equal(result.deleted, true);
  assert.equal(deleteInput.uploadId, "upload-cleanup-1");
  assert.equal(deleteInput.objectPath, "tmp/calls/workspace-1/upload-cleanup-1.m4a");
  assert.deepEqual(deleteInput.sourceAudioRef, {
    sourceId: "upload-cleanup-1",
    objectPath: "tmp/calls/workspace-1/upload-cleanup-1.m4a",
  });
  assert.equal(result.retentionState.deleteStatus, "completed");
  assert.equal(result.retentionState.deleteRequestedAt, "2026-09-15T00:20:00.000Z");
  assert.equal(result.retentionState.deleteCompletedAt, "2026-09-15T00:20:01.000Z");
  assert.equal(result.retentionState.metadata.cleanupAttempt, 1);
});

test("delete failure is isolated as cleanup state and retry only repeats delete", async () => {
  let deleteCalls = 0;
  const storageAdapter = {
    configured: true,
    async deleteObject() {
      deleteCalls += 1;
      if (deleteCalls === 1) {
        const error = new Error("temporary outage");
        error.code = "STORAGE_TEMPORARY_FAILURE";
        throw error;
      }
    },
  };

  const failed = await deleteCallTemporaryAudio(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio(),
  }, {
    workspaceContext: workspaceContext(),
    now: "2026-09-15T00:20:00.000Z",
  });

  assert.equal(failed.deleted, false);
  assert.equal(failed.retentionState.deleteStatus, "failed");
  assert.equal(failed.retentionState.deleteErrorCode, "STORAGE_TEMPORARY_FAILURE");
  assert.equal(failed.retentionState.metadata.cleanupAttempt, 1);
  assert.equal(deleteCalls, 1);

  const retried = await retryCallTemporaryAudioDelete(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio(),
    retentionState: failed.retentionState,
  }, {
    workspaceContext: workspaceContext(),
    now: "2026-09-15T00:30:00.000Z",
    completedAt: "2026-09-15T00:30:01.000Z",
  });

  assert.equal(retried.deleted, true);
  assert.equal(retried.retentionState.deleteStatus, "completed");
  assert.equal(retried.retentionState.metadata.cleanupAttempt, 2);
  assert.equal(deleteCalls, 2);
});

test("verified audio ownership mismatch fails before storage delete", async () => {
  let called = false;
  const storageAdapter = {
    configured: true,
    async deleteObject() { called = true; },
  };

  await assert.rejects(() => deleteCallTemporaryAudio(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio({ workspaceId: "workspace-other" }),
  }, {
    workspaceContext: workspaceContext(),
  }), (error) => error?.code === "CALL_CLEANUP_OWNERSHIP_MISMATCH");
  assert.equal(called, false);
});

test("current workspace authorization must exist and match the Processing Job", async () => {
  let called = false;
  const storageAdapter = {
    configured: true,
    async deleteObject() { called = true; },
  };

  await assert.rejects(() => deleteCallTemporaryAudio(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio(),
  }), (error) => error?.code === "CALL_CLEANUP_WORKSPACE_CONTEXT_REQUIRED");

  await assert.rejects(() => deleteCallTemporaryAudio(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio(),
  }, {
    workspaceContext: workspaceContext({ workspaceId: "workspace-other" }),
  }), (error) => error?.code === "CALL_CLEANUP_WORKSPACE_CONTEXT_MISMATCH");
  assert.equal(called, false);
});

test("non-call job and unconfigured storage adapter fail closed", async () => {
  let called = false;
  const configured = {
    configured: true,
    async deleteObject() { called = true; },
  };
  await assert.rejects(() => deleteCallTemporaryAudio(configured, {
    job: callJob({ kind: "meeting" }),
    preparedAudio: preparedAudio(),
  }, {
    workspaceContext: workspaceContext(),
  }), (error) => error?.code === "CALL_PROCESSING_JOB_REQUIRED");
  assert.equal(called, false);

  const unconfigured = {
    configured: false,
    async deleteObject() { called = true; },
  };
  await assert.rejects(() => deleteCallTemporaryAudio(unconfigured, {
    job: callJob(),
    preparedAudio: preparedAudio(),
  }, {
    workspaceContext: workspaceContext(),
  }), (error) => error?.code === "STORAGE_NOT_CONFIGURED");
  assert.equal(called, false);
});

test("cleanup retry accepts only failed state for same target and owner", async () => {
  const storageAdapter = {
    configured: true,
    async deleteObject() {},
  };
  const noneState = createCallTemporaryAudioRetention({
    job: callJob(),
    preparedAudio: preparedAudio(),
  }, { workspaceContext: workspaceContext() });
  await assert.rejects(() => retryCallTemporaryAudioDelete(storageAdapter, {
    job: callJob(),
    preparedAudio: preparedAudio(),
    retentionState: noneState,
  }, {
    workspaceContext: workspaceContext(),
  }), (error) => error?.code === "CALL_CLEANUP_RETRY_STATE_INVALID");
});
