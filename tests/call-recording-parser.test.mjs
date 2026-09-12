import test from "node:test";
import assert from "node:assert/strict";
import {
  formatPhoneNumber,
  isSupportedAudioFilename,
  parseCallRecordingFilename,
  parseRecordingTimestamp,
} from "../public/call-recording-parser.mjs";

const fallback = new Date(2026, 8, 12, 20, 0, 0);

test("삼성 통화녹음 파일명에서 연락처, 전화번호, 시각을 추출한다", () => {
  const result = parseCallRecordingFilename("김대리_01012345678_0911143304.m4a", { fallbackDate: fallback });
  assert.equal(result.contact, "김대리");
  assert.equal(result.phone, "01012345678");
  assert.equal(result.phoneDisplay, "010-1234-5678");
  assert.equal(result.timestampSource, "filename");
  assert.equal(result.recordedAt.getFullYear(), 2026);
  assert.equal(result.recordedAt.getMonth(), 8);
  assert.equal(result.recordedAt.getDate(), 11);
  assert.equal(result.recordedAt.getHours(), 14);
  assert.equal(result.recordedAt.getMinutes(), 33);
  assert.equal(result.recordedAt.getSeconds(), 4);
});

test("괄호가 있는 연락처명도 그대로 보존한다", () => {
  const result = parseCallRecordingFilename("홍길동(mac)_01098765432_0911125814.m4a", { fallbackDate: fallback });
  assert.equal(result.contact, "홍길동(mac)");
  assert.equal(result.phoneDisplay, "010-9876-5432");
});

test("연락처명이 없으면 전화번호만 추출할 수 있다", () => {
  const result = parseCallRecordingFilename("01012345678_0911092343.m4a", { fallbackDate: fallback });
  assert.equal(result.contact, null);
  assert.equal(result.phone, "01012345678");
});

test("파일명 시각이 없으면 파일 날짜를 fallback으로 사용한다", () => {
  const result = parseCallRecordingFilename("회의녹음.m4a", { fallbackDate: fallback });
  assert.equal(result.timestampSource, "file");
  assert.equal(result.recordedAt.getTime(), fallback.getTime());
});

test("잘못된 날짜는 파일명 시각으로 인정하지 않는다", () => {
  assert.equal(parseRecordingTimestamp("0230143000", fallback), null);
});

test("14자리 타임스탬프도 지원한다", () => {
  const result = parseRecordingTimestamp("20260911143304", fallback);
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 8);
  assert.equal(result.getDate(), 11);
  assert.equal(result.getHours(), 14);
});

test("대표 오디오 확장자를 판별한다", () => {
  assert.equal(isSupportedAudioFilename("call.m4a"), true);
  assert.equal(isSupportedAudioFilename("call.MP3"), true);
  assert.equal(isSupportedAudioFilename("notes.txt"), false);
});

test("국내 번호 표시 형식을 정리한다", () => {
  assert.equal(formatPhoneNumber("0212345678"), "02-1234-5678");
  assert.equal(formatPhoneNumber("0311234567"), "031-123-4567");
});
