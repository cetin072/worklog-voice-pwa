import test from "node:test";
import assert from "node:assert/strict";
import {
  ensureReadPermission,
  materializeFiles,
  readFolderFiles,
  scanFolderEntries,
} from "../public/call-folder-runtime.mjs";

function pad(value, size = 2) {
  return String(value).padStart(size, "0");
}

function recordingName(date, prefix = "테스트연락처_01012345678") {
  return `${prefix}_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.m4a`;
}

function fileHandle(name, options = {}) {
  return {
    kind: "file",
    name,
    async getFile() {
      options.onOpen?.(name);
      if (options.fail) throw new Error("open failed");
      if (options.delayMs) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
      return { name, size: 1000, type: "audio/mp4", lastModified: Date.now() };
    },
  };
}

function directoryHandle(entries) {
  return {
    name: "TPhoneCallRecords",
    async *values() {
      for (const entry of entries) yield entry;
    },
  };
}

test("폴더 스캔은 getFile을 호출하지 않고 최신 파일명만 선별한다", async () => {
  let openCount = 0;
  const entries = [];
  const base = new Date(2026, 8, 10, 9, 0, 0);
  for (let index = 0; index < 160; index += 1) {
    const date = new Date(base.getTime() + index * 60_000);
    entries.push(fileHandle(recordingName(date), { onOpen: () => { openCount += 1; } }));
  }
  entries.push({ kind: "file", name: "memo.txt", async getFile() { throw new Error("should not open"); } });
  entries.push({ kind: "directory", name: "nested" });

  const result = await scanFolderEntries(directoryHandle(entries), { maxFiles: 150, scanTimeoutMs: 1000 });

  assert.equal(openCount, 0);
  assert.equal(result.scannedCount, 162);
  assert.equal(result.totalAudioCount, 160);
  assert.equal(result.ranked.length, 150);
  assert.equal(result.newestName, recordingName(new Date(base.getTime() + 159 * 60_000)));
});

test("전체 폴더 흐름은 최신 파일만 열고 인덱싱 콜백 뒤에 파일을 연다", async () => {
  const events = [];
  const base = new Date(2026, 8, 12, 12, 0, 0);
  const entries = Array.from({ length: 5 }, (_, index) => {
    const name = recordingName(new Date(base.getTime() + index * 60_000));
    return fileHandle(name, { onOpen: () => events.push(`open:${name}`) });
  });

  const result = await readFolderFiles(
    directoryHandle(entries),
    (scan) => events.push(`indexed:${scan.totalAudioCount}`),
    { maxFiles: 3, scanTimeoutMs: 1000, fileOpenTimeoutMs: 100, totalTimeoutMs: 1000, concurrency: 2 },
  );

  assert.equal(events[0], "indexed:5");
  assert.equal(result.totalAudioCount, 5);
  assert.equal(result.files.length, 3);
  assert.equal(result.failedCount, 0);
  assert.deepEqual(result.files.map((file) => file.name), result.ranked.map((item) => item.name));
});

test("일부 파일 열기 실패가 있어도 나머지 녹음은 반환한다", async () => {
  const ranked = [
    { entry: fileHandle("a_20260912150000.m4a"), name: "a_20260912150000.m4a" },
    { entry: fileHandle("b_20260912140000.m4a", { fail: true }), name: "b_20260912140000.m4a" },
    { entry: fileHandle("c_20260912130000.m4a"), name: "c_20260912130000.m4a" },
  ];

  const result = await materializeFiles(ranked, { fileOpenTimeoutMs: 100, totalTimeoutMs: 1000, concurrency: 2 });
  assert.deepEqual(result.files.map((file) => file.name), ["a_20260912150000.m4a", "c_20260912130000.m4a"]);
  assert.equal(result.failedCount, 1);
});

test("멈춘 디렉터리 iterator는 FOLDER_SCAN_TIMEOUT으로 종료한다", async () => {
  const handle = {
    name: "TPhoneCallRecords",
    values() {
      return {
        [Symbol.asyncIterator]() { return this; },
        next() { return new Promise(() => {}); },
      };
    },
  };

  await assert.rejects(
    scanFolderEntries(handle, { scanTimeoutMs: 20 }),
    (error) => error?.code === "FOLDER_SCAN_TIMEOUT",
  );
});

test("폴더 iterator 미지원은 별도 오류 코드로 구분한다", async () => {
  await assert.rejects(
    scanFolderEntries({ name: "TPhoneCallRecords" }, { scanTimeoutMs: 20 }),
    (error) => error?.code === "DIRECTORY_ITERATOR_UNSUPPORTED",
  );
});

test("저장된 폴더 권한은 granted면 재요청하지 않고 prompt면 요청한다", async () => {
  let requests = 0;
  const granted = await ensureReadPermission({
    async queryPermission() { return "granted"; },
    async requestPermission() { requests += 1; return "granted"; },
  });
  assert.equal(granted, true);
  assert.equal(requests, 0);

  const prompted = await ensureReadPermission({
    async queryPermission() { return "prompt"; },
    async requestPermission() { requests += 1; return "granted"; },
  });
  assert.equal(prompted, true);
  assert.equal(requests, 1);
});
