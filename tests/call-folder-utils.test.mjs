import test from "node:test";
import assert from "node:assert/strict";
import {
  dateInputRange,
  rankAudioFileHandles,
  recentCalendarRange,
  recordingTimestampFromFilename,
  selectAudioFilesInRange,
  selectAudioHandlesInRange,
} from "../public/call-folder-utils.mjs";

function handle(name) {
  return { kind: "file", name };
}

function pickedFile(name, lastModified = 0, type = "audio/mp4") {
  return { name, lastModified, type, size: 1024 };
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function timestampName(date, prefix = "통화") {
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${prefix}_01012345678_${stamp}.m4a`;
}

test("14자리 파일명 시간을 읽는다", () => {
  const value = recordingTimestampFromFilename("sample_20260912152048.m4a");
  const date = new Date(value);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 12);
  assert.equal(date.getHours(), 15);
  assert.equal(date.getMinutes(), 20);
  assert.equal(date.getSeconds(), 48);
});

test("실제 TPhoneCallRecords 파일명 형식의 시간을 읽는다", () => {
  const value = recordingTimestampFromFilename("이영희장모님_01084480302_20260912152048.m4a");
  const date = new Date(value);
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 8);
  assert.equal(date.getDate(), 12);
  assert.equal(date.getHours(), 15);
  assert.equal(date.getMinutes(), 20);
  assert.equal(date.getSeconds(), 48);
});

test("파일을 열지 않고 이름만으로 최신 녹음을 우선 정렬한다", () => {
  const ranked = rankAudioFileHandles([
    handle("a_20260910100000.m4a"),
    handle("b_20260912153000.m4a"),
    handle("c_20260911120000.m4a"),
  ], 2);
  assert.deepEqual(ranked.map((item) => item.name), [
    "b_20260912153000.m4a",
    "c_20260911120000.m4a",
  ]);
});

test("최근 3일은 72시간이 아니라 오늘 포함 달력 3일로 계산한다", () => {
  const now = new Date(2026, 8, 13, 14, 30, 0);
  const range = recentCalendarRange(3, now);
  assert.ok(range);
  assert.equal(range.start.getFullYear(), 2026);
  assert.equal(range.start.getMonth(), 8);
  assert.equal(range.start.getDate(), 11);
  assert.equal(range.start.getHours(), 0);
  assert.equal(range.end.getDate(), 13);
  assert.equal(range.end.getHours(), 23);
});

test("최근 3일 범위는 오늘·어제·그제만 선택하고 그 이전은 제외한다", () => {
  const now = new Date(2026, 8, 13, 14, 30, 0);
  const range = recentCalendarRange(3, now);
  const selected = selectAudioHandlesInRange([
    handle("오늘_01012345678_20260913100000.m4a"),
    handle("어제_01012345678_20260912100000.m4a"),
    handle("그제_01012345678_20260911100000.m4a"),
    handle("나흘전_01012345678_20260910100000.m4a"),
  ], range, now);
  assert.equal(selected.totalAudioCount, 4);
  assert.equal(selected.matchedCount, 3);
  assert.deepEqual(selected.ranked.map((item) => item.name), [
    "오늘_01012345678_20260913100000.m4a",
    "어제_01012345678_20260912100000.m4a",
    "그제_01012345678_20260911100000.m4a",
  ]);
});

test("기억형 파일선택 결과도 최근 3일만 남긴다", () => {
  const range = recentCalendarRange(3, new Date(2026, 8, 13, 14, 30, 0));
  const selected = selectAudioFilesInRange([
    pickedFile("오늘_01012345678_20260913100000.m4a"),
    pickedFile("어제_01012345678_20260912100000.m4a"),
    pickedFile("그제_01012345678_20260911100000.m4a"),
    pickedFile("나흘전_01012345678_20260910100000.m4a"),
    pickedFile("memo.txt", Date.now(), "text/plain"),
  ], range);
  assert.equal(selected.totalAudioCount, 4);
  assert.equal(selected.matchedCount, 3);
  assert.deepEqual(selected.files.map((file) => file.name), [
    "오늘_01012345678_20260913100000.m4a",
    "어제_01012345678_20260912100000.m4a",
    "그제_01012345678_20260911100000.m4a",
  ]);
});

test("파일명 날짜가 없으면 명시적으로 선택한 파일의 수정일을 fallback으로 쓴다", () => {
  const range = dateInputRange("2026-09-12", "2026-09-12");
  const lastModified = new Date(2026, 8, 12, 9, 0, 0).getTime();
  const selected = selectAudioFilesInRange([
    pickedFile("날짜없는녹음.m4a", lastModified),
  ], range);
  assert.equal(selected.matchedCount, 1);
  assert.equal(selected.fallbackDateCount, 1);
});

test("사용자가 고른 시작일·종료일 범위만 선택한다", () => {
  const range = dateInputRange("2026-09-01", "2026-09-05");
  assert.ok(range);
  const selected = selectAudioHandlesInRange([
    handle("a_01012345678_20260831235959.m4a"),
    handle("b_01012345678_20260901000000.m4a"),
    handle("c_01012345678_20260905235959.m4a"),
    handle("d_01012345678_20260906000000.m4a"),
  ], range, new Date(2026, 8, 13));
  assert.deepEqual(selected.ranked.map((item) => item.name), [
    "c_01012345678_20260905235959.m4a",
    "b_01012345678_20260901000000.m4a",
  ]);
});

test("잘못된 기간 입력은 거부한다", () => {
  assert.equal(dateInputRange("2026-09-10", "2026-09-01"), null);
  assert.equal(dateInputRange("2026-02-30", "2026-03-01"), null);
  assert.equal(dateInputRange("", "2026-09-01"), null);
});

test("파일명 날짜를 읽을 수 없는 폴더 항목은 기간 자동선택에서 제외하고 개수를 센다", () => {
  const range = dateInputRange("2026-09-01", "2026-09-30");
  const selected = selectAudioHandlesInRange([
    handle("정상_01012345678_20260912123000.m4a"),
    handle("날짜없는녹음.m4a"),
  ], range, new Date(2026, 8, 13));
  assert.equal(selected.totalAudioCount, 2);
  assert.equal(selected.matchedCount, 1);
  assert.equal(selected.undatedCount, 1);
});

test("오디오가 아닌 파일과 폴더는 제외한다", () => {
  const ranked = rankAudioFileHandles([
    handle("call_20260912153000.m4a"),
    handle("memo.txt"),
    { kind: "directory", name: "nested" },
  ], 10);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, "call_20260912153000.m4a");
});
