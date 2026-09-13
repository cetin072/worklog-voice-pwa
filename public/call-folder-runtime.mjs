import { selectAudioHandlesInRange } from "./call-folder-utils.mjs";

export const DEFAULT_SCAN_TIMEOUT_MS = 20000;
export const DEFAULT_FILE_OPEN_TIMEOUT_MS = 4000;
export const DEFAULT_FILE_OPEN_TOTAL_TIMEOUT_MS = 20000;
export const DEFAULT_FILE_OPEN_CONCURRENCY = 6;

export function timeoutError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

export function withTimeout(promise, timeoutMs, code, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(timeoutError(code, message)), Math.max(1, timeoutMs));
    Promise.resolve(promise).then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function ensureReadPermission(handle) {
  if (!handle) return false;
  try {
    if (typeof handle.queryPermission === "function") {
      const current = await handle.queryPermission({ mode: "read" });
      if (current === "granted") return true;
    }
    if (typeof handle.requestPermission === "function") {
      return (await handle.requestPermission({ mode: "read" })) === "granted";
    }
    return true;
  } catch {
    return false;
  }
}

export function directoryIterator(handle) {
  if (typeof handle?.values === "function") return handle.values()[Symbol.asyncIterator]();
  if (typeof handle?.entries === "function") return handle.entries()[Symbol.asyncIterator]();
  throw timeoutError("DIRECTORY_ITERATOR_UNSUPPORTED", "폴더 목록 읽기를 지원하지 않는 브라우저입니다.");
}

export async function scanFolderEntries(handle, options = {}) {
  const scanTimeoutMs = Math.max(1, Number(options.scanTimeoutMs) || DEFAULT_SCAN_TIMEOUT_MS);
  const iterator = directoryIterator(handle);
  const entries = [];
  const deadline = Date.now() + scanTimeoutMs;
  let scannedCount = 0;

  while (true) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw timeoutError("FOLDER_SCAN_TIMEOUT", "폴더 목록 확인 시간이 초과됐습니다.");
    const step = await withTimeout(
      iterator.next(),
      remaining,
      "FOLDER_SCAN_TIMEOUT",
      "폴더 목록 확인 시간이 초과됐습니다.",
    );
    if (step.done) break;
    const raw = step.value;
    const entry = Array.isArray(raw) ? raw[1] : raw;
    scannedCount += 1;
    if (entry?.kind === "file") entries.push(entry);
  }

  const selected = selectAudioHandlesInRange(entries, {
    startMs: options.startMs,
    endMs: options.endMs,
  }, options.fallbackDate || new Date());

  return {
    ...selected,
    scannedCount,
  };
}

export async function materializeFiles(ranked = [], options = {}) {
  if (!ranked.length) return { files: [], failedCount: 0 };
  const fileOpenTimeoutMs = Math.max(1, Number(options.fileOpenTimeoutMs) || DEFAULT_FILE_OPEN_TIMEOUT_MS);
  const totalTimeoutMs = Math.max(1, Number(options.totalTimeoutMs) || DEFAULT_FILE_OPEN_TOTAL_TIMEOUT_MS);
  const concurrency = Math.max(1, Math.floor(Number(options.concurrency) || DEFAULT_FILE_OPEN_CONCURRENCY));
  const deadline = Date.now() + totalTimeoutMs;
  const files = new Array(ranked.length).fill(null);
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor++;
      if (index >= ranked.length) return;
      const remaining = deadline - Date.now();
      if (remaining <= 0) return;
      try {
        files[index] = await withTimeout(
          ranked[index].entry.getFile(),
          Math.min(fileOpenTimeoutMs, remaining),
          "FILE_OPEN_TIMEOUT",
          "녹음파일 열기 시간이 초과됐습니다.",
        );
      } catch {
        // 일부 파일 실패는 나머지 날짜 범위의 파일을 계속 불러온다.
      }
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(concurrency, ranked.length) },
    () => worker(),
  ));

  const opened = files.filter(Boolean);
  return { files: opened, failedCount: ranked.length - opened.length };
}

export async function readFolderFiles(handle, onIndexed = null, options = {}) {
  const scan = await scanFolderEntries(handle, options);
  onIndexed?.(scan);
  const opened = await materializeFiles(scan.ranked, options);
  return { ...scan, ...opened };
}
