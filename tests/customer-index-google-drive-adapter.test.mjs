import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  customerIndexDriveConfig,
  createGoogleDriveChangesAdapter,
} from "../netlify/shared/customer-index/google-drive-adapter.mjs";

const ROOT_ID = "rootFolder12345";
const MASTER_ID = "masterFile12345";
const CUSTOMER_FOLDER_ID = "customerFolder12345";
const FILE_ID = "customerFile12345";

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return data; } };
}

function privateKey() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey
    .export({ type: "pkcs8", format: "pem" })
    .toString();
}

test("Drive config fails closed and keeps MASTER separate from the watched folder", () => {
  const missing = customerIndexDriveConfig(() => "");
  assert.equal(missing.configured, false);

  const values = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "sync@example.test",
    GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey(),
    CUSTOMER_INDEX_WATCH_FOLDER_ID: ROOT_ID,
    CUSTOMER_INDEX_MASTER_FILE_ID: ROOT_ID,
  };
  const sameTarget = customerIndexDriveConfig((name) => values[name]);
  assert.equal(sameTarget.configured, false);

  values.CUSTOMER_INDEX_MASTER_FILE_ID = MASTER_ID;
  const valid = customerIndexDriveConfig((name) => values[name]);
  assert.equal(valid.configured, true);
  assert.equal(valid.watchFolderId, ROOT_ID);
  assert.equal(valid.masterFileId, MASTER_ID);
});

test("Drive adapter requests metadata-readonly scope and exposes no write method", async () => {
  const calls = [];
  const items = new Map([
    [FILE_ID, {
      id: FILE_ID,
      name: "상담기록.pdf",
      mimeType: "application/pdf",
      parents: [CUSTOMER_FOLDER_ID],
      createdTime: "2026-09-17T00:00:00.000Z",
      modifiedTime: "2026-09-17T00:00:00.000Z",
      trashed: false,
    }],
    [CUSTOMER_FOLDER_ID, {
      id: CUSTOMER_FOLDER_ID,
      name: "홍길동 (26.09)",
      mimeType: "application/vnd.google-apps.folder",
      parents: [ROOT_ID],
      createdTime: "2026-09-17T00:00:00.000Z",
      modifiedTime: "2026-09-17T00:00:00.000Z",
      trashed: false,
    }],
    [ROOT_ID, {
      id: ROOT_ID,
      name: "고객 상담파일",
      mimeType: "application/vnd.google-apps.folder",
      parents: [],
      createdTime: "2026-09-01T00:00:00.000Z",
      modifiedTime: "2026-09-17T00:00:00.000Z",
      trashed: false,
    }],
  ]);
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).includes("oauth2.googleapis.com/token")) {
      const body = new URLSearchParams(options.body);
      const assertion = body.get("assertion");
      const payload = JSON.parse(Buffer.from(assertion.split(".")[1], "base64url").toString("utf8"));
      assert.equal(payload.scope, "https://www.googleapis.com/auth/drive.metadata.readonly");
      return response({ access_token: "access-token", expires_in: 3600 });
    }
    if (String(url).includes("/changes/startPageToken")) return response({ startPageToken: "start-1" });
    if (String(url).includes("/changes?")) return response({ changes: [], newStartPageToken: "start-2" });
    const match = String(url).match(/\/drive\/v3\/files\/([^?]+)/);
    if (match) return response(items.get(decodeURIComponent(match[1])));
    return response({}, { ok: false, status: 404 });
  };
  const values = {
    GOOGLE_DRIVE_SERVICE_ACCOUNT_EMAIL: "sync@example.test",
    GOOGLE_DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY: privateKey(),
    CUSTOMER_INDEX_WATCH_FOLDER_ID: ROOT_ID,
    CUSTOMER_INDEX_MASTER_FILE_ID: MASTER_ID,
  };
  const config = customerIndexDriveConfig((name) => values[name]);
  const adapter = createGoogleDriveChangesAdapter({
    config,
    fetchImpl,
    now: () => new Date("2026-09-17T00:00:00.000Z"),
  });

  assert.equal(await adapter.getStartPageToken(), "start-1");
  assert.deepEqual(await adapter.listChanges("start-1"), { changes: [], newStartPageToken: "start-2" });
  const path = await adapter.resolvePath(items.get(FILE_ID));
  assert.equal(path.underRoot, true);
  assert.equal(path.path, "홍길동 (26.09)/상담기록.pdf");
  assert.deepEqual(path.ancestorIds, [CUSTOMER_FOLDER_ID]);
  assert.equal(typeof adapter.updateItem, "undefined");
  assert.equal(typeof adapter.deleteItem, "undefined");
  assert.ok(calls.every((call) => !["POST", "PATCH", "DELETE"].includes(call.options.method) || call.url.includes("oauth2.googleapis.com/token")));
});
