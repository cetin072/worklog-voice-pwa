import { createHash } from "node:crypto";

export const CUSTOMER_INDEX_SYNC_SCHEMA_VERSION = "0.1";
export const CUSTOMER_INDEX_DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const CUSTOMER_INDEX_DECISIONS = Object.freeze([
  "existing_identity",
  "new_identity",
  "review_required",
  "source_unavailable",
  "ignored",
]);

const P_KEY_PATTERN = /^P-[A-F0-9]{12}$/;
const DRIVE_ID_PATTERN = /^[A-Za-z0-9_-]{10,200}$/;
const KOREAN_NAME_PATTERN = /[가-힣]{2,5}/g;
const AMBIGUOUS_MARKERS = Object.freeze([
  "소개",
  "배우자",
  "남편",
  "아내",
  "부모",
  "부친",
  "모친",
  "아들",
  "딸",
  "자녀",
  "가족",
  "사촌",
  "지인",
  "담당",
  "직원",
  "병원",
  "설계사",
]);
const NON_PERSON_TOKENS = new Set([
  "고객",
  "상담",
  "재무",
  "보험",
  "계약",
  "보장",
  "분석",
  "청구",
  "서류",
  "복사본",
  "스캔",
  "시간순",
  "이름순",
]);

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function cleanText(value) {
  return String(value ?? "").trim();
}

export function requireDriveId(value, label = "Drive ID") {
  const id = cleanText(value);
  if (!DRIVE_ID_PATTERN.test(id)) {
    throw contractError("CUSTOMER_INDEX_DRIVE_ID_INVALID", `${label} 형식이 올바르지 않습니다.`);
  }
  return id;
}

export function requirePKey(value) {
  const key = cleanText(value).toUpperCase();
  if (!P_KEY_PATTERN.test(key)) {
    throw contractError("CUSTOMER_INDEX_P_KEY_INVALID", "P-계열 고객키 형식이 올바르지 않습니다.");
  }
  return key;
}

export function normalizeCustomerName(value) {
  return cleanText(value)
    .normalize("NFKC")
    .replace(/[\s·ㆍ._-]+/g, "")
    .replace(/[^0-9A-Za-z가-힣]/g, "")
    .toLowerCase();
}

export function sha256Hex(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function deterministicPKey(driveFolderId) {
  const id = requireDriveId(driveFolderId, "신규 고객 폴더 ID");
  return `P-${sha256Hex(`customer-index-v0.1:${id}`).slice(0, 12).toUpperCase()}`;
}

export function sourceFingerprint(item = {}) {
  const id = requireDriveId(item.id ?? item.driveItemId, "변경 항목 ID");
  const parents = Array.isArray(item.parents) ? [...item.parents].sort() : [];
  return sha256Hex(JSON.stringify({
    id,
    name: cleanText(item.name),
    mimeType: cleanText(item.mimeType),
    createdTime: cleanText(item.createdTime),
    modifiedTime: cleanText(item.modifiedTime),
    md5Checksum: cleanText(item.md5Checksum),
    parents,
    trashed: Boolean(item.trashed),
  }));
}

export function eventKey({ workspaceId, driveItemId, fingerprint, decision }) {
  const workspace = cleanText(workspaceId);
  if (!workspace) throw contractError("CUSTOMER_INDEX_WORKSPACE_REQUIRED", "workspaceId가 필요합니다.");
  if (!CUSTOMER_INDEX_DECISIONS.includes(decision)) {
    throw contractError("CUSTOMER_INDEX_DECISION_INVALID", "고객 인덱스 판단결과가 올바르지 않습니다.");
  }
  return sha256Hex([
    CUSTOMER_INDEX_SYNC_SCHEMA_VERSION,
    workspace,
    requireDriveId(driveItemId, "변경 항목 ID"),
    cleanText(fingerprint),
    decision,
  ].join(":"));
}

function unique(values) {
  return [...new Set(values)];
}

export function parseFolderIdentityCandidate(name) {
  const source = cleanText(name);
  const rawNames = source.match(KOREAN_NAME_PATTERN) ?? [];
  const names = unique(rawNames
    .filter((token) => !NON_PERSON_TOKENS.has(token))
    .map((token) => token.normalize("NFKC")));
  const ambiguousMarkers = AMBIGUOUS_MARKERS.filter((marker) => source.includes(marker));
  const hasParenthesizedName = /\([^)]*[가-힣]{2,5}[^)]*\)/.test(source);
  const hasMultipleNames = names.length !== 1;
  const isClearSinglePerson = names.length === 1
    && ambiguousMarkers.length === 0
    && !hasParenthesizedName;

  return Object.freeze({
    source,
    names: Object.freeze(names),
    normalizedNames: Object.freeze(names.map(normalizeCustomerName)),
    ambiguousMarkers: Object.freeze(ambiguousMarkers),
    hasParenthesizedName,
    isClearSinglePerson,
  });
}

export function isFolder(item = {}) {
  return cleanText(item.mimeType) === CUSTOMER_INDEX_DRIVE_FOLDER_MIME;
}

export function isCreatedAfter(item = {}, checkpoint = {}) {
  const created = Date.parse(cleanText(item.createdTime));
  const lastSuccess = Date.parse(cleanText(checkpoint.lastSuccessfulAt));
  return Number.isFinite(created) && Number.isFinite(lastSuccess) && created > lastSuccess;
}

export function sanitizeErrorCode(error) {
  const code = cleanText(error?.code || "CUSTOMER_INDEX_SYNC_FAILED").toUpperCase();
  return /^[A-Z0-9_]{1,100}$/.test(code) ? code : "CUSTOMER_INDEX_SYNC_FAILED";
}
