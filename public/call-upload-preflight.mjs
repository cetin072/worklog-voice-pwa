import { isSupportedAudioFilename } from "./call-recording-parser.mjs";

function positiveOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function normalizeUploadPreflightPolicy(value = {}) {
  return {
    providerId: String(value.providerId || "").trim(),
    providerLimitsConfirmed: value.providerLimitsConfirmed === true,
    maxSelectedFiles: positiveOrNull(value.maxSelectedFiles),
    maxFileBytes: positiveOrNull(value.maxFileBytes),
    maxTotalBytes: positiveOrNull(value.maxTotalBytes),
    maxFileDurationSeconds: positiveOrNull(value.maxFileDurationSeconds),
    maxTotalDurationSeconds: positiveOrNull(value.maxTotalDurationSeconds),
    requireKnownDuration: value.requireKnownDuration === true,
  };
}

export function normalizeAudioFileMeta(value = {}) {
  return {
    id: String(value.id || "").trim(),
    name: String(value.name || value.fileName || "").trim(),
    type: String(value.type || value.mimeType || "").trim().toLowerCase(),
    size: Math.max(0, Number(value.size ?? value.fileSize) || 0),
    lastModified: Math.max(0, Number(value.lastModified) || 0),
    durationSeconds: value.durationSeconds === null || value.durationSeconds === undefined
      ? null
      : Math.max(0, Number(value.durationSeconds) || 0),
  };
}

export function fileFingerprint(meta = {}) {
  const item = normalizeAudioFileMeta(meta);
  return `${item.name}::${item.size}::${item.lastModified}`;
}

export function validateAudioFileMeta(meta = {}, policy = {}) {
  const item = normalizeAudioFileMeta(meta);
  const normalizedPolicy = normalizeUploadPreflightPolicy(policy);
  const errors = [];
  const warnings = [];

  if (!item.name) errors.push({ code: "FILE_NAME_REQUIRED", message: "파일명이 없습니다." });
  if (item.name && !isSupportedAudioFilename(item.name) && !item.type.startsWith("audio/")) {
    errors.push({ code: "UNSUPPORTED_AUDIO", message: "지원하지 않는 오디오 형식입니다." });
  }
  if (item.size <= 0) errors.push({ code: "EMPTY_FILE", message: "빈 녹음파일은 처리할 수 없습니다." });
  if (normalizedPolicy.maxFileBytes && item.size > normalizedPolicy.maxFileBytes) {
    errors.push({ code: "FILE_TOO_LARGE", message: "공급자 파일 크기 한도를 초과했습니다." });
  }

  if (item.durationSeconds === null || item.durationSeconds <= 0) {
    if (normalizedPolicy.requireKnownDuration) {
      errors.push({ code: "DURATION_REQUIRED", message: "녹음 길이를 확인할 수 없습니다." });
    } else {
      warnings.push({ code: "DURATION_UNKNOWN", message: "녹음 길이를 아직 확인하지 못했습니다." });
    }
  } else if (normalizedPolicy.maxFileDurationSeconds && item.durationSeconds > normalizedPolicy.maxFileDurationSeconds) {
    errors.push({ code: "FILE_TOO_LONG", message: "공급자 단일 녹음 길이 한도를 초과했습니다." });
  }

  return { item, errors, warnings, valid: errors.length === 0 };
}

export function validateCallSelectionPreflight(items = [], policy = {}) {
  const normalizedPolicy = normalizeUploadPreflightPolicy(policy);
  const list = Array.isArray(items) ? items.map(normalizeAudioFileMeta) : [];
  const errors = [];
  const warnings = [];
  const seen = new Set();
  let totalBytes = 0;
  let totalDurationSeconds = 0;
  let unknownDurationCount = 0;

  if (!list.length) errors.push({ code: "NO_FILES", message: "선택된 녹음파일이 없습니다." });
  if (normalizedPolicy.maxSelectedFiles && list.length > normalizedPolicy.maxSelectedFiles) {
    errors.push({ code: "TOO_MANY_FILES", message: "한 번에 처리할 수 있는 파일 수를 초과했습니다." });
  }

  list.forEach((item, index) => {
    const result = validateAudioFileMeta(item, normalizedPolicy);
    result.errors.forEach((issue) => errors.push({ ...issue, index, fileName: item.name }));
    result.warnings.forEach((issue) => warnings.push({ ...issue, index, fileName: item.name }));

    const fingerprint = fileFingerprint(item);
    if (seen.has(fingerprint)) {
      errors.push({ code: "DUPLICATE_FILE", message: "같은 녹음파일이 중복 선택되었습니다.", index, fileName: item.name });
    } else {
      seen.add(fingerprint);
    }

    totalBytes += item.size;
    if (item.durationSeconds && item.durationSeconds > 0) totalDurationSeconds += item.durationSeconds;
    else unknownDurationCount += 1;
  });

  if (normalizedPolicy.maxTotalBytes && totalBytes > normalizedPolicy.maxTotalBytes) {
    errors.push({ code: "TOTAL_SIZE_TOO_LARGE", message: "선택한 파일의 총 용량이 공급자 한도를 초과했습니다." });
  }
  if (normalizedPolicy.maxTotalDurationSeconds && totalDurationSeconds > normalizedPolicy.maxTotalDurationSeconds) {
    errors.push({ code: "TOTAL_DURATION_TOO_LONG", message: "선택한 녹음의 총 길이가 공급자 한도를 초과했습니다." });
  }
  if (!normalizedPolicy.providerLimitsConfirmed) {
    warnings.push({
      code: "PROVIDER_LIMITS_UNCONFIRMED",
      message: "선택한 STT 공급자의 최신 업로드 한도가 아직 확정되지 않았습니다.",
    });
  }

  const localValid = errors.length === 0;
  return {
    policy: normalizedPolicy,
    files: list,
    errors,
    warnings,
    totals: {
      files: list.length,
      bytes: totalBytes,
      durationSeconds: totalDurationSeconds,
      unknownDurationCount,
    },
    localValid,
    readyForPaidProcessing: localValid && normalizedPolicy.providerLimitsConfirmed,
  };
}
