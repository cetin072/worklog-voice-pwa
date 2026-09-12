const AUDIO_EXTENSION_RE = /\.(m4a|mp4|mp3|wav|aac|ogg|opus|3gp)$/i;

function isValidDateParts(year, month, day, hour = 0, minute = 0, second = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return false;
  const date = new Date(year, month - 1, day, hour, minute, second, 0);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day
    && date.getHours() === hour
    && date.getMinutes() === minute
    && date.getSeconds() === second;
}

export function parseRecordingTimestamp(token, fallbackDate = new Date()) {
  const digits = String(token || "").replace(/\D/g, "");
  let year;
  let month;
  let day;
  let hour;
  let minute;
  let second = 0;

  if (digits.length === 14) {
    year = Number(digits.slice(0, 4));
    month = Number(digits.slice(4, 6));
    day = Number(digits.slice(6, 8));
    hour = Number(digits.slice(8, 10));
    minute = Number(digits.slice(10, 12));
    second = Number(digits.slice(12, 14));
  } else if (digits.length === 12) {
    year = 2000 + Number(digits.slice(0, 2));
    month = Number(digits.slice(2, 4));
    day = Number(digits.slice(4, 6));
    hour = Number(digits.slice(6, 8));
    minute = Number(digits.slice(8, 10));
    second = Number(digits.slice(10, 12));
  } else if (digits.length === 10 || digits.length === 8) {
    const base = fallbackDate instanceof Date && !Number.isNaN(fallbackDate.getTime())
      ? fallbackDate
      : new Date();
    year = base.getFullYear();
    month = Number(digits.slice(0, 2));
    day = Number(digits.slice(2, 4));
    hour = Number(digits.slice(4, 6));
    minute = Number(digits.slice(6, 8));
    if (digits.length === 10) second = Number(digits.slice(8, 10));
  } else {
    return null;
  }

  if (!isValidDateParts(year, month, day, hour, minute, second)) return null;
  return new Date(year, month - 1, day, hour, minute, second, 0);
}

export function normalizePhoneNumber(value) {
  const source = String(value || "").trim();
  if (!source) return null;
  const hasPlus = source.startsWith("+");
  const digits = source.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 12) return null;
  if (!hasPlus && !digits.startsWith("0") && !digits.startsWith("82")) return null;
  if (hasPlus && !digits.startsWith("82")) return null;
  return hasPlus ? `+${digits}` : digits;
}

export function formatPhoneNumber(value) {
  const normalized = normalizePhoneNumber(value);
  if (!normalized) return "";
  if (normalized.startsWith("+82")) {
    const local = `0${normalized.slice(3)}`;
    const formatted = formatPhoneNumber(local);
    return formatted ? `+82 ${formatted.slice(1)}` : normalized;
  }
  if (normalized.startsWith("02") && normalized.length === 9) {
    return `${normalized.slice(0, 2)}-${normalized.slice(2, 5)}-${normalized.slice(5)}`;
  }
  if (normalized.startsWith("02") && normalized.length === 10) {
    return `${normalized.slice(0, 2)}-${normalized.slice(2, 6)}-${normalized.slice(6)}`;
  }
  if (normalized.length === 10) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
  }
  if (normalized.length === 11) {
    return `${normalized.slice(0, 3)}-${normalized.slice(3, 7)}-${normalized.slice(7)}`;
  }
  return normalized;
}

function cleanContactName(value) {
  return String(value || "")
    .replace(/^(통화\s*녹음|call\s*recording)[ _-]*/i, "")
    .replace(/^[_\s-]+|[_\s-]+$/g, "")
    .trim();
}

export function parseCallRecordingFilename(filename, options = {}) {
  const sourceName = String(filename || "").trim();
  const fallbackDate = options.fallbackDate instanceof Date ? options.fallbackDate : new Date();
  const baseName = sourceName.replace(AUDIO_EXTENSION_RE, "");
  const parts = baseName.split("_");

  let recordedAt = null;
  let timestampSource = "file";
  const timestampToken = parts.at(-1) || "";
  const parsedTimestamp = parseRecordingTimestamp(timestampToken, fallbackDate);
  if (parsedTimestamp) {
    recordedAt = parsedTimestamp;
    timestampSource = "filename";
    parts.pop();
  } else if (!Number.isNaN(fallbackDate.getTime())) {
    recordedAt = new Date(fallbackDate.getTime());
  }

  let phone = null;
  if (parts.length >= 1) {
    const maybePhone = normalizePhoneNumber(parts.at(-1));
    if (maybePhone) {
      phone = maybePhone;
      parts.pop();
    }
  }

  const contact = cleanContactName(parts.join("_")) || null;

  return {
    sourceName,
    contact,
    phone,
    phoneDisplay: formatPhoneNumber(phone),
    recordedAt,
    timestampSource,
    recognizedExtension: AUDIO_EXTENSION_RE.test(sourceName),
  };
}

export function isSupportedAudioFilename(filename) {
  return AUDIO_EXTENSION_RE.test(String(filename || ""));
}
