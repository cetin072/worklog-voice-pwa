import { createSign } from "node:crypto";
import { cleanText, requireDriveId } from "./contracts.mjs";

const DRIVE_API_ORIGIN = "https://www.googleapis.com";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const DRIVE_METADATA_SCOPE = "https://www.googleapis.com/auth/drive.metadata.readonly";
const TOKEN_EARLY_REFRESH_MS = 60_000;

function adapterError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function base64Url(value) {
  return Buffer.from(value).toString("base64url");
}

function normalizePrivateKey(value) {
  return cleanText(value).replace(/\\n/g, "\n");
}

function httpsUrl(value, fallback) {
  const source = cleanText(value) || fallback;
  try {
    const url = new URL(source);
    if (url.protocol !== "https:") throw new Error("HTTPS_REQUIRED");
    return url.toString();
  } catch {
    throw adapterError("CUSTOMER_INDEX_GOOGLE_TOKEN_URL_INVALID", "Google token URL이 올바르지 않습니다.");
  }
}

export function customerIndexDriveConfig(readEnv) {
  if (typeof readEnv !== "function") {
    return Object.freeze({ configured: false });
  }
  const serviceAccountEmail = cleanText(readEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL"));
  const privateKey = normalizePrivateKey(readEnv("GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY"));
  const watchFolderId = cleanText(readEnv("CUSTOMER_INDEX_WATCH_FOLDER_ID"));
  const masterFileId = cleanText(readEnv("CUSTOMER_INDEX_MASTER_FILE_ID"));
  const tokenUrl = httpsUrl(readEnv("GOOGLE_DRIVE_TOKEN_URL"), GOOGLE_TOKEN_URL);
  const configured = /^[^@\s]+@[^@\s]+$/.test(serviceAccountEmail)
    && privateKey.includes("BEGIN PRIVATE KEY")
    && /^[A-Za-z0-9_-]{10,200}$/.test(watchFolderId)
    && /^[A-Za-z0-9_-]{10,200}$/.test(masterFileId)
    && watchFolderId !== masterFileId;
  return Object.freeze({
    configured,
    serviceAccountEmail: configured ? serviceAccountEmail : "",
    privateKey: configured ? privateKey : "",
    watchFolderId: configured ? watchFolderId : "",
    masterFileId: configured ? masterFileId : "",
    tokenUrl,
  });
}

function jwtAssertion(config, now) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64Url(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: DRIVE_METADATA_SCOPE,
    aud: config.tokenUrl,
    iat: issuedAt,
    exp: issuedAt + 3600,
  }));
  const unsigned = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(config.privateKey, "base64url")}`;
}

async function responseJson(response, code, message) {
  const data = await response.json().catch(() => null);
  if (!response.ok) throw adapterError(code, message, response.status);
  return data;
}

export function createGoogleDriveChangesAdapter({
  config,
  fetchImpl = fetch,
  now = () => new Date(),
} = {}) {
  if (!config?.configured) {
    throw adapterError("CUSTOMER_INDEX_DRIVE_NOT_CONFIGURED", "Google Drive 고객 인덱스 설정이 필요합니다.");
  }
  if (typeof fetchImpl !== "function") {
    throw adapterError("CUSTOMER_INDEX_DRIVE_FETCH_REQUIRED", "Google Drive fetch 구현이 필요합니다.");
  }
  const rootId = requireDriveId(config.watchFolderId, "감시 폴더 ID");
  let cachedToken = "";
  let tokenExpiresAt = 0;

  async function accessToken() {
    const nowDate = now();
    if (cachedToken && tokenExpiresAt - nowDate.getTime() > TOKEN_EARLY_REFRESH_MS) return cachedToken;
    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwtAssertion(config, nowDate),
    });
    const response = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await responseJson(
      response,
      "CUSTOMER_INDEX_GOOGLE_TOKEN_FAILED",
      "Google Drive 인증에 실패했습니다.",
    );
    cachedToken = cleanText(data?.access_token);
    const expiresIn = Number(data?.expires_in || 0);
    if (!cachedToken || !Number.isFinite(expiresIn) || expiresIn <= 0) {
      throw adapterError("CUSTOMER_INDEX_GOOGLE_TOKEN_INVALID", "Google Drive 인증 응답이 올바르지 않습니다.");
    }
    tokenExpiresAt = nowDate.getTime() + (expiresIn * 1000);
    return cachedToken;
  }

  async function driveGet(path, params = {}) {
    const query = new URLSearchParams(params);
    const token = await accessToken();
    const response = await fetchImpl(`${DRIVE_API_ORIGIN}${path}?${query.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    return responseJson(
      response,
      "CUSTOMER_INDEX_DRIVE_READ_FAILED",
      "Google Drive 변경정보 조회에 실패했습니다.",
    );
  }

  async function getItem(id) {
    const itemId = requireDriveId(id, "Drive 항목 ID");
    return driveGet(`/drive/v3/files/${encodeURIComponent(itemId)}`, {
      fields: "id,name,mimeType,parents,createdTime,modifiedTime,md5Checksum,trashed,driveId",
      supportsAllDrives: "true",
    });
  }

  async function resolvePath(itemInput) {
    const item = itemInput?.id ? itemInput : await getItem(itemInput);
    const nodes = [item];
    const visited = new Set([item.id]);
    let cursor = item;
    let underRoot = cursor.id === rootId;

    for (let depth = 0; !underRoot && depth < 32; depth += 1) {
      const parentId = Array.isArray(cursor.parents) ? cursor.parents[0] : "";
      if (!parentId || visited.has(parentId)) break;
      const parent = await getItem(parentId);
      nodes.unshift(parent);
      visited.add(parent.id);
      cursor = parent;
      underRoot = parent.id === rootId;
    }

    const relativeNodes = underRoot && nodes[0]?.id === rootId ? nodes.slice(1) : nodes;
    const folders = relativeNodes.filter((node) => node.mimeType === "application/vnd.google-apps.folder");
    return Object.freeze({
      underRoot,
      item,
      nodes: Object.freeze(relativeNodes),
      folders: Object.freeze(folders),
      ancestorIds: Object.freeze(relativeNodes.slice(0, -1).map((node) => node.id)),
      path: relativeNodes.map((node) => cleanText(node.name)).filter(Boolean).join("/"),
    });
  }

  return Object.freeze({
    configured: true,
    rootId,
    masterFileId: config.masterFileId,
    async getStartPageToken() {
      const data = await driveGet("/drive/v3/changes/startPageToken", {
        supportsAllDrives: "true",
      });
      const token = cleanText(data?.startPageToken);
      if (!token) throw adapterError("CUSTOMER_INDEX_START_TOKEN_INVALID", "Drive 시작 토큰이 없습니다.");
      return token;
    },
    async listChanges(pageToken) {
      const token = cleanText(pageToken);
      if (!token) throw adapterError("CUSTOMER_INDEX_PAGE_TOKEN_REQUIRED", "Drive page token이 필요합니다.");
      return driveGet("/drive/v3/changes", {
        pageToken: token,
        pageSize: "1000",
        spaces: "drive",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        fields: "nextPageToken,newStartPageToken,changes(removed,fileId,file(id,name,mimeType,parents,createdTime,modifiedTime,md5Checksum,trashed,driveId))",
      });
    },
    async listItemsModifiedSince(sinceIso, pageToken = "") {
      const parsed = new Date(cleanText(sinceIso));
      if (Number.isNaN(parsed.getTime())) {
        throw adapterError("CUSTOMER_INDEX_BOOTSTRAP_DATE_INVALID", "초기 대조 시작일이 올바르지 않습니다.");
      }
      const params = {
        q: `modifiedTime >= '${parsed.toISOString()}' and trashed = false`,
        pageSize: "1000",
        spaces: "drive",
        includeItemsFromAllDrives: "true",
        supportsAllDrives: "true",
        fields: "nextPageToken,files(id,name,mimeType,parents,createdTime,modifiedTime,md5Checksum,trashed,driveId)",
      };
      const token = cleanText(pageToken);
      if (token) params.pageToken = token;
      const data = await driveGet("/drive/v3/files", params);
      return Object.freeze({
        items: Object.freeze(Array.isArray(data?.files) ? data.files : []),
        nextPageToken: cleanText(data?.nextPageToken),
      });
    },
    getItem,
    resolvePath,
  });
}
