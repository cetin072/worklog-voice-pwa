import {
  isSupportedAudioFilename,
  parseRecordingTimestamp,
} from "./call-recording-parser.mjs";

export function isAudioCandidate(file = {}) {
  const name = String(file.name || "");
  const type = String(file.type || "").toLowerCase();
  return isSupportedAudioFilename(name) || type.startsWith("audio/");
}

export function recordingTimestampFromFilename(filename, fallbackDate = new Date()) {
  const source = String(filename || "");
  const base = source.replace(/\.(m4a|mp4|mp3|wav|aac|ogg|opus|3gp)$/i, "");
  const token = base.split("_").at(-1) || "";
  const parsed = parseRecordingTimestamp(token, fallbackDate);
  return parsed ? parsed.getTime() : 0;
}

export function rankAudioFileHandles(entries = [], limit = Number.POSITIVE_INFINITY, fallbackDate = new Date()) {
  const max = Number.isFinite(Number(limit))
    ? Math.max(1, Math.floor(Number(limit)))
    : Number.POSITIVE_INFINITY;
  return [...entries]
    .filter((entry) => entry?.kind === "file" && isSupportedAudioFilename(entry.name))
    .map((entry) => ({
      entry,
      name: String(entry.name || ""),
      timestampMs: recordingTimestampFromFilename(entry.name, fallbackDate),
    }))
    .sort((a, b) => {
      if (b.timestampMs !== a.timestampMs) return b.timestampMs - a.timestampMs;
      return b.name.localeCompare(a.name, "ko");
    })
    .slice(0, max);
}

export function startOfLocalDay(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return null;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate(), 0, 0, 0, 0);
}

export function endOfLocalDay(date = new Date()) {
  const start = startOfLocalDay(date);
  if (!start) return null;
  return new Date(start.getFullYear(), start.getMonth(), start.getDate(), 23, 59, 59, 999);
}

export function recentCalendarRange(days = 3, now = new Date()) {
  const count = Math.max(1, Math.floor(Number(days) || 3));
  const end = endOfLocalDay(now);
  const today = startOfLocalDay(now);
  if (!end || !today) return null;
  const start = new Date(today);
  start.setDate(start.getDate() - (count - 1));
  return { startMs: start.getTime(), endMs: end.getTime(), start, end };
}

export function parseLocalDateInput(value, endOfDay = false) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""));
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = endOfDay
    ? new Date(year, month - 1, day, 23, 59, 59, 999)
    : new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) return null;
  return date;
}

export function dateInputRange(startValue, endValue) {
  const start = parseLocalDateInput(startValue, false);
  const end = parseLocalDateInput(endValue, true);
  if (!start || !end || start.getTime() > end.getTime()) return null;
  return { startMs: start.getTime(), endMs: end.getTime(), start, end };
}

export function selectAudioHandlesInRange(entries = [], range = {}, fallbackDate = new Date()) {
  const startMs = Number.isFinite(Number(range.startMs)) ? Number(range.startMs) : Number.NEGATIVE_INFINITY;
  const endMs = Number.isFinite(Number(range.endMs)) ? Number(range.endMs) : Number.POSITIVE_INFINITY;
  const all = rankAudioFileHandles(entries, Number.POSITIVE_INFINITY, fallbackDate);
  const dated = all.filter((item) => item.timestampMs > 0);
  const ranked = dated.filter((item) => item.timestampMs >= startMs && item.timestampMs <= endMs);
  return {
    ranked,
    totalAudioCount: all.length,
    matchedCount: ranked.length,
    undatedCount: all.length - dated.length,
    newestName: ranked[0]?.name || "",
  };
}

export function selectedFileTimestamp(file = {}) {
  const fallback = Number(file.lastModified || 0);
  const fallbackDate = fallback > 0 ? new Date(fallback) : new Date();
  const fromName = recordingTimestampFromFilename(file.name, fallbackDate);
  if (fromName > 0) return { timestampMs: fromName, source: "filename" };
  if (fallback > 0) return { timestampMs: fallback, source: "lastModified" };
  return { timestampMs: 0, source: "unknown" };
}

export function selectAudioFilesInRange(files = [], range = {}) {
  const startMs = Number.isFinite(Number(range.startMs)) ? Number(range.startMs) : Number.NEGATIVE_INFINITY;
  const endMs = Number.isFinite(Number(range.endMs)) ? Number(range.endMs) : Number.POSITIVE_INFINITY;
  const all = [...files]
    .filter(isAudioCandidate)
    .map((file) => {
      const parsed = selectedFileTimestamp(file);
      return { file, ...parsed };
    });
  const matched = all
    .filter((item) => item.timestampMs >= startMs && item.timestampMs <= endMs)
    .sort((a, b) => b.timestampMs - a.timestampMs);
  return {
    files: matched.map((item) => item.file),
    totalAudioCount: all.length,
    matchedCount: matched.length,
    undatedCount: all.filter((item) => item.timestampMs <= 0).length,
    fallbackDateCount: all.filter((item) => item.source === "lastModified").length,
    newestName: matched[0]?.file?.name || "",
  };
}
