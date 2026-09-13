export const TEMP_STORAGE_MAX_RETENTION_HOURS = 24;

function storageError(code, message) {
  const error = new Error(message || code);
  error.code = code;
  return error;
}

function rawText(value) {
  return String(value ?? "").trim();
}

function boundedText(value, max, code, label) {
  const text = rawText(value);
  if (text.length > max) throw storageError(code, `${label}가 허용 길이를 초과했습니다.`);
  return text;
}

function validDate(value, code) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw storageError(code, "Storage 시각이 올바르지 않습니다.");
  return date;
}

export function normalizeStorageObjectPath(value) {
  const path = boundedText(value, 500, "STORAGE_INVALID_OBJECT_PATH", "objectPath");
  const segments = path.split("/");
  if (
    !path
    || /:\/\//.test(path)
    || path.startsWith("/")
    || path.includes("\\")
    || /[\u0000-\u001F\u007F]/.test(path)
    || segments.includes("..")
    || segments.includes("")
  ) {
    throw storageError("STORAGE_INVALID_OBJECT_PATH", "objectPath가 올바르지 않습니다.");
  }
  return path;
}

export function normalizePreparedStorageObject(raw = {}) {
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const objectPath = normalizeStorageObjectPath(source.objectPath ?? source.object_path);
  const uploadId = boundedText(
    source.uploadId ?? source.upload_id,
    160,
    "STORAGE_INVALID_UPLOAD_ID",
    "uploadId",
  );
  if (!uploadId) throw storageError("STORAGE_MISSING_UPLOAD_ID", "uploadId가 필요합니다.");

  const uploadedAt = validDate(
    source.uploadedAt ?? source.uploaded_at,
    "STORAGE_INVALID_UPLOADED_AT",
  );
  const expiresAt = validDate(
    source.expiresAt ?? source.expires_at,
    "STORAGE_INVALID_EXPIRES_AT",
  );
  if (expiresAt <= uploadedAt) {
    throw storageError("STORAGE_INVALID_EXPIRY_ORDER", "expiresAt은 uploadedAt보다 뒤여야 합니다.");
  }

  const sizeBytes = Number(source.sizeBytes ?? source.size_bytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw storageError("STORAGE_INVALID_SIZE", "sizeBytes는 0보다 큰 안전한 정수여야 합니다.");
  }

  const metadata = source.metadata && typeof source.metadata === "object" && !Array.isArray(source.metadata)
    ? { ...source.metadata }
    : {};

  return Object.freeze({
    uploadId,
    objectPath,
    uploadedAt: uploadedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sizeBytes,
    mimeType: boundedText(source.mimeType ?? source.mime_type, 120, "STORAGE_MIME_TYPE_INVALID", "mimeType").toLowerCase(),
    fileName: boundedText(source.fileName ?? source.file_name, 240, "STORAGE_FILE_NAME_INVALID", "fileName"),
    metadata: Object.freeze(metadata),
  });
}

export function effectiveTemporaryStorageExpiry(preparedInput, options = {}) {
  const prepared = normalizePreparedStorageObject(preparedInput);
  const requestedHours = options.maxRetentionHours ?? TEMP_STORAGE_MAX_RETENTION_HOURS;
  const maxRetentionHours = Number(requestedHours);
  if (!Number.isFinite(maxRetentionHours) || maxRetentionHours <= 0 || maxRetentionHours > TEMP_STORAGE_MAX_RETENTION_HOURS) {
    throw storageError(
      "STORAGE_RETENTION_HOURS_INVALID",
      `임시 저장 보존시간은 0보다 크고 ${TEMP_STORAGE_MAX_RETENTION_HOURS}시간 이하여야 합니다.`,
    );
  }
  const uploadedAt = new Date(prepared.uploadedAt);
  const sourceExpiry = new Date(prepared.expiresAt);
  const policyExpiry = new Date(uploadedAt.getTime() + maxRetentionHours * 3_600_000);
  return (sourceExpiry < policyExpiry ? sourceExpiry : policyExpiry).toISOString();
}

export function isPreparedStorageObjectExpired(preparedInput, at = new Date()) {
  const prepared = normalizePreparedStorageObject(preparedInput);
  const observedAt = validDate(at, "STORAGE_OBSERVED_AT_INVALID");
  return new Date(prepared.expiresAt) <= observedAt;
}

export function createUnconfiguredStorageAdapter() {
  const fail = async () => {
    throw storageError("STORAGE_NOT_CONFIGURED", "Storage adapter가 아직 연결되지 않았습니다.");
  };
  return Object.freeze({
    configured: false,
    createUploadTicket: fail,
    verifyPreparedUpload: fail,
    deleteObject: fail,
  });
}
