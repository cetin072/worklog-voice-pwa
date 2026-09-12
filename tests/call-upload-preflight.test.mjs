import test from "node:test";
import assert from "node:assert/strict";
import {
  fileFingerprint,
  normalizeUploadPreflightPolicy,
  validateAudioFileMeta,
  validateCallSelectionPreflight,
} from "../public/call-upload-preflight.mjs";

function meta(input = {}) {
  return {
    name: "고객_01012345678_0913140000.m4a",
    type: "audio/mp4",
    size: 1024,
    lastModified: 1000,
    durationSeconds: 60,
    ...input,
  };
}

test("공급자 한도를 임의 기본값으로 만들지 않는다", () => {
  const policy = normalizeUploadPreflightPolicy({});
  assert.equal(policy.maxFileBytes, null);
  assert.equal(policy.maxFileDurationSeconds, null);
  assert.equal(policy.providerLimitsConfirmed, false);
});

test("정상 오디오 메타데이터는 로컬 검사를 통과한다", () => {
  const result = validateAudioFileMeta(meta());
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("0바이트 파일은 차단한다", () => {
  const result = validateAudioFileMeta(meta({ size: 0 }));
  assert.equal(result.valid, false);
  assert.equal(result.errors.some((item) => item.code === "EMPTY_FILE"), true);
});

test("지원하지 않는 확장자와 MIME은 차단한다", () => {
  const result = validateAudioFileMeta(meta({ name: "note.txt", type: "text/plain" }));
  assert.equal(result.errors.some((item) => item.code === "UNSUPPORTED_AUDIO"), true);
});

test("공급자 파일 크기와 길이 정책을 주입하면 적용한다", () => {
  const policy = { maxFileBytes: 1000, maxFileDurationSeconds: 30, providerLimitsConfirmed: true };
  const result = validateAudioFileMeta(meta({ size: 1001, durationSeconds: 31 }), policy);
  assert.equal(result.errors.some((item) => item.code === "FILE_TOO_LARGE"), true);
  assert.equal(result.errors.some((item) => item.code === "FILE_TOO_LONG"), true);
});

test("같은 파일 fingerprint 중복을 차단한다", () => {
  const item = meta();
  assert.equal(fileFingerprint(item), fileFingerprint({ ...item }));
  const result = validateCallSelectionPreflight([item, { ...item }], { providerLimitsConfirmed: true });
  assert.equal(result.errors.some((issue) => issue.code === "DUPLICATE_FILE"), true);
});

test("선택 묶음 수와 총 용량/총 길이 정책을 검증한다", () => {
  const result = validateCallSelectionPreflight([
    meta({ name: "a.m4a", lastModified: 1, size: 600, durationSeconds: 70 }),
    meta({ name: "b.m4a", lastModified: 2, size: 600, durationSeconds: 70 }),
  ], {
    providerLimitsConfirmed: true,
    maxSelectedFiles: 1,
    maxTotalBytes: 1000,
    maxTotalDurationSeconds: 120,
  });
  assert.equal(result.errors.some((item) => item.code === "TOO_MANY_FILES"), true);
  assert.equal(result.errors.some((item) => item.code === "TOTAL_SIZE_TOO_LARGE"), true);
  assert.equal(result.errors.some((item) => item.code === "TOTAL_DURATION_TOO_LONG"), true);
});

test("공급자 한도가 미확정이면 로컬 검사가 성공해도 유료 처리 준비 완료가 아니다", () => {
  const result = validateCallSelectionPreflight([meta()], {});
  assert.equal(result.localValid, true);
  assert.equal(result.readyForPaidProcessing, false);
  assert.equal(result.warnings.some((item) => item.code === "PROVIDER_LIMITS_UNCONFIRMED"), true);
});

test("공급자 한도가 확정되고 오류가 없을 때만 유료 처리 준비 완료가 된다", () => {
  const result = validateCallSelectionPreflight([meta()], { providerLimitsConfirmed: true });
  assert.equal(result.localValid, true);
  assert.equal(result.readyForPaidProcessing, true);
});
