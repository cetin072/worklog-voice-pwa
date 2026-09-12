import test from "node:test";
import assert from "node:assert/strict";
import {
  TRANSCRIPT_RETENTION,
  buildCallProcessingFingerprint,
  normalizeCallProcessingPolicy,
  tempAudioDisposition,
  transcriptDeleteAfter,
} from "../public/call-processing-policy.mjs";
import {
  canTransitionProcessingStatus,
  transitionProcessingJob,
} from "../netlify/shared/call-processing-state.mjs";

test("유료 처리와 원본 영구보관은 설정값으로 켤 수 없다", () => {
  const policy = normalizeCallProcessingPolicy({
    paidProcessingLocked: false,
    originalAudioPermanentStorage: true,
  });
  assert.equal(policy.paidProcessingLocked, true);
  assert.equal(policy.originalAudioPermanentStorage, false);
});

test("실패 음성 임시보관은 24시간을 넘지 않는다", () => {
  const policy = normalizeCallProcessingPolicy({ failedTempRetentionHours: 99, maxTempRetentionHours: 99 });
  assert.equal(policy.failedTempRetentionHours, 24);
  assert.equal(policy.maxTempRetentionHours, 24);
  const result = tempAudioDisposition("failed", "2026-09-13T00:00:00Z", policy, "2026-09-13T00:00:00Z");
  assert.equal(result.deleteAfter, "2026-09-14T00:00:00.000Z");
});

test("재시도하더라도 최초 업로드 기준 절대 24시간을 연장하지 않는다", () => {
  const result = tempAudioDisposition(
    "retry_wait",
    "2026-09-13T23:00:00Z",
    { failedTempRetentionHours: 6, maxTempRetentionHours: 24 },
    "2026-09-13T00:00:00Z",
  );
  assert.equal(result.deleteAfter, "2026-09-14T00:00:00.000Z");
});

test("정상 처리 완료와 삭제 대기 상태는 즉시 삭제 대상이다", () => {
  const completed = tempAudioDisposition("completed", "2026-09-13T00:00:00Z");
  const cleanup = tempAudioDisposition("cleanup_pending", "2026-09-13T00:00:00Z");
  assert.equal(completed.deleteImmediately, true);
  assert.equal(completed.deleteAfter, "2026-09-13T00:00:00.000Z");
  assert.equal(cleanup.deleteImmediately, true);
});

test("녹취록 30일 보관 정책의 삭제 시각을 계산한다", () => {
  const result = transcriptDeleteAfter("2026-09-13T00:00:00Z", { transcriptRetention: TRANSCRIPT_RETENTION.THIRTY_DAYS });
  assert.equal(result, "2026-10-13T00:00:00.000Z");
});

test("요약 후 삭제 정책은 저장 시각을 삭제 기준으로 사용한다", () => {
  const result = transcriptDeleteAfter("2026-09-13T00:00:00Z", { transcriptRetention: TRANSCRIPT_RETENTION.DELETE_AFTER_SUMMARY });
  assert.equal(result, "2026-09-13T00:00:00.000Z");
});

test("동일 녹음 파일은 동일 fingerprint를 만든다", () => {
  const input = { userKey: "dev-a", fileName: "홍길동_01012345678_0913140000.m4a", fileSize: 1024, lastModified: 12345 };
  assert.equal(buildCallProcessingFingerprint(input), buildCallProcessingFingerprint({ ...input }));
  assert.notEqual(buildCallProcessingFingerprint(input), buildCallProcessingFingerprint({ ...input, fileSize: 1025 }));
});

test("정상 처리 상태는 삭제 대기까지 순서대로 진행한다", () => {
  assert.equal(canTransitionProcessingStatus("queued", "uploading"), true);
  assert.equal(canTransitionProcessingStatus("uploading", "transcribing"), true);
  assert.equal(canTransitionProcessingStatus("transcribing", "completed"), false);
  assert.equal(canTransitionProcessingStatus("persisting", "cleanup_pending"), true);
  assert.equal(canTransitionProcessingStatus("persisting", "completed"), false);
  const cleanupJob = transitionProcessingJob({ status: "persisting", finishedAt: null }, "cleanup_pending", "2026-09-13T00:00:00Z");
  const completed = transitionProcessingJob(cleanupJob, "completed", "2026-09-13T00:00:01Z");
  assert.equal(completed.status, "completed");
  assert.equal(completed.finishedAt, "2026-09-13T00:00:01.000Z");
});
