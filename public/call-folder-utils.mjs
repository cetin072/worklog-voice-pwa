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

export function rankAudioFileHandles(entries = [], limit = 150, fallbackDate = new Date()) {
  const max = Math.max(1, Math.floor(Number(limit) || 150));
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

export function selectRecentAudioFiles(files = [], limit = 150) {
  const max = Math.max(1, Math.floor(Number(limit) || 150));
  return [...files]
    .filter(isAudioCandidate)
    .sort((a, b) => Number(b.lastModified || 0) - Number(a.lastModified || 0))
    .slice(0, max);
}
