function text(value, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function validDate(value, code) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
  return date;
}

function validObjectPath(value) {
  const path = text(value, 500);
  if (!path || /:\/\//.test(path) || path.startsWith("/") || path.split("/").includes("..")) {
    const error = new Error("STORAGE_INVALID_OBJECT_PATH");
    error.code = "STORAGE_INVALID_OBJECT_PATH";
    throw error;
  }
  return path;
}

export function normalizePreparedAudioSource(raw = {}) {
  const objectPath = validObjectPath(raw.objectPath);
  const uploadId = text(raw.uploadId, 160);
  if (!uploadId) {
    const error = new Error("STORAGE_MISSING_UPLOAD_ID");
    error.code = "STORAGE_MISSING_UPLOAD_ID";
    throw error;
  }

  const uploadedAt = validDate(raw.uploadedAt, "STORAGE_INVALID_UPLOADED_AT");
  const expiresAt = validDate(raw.expiresAt, "STORAGE_INVALID_EXPIRES_AT");
  if (expiresAt <= uploadedAt) {
    const error = new Error("STORAGE_INVALID_EXPIRY_ORDER");
    error.code = "STORAGE_INVALID_EXPIRY_ORDER";
    throw error;
  }

  const sizeBytes = Number(raw.sizeBytes);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    const error = new Error("STORAGE_INVALID_SIZE");
    error.code = "STORAGE_INVALID_SIZE";
    throw error;
  }

  return Object.freeze({
    uploadId,
    objectPath,
    uploadedAt: uploadedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    sizeBytes: Math.round(sizeBytes),
    mimeType: text(raw.mimeType, 120).toLowerCase(),
    fileName: text(raw.fileName, 240),
  });
}

export function createUnconfiguredCallStorageAdapter() {
  const fail = async () => {
    const error = new Error("통화 임시 저장소가 아직 연결되지 않았습니다.");
    error.code = "STORAGE_NOT_CONFIGURED";
    throw error;
  };
  return Object.freeze({
    configured: false,
    createUploadTicket: fail,
    verifyPreparedUpload: fail,
    deleteObject: fail,
  });
}
