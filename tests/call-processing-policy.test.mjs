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
  const result = tempAudioDisposition("failed", "2026-09-13T00:00:00Z", policy);
  assert.equal(result.deleteAfter, "2026-09-14T00:00:00.000Z");
});

test("정상 처리 완료 시 원본 임시파일은 즉시 삭제 대상이다", () => {
  const result = tempAudioDisposition("completed", "2026-09-13T00:00:00Z");
  assert.equal(result.deleteImmediately, true);
  assert.equal(result.deleteAfter, "2026-09-13T00:00:00.000Z");
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

test("정상 처리 상태는 순서대로 진행할 수 있다", () => {
  assert.equal(canTransitionProcessingStatus("queued", "uploading"), true);
  assert.equal(canTransitionProcessingStatus("uploading", "transcribing"), true);
  assert.equal(canTransitionProcessingStatus("transcribing", "completed"), false);
  const job = transitionProcessingJob({ status: "persisting", finishedAt: null }, "completed", "2026-09-13T00:00:00Z");
  assert.equal(job.status, "completed");
  assert.equal(job.finishedAt, "2026-09-13T00:00:00.000Z");
});
