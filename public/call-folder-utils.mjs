import { isSupportedAudioFilename } from "./call-recording-parser.mjs";

export function isAudioCandidate(file = {}) {
  const name = String(file.name || "");
  const type = String(file.type || "").toLowerCase();
  return isSupportedAudioFilename(name) || type.startsWith("audio/");
}

export function selectRecentAudioFiles(files = [], limit = 150) {
  const max = Math.max(1, Math.floor(Number(limit) || 150));
  return [...files]
    .filter(isAudioCandidate)
    .sort((a, b) => Number(b.lastModified || 0) - Number(a.lastModified || 0))
    .slice(0, max);
}
