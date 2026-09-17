import test from "node:test";
import assert from "node:assert/strict";
import {
  deterministicPKey,
  parseFolderIdentityCandidate,
} from "../netlify/shared/customer-index/contracts.mjs";
import { runCustomerIndexDailySync } from "../netlify/shared/customer-index/daily-sync.mjs";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const ROOT_ID = "rootFolder12345";
const CUSTOMER_FOLDER_ID = "customerFolder12345";
const FILE_ID = "customerFile12345";
const EXISTING_KEY = "P-ABCDEF123456";
const STARTED_AT = "2026-09-17T00:15:00.000Z";

function folder(id, name, overrides = {}) {
  return {
    id,
    name,
    mimeType: "application/vnd.google-apps.folder",
    parents: [ROOT_ID],
    createdTime: "2026-09-16T10:00:00.000Z",
    modifiedTime: "2026-09-16T10:00:00.000Z",
    trashed: false,
    ...overrides,
  };
}

function file(id, name, parentId = CUSTOMER_FOLDER_ID, overrides = {}) {
  return {
    id,
    name,
    mimeType: "application/pdf",
    parents: [parentId],
    createdTime: "2026-09-16T10:00:00.000Z",
    modifiedTime: "2026-09-16T10:00:00.000Z",
    md5Checksum: "abc123",
    trashed: false,
    ...overrides,
  };
}

function makeRepository({ checkpoint = { pageToken: "page-1", lastSuccessfulAt: "2026-09-16T00:15:00.000Z" } } = {}) {
  const state = {
    checkpoint,
    sourceItems: new Map(),
    identities: new Map(),
    links: new Map(),
    reviews: new Map(),
    events: new Map(),
    runs: [],
  };
  const repository = {
    state,
    async beginRun(input) {
      const runId = "22222222-2222-4222-8222-222222222222";
      state.runs.push({ runId, ...input, status: "running" });
      return { runId };
    },
    async finishRun(input) {
      state.runs.push({ ...input });
    },
    async getCheckpoint() {
      return state.checkpoint;
    },
    async saveCheckpoint(input) {
      state.checkpoint = {
        pageToken: input.pageToken,
        lastSuccessfulAt: input.lastSuccessfulAt,
      };
    },
    async getSourceItem({ driveItemId }) {
      return state.sourceItems.get(driveItemId) || null;
    },
    async findLinkedIdentityByDriveIds({ driveItemIds }) {
      const keys = [...new Set(driveItemIds.map((id) => state.links.get(id)).filter(Boolean))];
      return keys.length === 1 ? { customerKey: keys[0] } : null;
    },
    async listIdentityCandidatesByName({ normalizedName }) {
      return [...state.identities.values()]
        .filter((identity) => identity.normalizedName === normalizedName && identity.active !== false)
        .map((identity) => ({ customerKey: identity.customerKey, humanLocked: identity.humanLocked }));
    },
    async upsertSourceItem(input) {
      state.sourceItems.set(input.driveItemId, { ...input });
    },
    async createIdentityIfAbsent(input) {
      if (!state.identities.has(input.customerKey)) {
        state.identities.set(input.customerKey, { ...input, active: true });
      }
    },
    async linkSourceIfAbsent(input) {
      const existing = state.links.get(input.driveItemId);
      if (existing && existing !== input.customerKey) throw new Error("link conflict");
      state.links.set(input.driveItemId, input.customerKey);
    },
    async enqueueReviewIfAbsent(input) {
      state.reviews.set(`${input.driveItemId}:${input.fingerprint}`, { ...input });
    },
    async appendEventIfAbsent(input) {
      state.events.set(input.eventKey, { ...input });
    },
  };
  return repository;
}

function makeDrive({ changes = [], paths = new Map(), startPageToken = "start-1" } = {}) {
  return {
    async getStartPageToken() {
      return startPageToken;
    },
    async listChanges() {
      return { changes, newStartPageToken: "page-2" };
    },
    async resolvePath(item) {
      return paths.get(item.id) || { underRoot: false, item, folders: [], ancestorIds: [], path: item.name };
    },
  };
}

test("folder parser only auto-creates a clear single-person folder", () => {
  const clear = parseFolderIdentityCandidate("홍길동 (26.09)");
  assert.deepEqual(clear.names, ["홍길동"]);
  assert.equal(clear.isClearSinglePerson, true);

  assert.equal(parseFolderIdentityCandidate("홍길동 김영희 - 가족상담").isClearSinglePerson, false);
  assert.equal(parseFolderIdentityCandidate("홍길동 - 김영희 소개").isClearSinglePerson, false);
  assert.equal(parseFolderIdentityCandidate("홍길동(자녀 김영희)").isClearSinglePerson, false);
});

test("P-key generation is deterministic for a Drive folder", () => {
  const first = deterministicPKey(CUSTOMER_FOLDER_ID);
  const second = deterministicPKey(CUSTOMER_FOLDER_ID);
  assert.equal(first, second);
  assert.match(first, /^P-[A-F0-9]{12}$/);
});

test("first run only stores a Drive checkpoint and does not discover historical identities", async () => {
  const repository = makeRepository({ checkpoint: null });
  const drive = makeDrive({ changes: [{ fileId: CUSTOMER_FOLDER_ID, file: folder(CUSTOMER_FOLDER_ID, "홍길동") }] });
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  assert.equal(result.status, "checkpoint_initialized");
  assert.equal(repository.state.identities.size, 0);
  assert.equal(repository.state.sourceItems.size, 0);
  assert.equal(repository.state.checkpoint.pageToken, "start-1");
});

test("a day with no Drive changes is a no-op", async () => {
  const repository = makeRepository();
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive: makeDrive(),
    repository,
    now: new Date(STARTED_AT),
  });
  assert.equal(result.status, "noop");
  assert.equal(result.changed, 0);
  assert.equal(repository.state.identities.size, 0);
  assert.equal(repository.state.reviews.size, 0);
});

test("a changed file under an already linked folder keeps the existing P-key", async () => {
  const repository = makeRepository();
  repository.state.links.set(CUSTOMER_FOLDER_ID, EXISTING_KEY);
  repository.state.identities.set(EXISTING_KEY, {
    customerKey: EXISTING_KEY,
    normalizedName: "홍길동",
    active: true,
  });
  const changedFile = file(FILE_ID, "상담기록.pdf");
  const customerFolder = folder(CUSTOMER_FOLDER_ID, "홍길동 (26.09)");
  const drive = makeDrive({
    changes: [{ fileId: FILE_ID, file: changedFile }],
    paths: new Map([[FILE_ID, {
      underRoot: true,
      item: changedFile,
      folders: [customerFolder],
      ancestorIds: [CUSTOMER_FOLDER_ID],
      path: "2026년/9월/홍길동 (26.09)/상담기록.pdf",
    }]]),
  });
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  assert.equal(result.existingIdentity, 1);
  assert.equal(repository.state.sourceItems.get(FILE_ID).linkedCustomerKey, EXISTING_KEY);
  assert.equal(repository.state.links.get(FILE_ID), EXISTING_KEY);
  assert.equal(repository.state.identities.size, 1);
});

test("a clear newly created folder with no existing candidate creates one deterministic customer candidate", async () => {
  const repository = makeRepository();
  const changedFolder = folder(CUSTOMER_FOLDER_ID, "홍길동 (26.09)");
  const drive = makeDrive({
    changes: [{ fileId: CUSTOMER_FOLDER_ID, file: changedFolder }],
    paths: new Map([[CUSTOMER_FOLDER_ID, {
      underRoot: true,
      item: changedFolder,
      folders: [changedFolder],
      ancestorIds: [],
      path: "2026년/9월/홍길동 (26.09)",
    }]]),
  });
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  const key = deterministicPKey(CUSTOMER_FOLDER_ID);
  assert.equal(result.newIdentity, 1);
  assert.equal(repository.state.identities.get(key).personType, "고객후보");
  assert.equal(repository.state.links.get(CUSTOMER_FOLDER_ID), key);
  assert.equal(repository.state.reviews.size, 0);
});

test("name-only match is not auto-merged", async () => {
  const repository = makeRepository();
  repository.state.identities.set(EXISTING_KEY, {
    customerKey: EXISTING_KEY,
    normalizedName: "홍길동",
    active: true,
  });
  const changedFolder = folder(CUSTOMER_FOLDER_ID, "홍길동 (26.09)");
  const drive = makeDrive({
    changes: [{ fileId: CUSTOMER_FOLDER_ID, file: changedFolder }],
    paths: new Map([[CUSTOMER_FOLDER_ID, {
      underRoot: true,
      item: changedFolder,
      folders: [changedFolder],
      ancestorIds: [],
      path: "2026년/9월/홍길동 (26.09)",
    }]]),
  });
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  assert.equal(result.reviewRequired, 1);
  assert.equal(repository.state.links.has(CUSTOMER_FOLDER_ID), false);
  assert.equal([...repository.state.reviews.values()][0].reason, "NAME_ONLY_MATCH_INSUFFICIENT");
});

test("multiple names and relationship markers are sent to review", async () => {
  const repository = makeRepository();
  const changedFolder = folder(CUSTOMER_FOLDER_ID, "홍길동 김영희 - 배우자 상담 (26.09)");
  const drive = makeDrive({
    changes: [{ fileId: CUSTOMER_FOLDER_ID, file: changedFolder }],
    paths: new Map([[CUSTOMER_FOLDER_ID, {
      underRoot: true,
      item: changedFolder,
      folders: [changedFolder],
      ancestorIds: [],
      path: changedFolder.name,
    }]]),
  });
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  assert.equal(result.reviewRequired, 1);
  assert.equal(repository.state.identities.size, 0);
  assert.equal([...repository.state.reviews.values()][0].reason, "CUSTOMER_FOLDER_AMBIGUOUS");
});

test("a deleted or moved source never deletes its linked identity", async () => {
  const repository = makeRepository();
  repository.state.identities.set(EXISTING_KEY, {
    customerKey: EXISTING_KEY,
    normalizedName: "홍길동",
    active: true,
  });
  repository.state.sourceItems.set(FILE_ID, {
    driveItemId: FILE_ID,
    name: "상담기록.pdf",
    mimeType: "application/pdf",
    fingerprint: "a".repeat(64),
    linkedCustomerKey: EXISTING_KEY,
    firstSeenAt: "2026-09-16T00:00:00.000Z",
  });
  const drive = makeDrive({ changes: [{ fileId: FILE_ID, removed: true }] });
  const result = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  assert.equal(result.sourceUnavailable, 1);
  assert.equal(repository.state.identities.has(EXISTING_KEY), true);
  assert.equal(repository.state.sourceItems.get(FILE_ID).sourceState, "removed");
});

test("reprocessing the same fingerprint is idempotently skipped", async () => {
  const repository = makeRepository();
  const changedFolder = folder(CUSTOMER_FOLDER_ID, "홍길동 (26.09)");
  const drive = makeDrive({
    changes: [{ fileId: CUSTOMER_FOLDER_ID, file: changedFolder }],
    paths: new Map([[CUSTOMER_FOLDER_ID, {
      underRoot: true,
      item: changedFolder,
      folders: [changedFolder],
      ancestorIds: [],
      path: changedFolder.name,
    }]]),
  });
  const first = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date(STARTED_AT),
  });
  const second = await runCustomerIndexDailySync({
    workspaceId: WORKSPACE_ID,
    drive,
    repository,
    now: new Date("2026-09-18T00:15:00.000Z"),
  });
  assert.equal(first.newIdentity, 1);
  assert.equal(second.skipped, 1);
  assert.equal(repository.state.identities.size, 1);
  assert.equal(repository.state.events.size, 1);
});
