import test from "node:test";
import assert from "node:assert/strict";
import {
  rankAudioFileHandles,
  recordingTimestampFromFilename,
} from "../public/call-folder-utils.mjs";

function handle(name) {
  return { kind: "file", name };
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

test("오디오가 아닌 파일과 폴더는 제외한다", () => {
  const ranked = rankAudioFileHandles([
    handle("call_20260912153000.m4a"),
    handle("memo.txt"),
    { kind: "directory", name: "nested" },
  ], 10);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].name, "call_20260912153000.m4a");
});
