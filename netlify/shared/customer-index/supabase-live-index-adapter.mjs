import { cleanText, requireDriveId, requirePKey } from "./contracts.mjs";

function repositoryError(code, message, status = 0) {
  const error = new Error(message);
  error.code = code;
  if (status) error.status = status;
  return error;
}

function requireUuid(value, label) {
  const uuid = cleanText(value).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(uuid)) {
    throw repositoryError("CUSTOMER_INDEX_UUID_INVALID", `${label} 형식이 올바르지 않습니다.`);
  }
  return uuid;
}

function httpsOrigin(value) {
  try {
    const origin = new URL(cleanText(value)).origin;
    if (!origin.startsWith("https://")) throw new Error("HTTPS_REQUIRED");
    return origin;
  } catch {
    throw repositoryError("CUSTOMER_INDEX_SUPABASE_URL_INVALID", "Supabase URL은 HTTPS origin이어야 합니다.");
  }
}

function requireSecret(value) {
  const secret = cleanText(value);
  if (!secret.startsWith("sb_secret_")) {
    throw repositoryError("CUSTOMER_INDEX_SUPABASE_SECRET_REQUIRED", "서버 전용 Supabase secret key가 필요합니다.");
  }
  return secret;
}

function postgresIn(values) {
  const escaped = values.map((value) => `"${String(value).replace(/"/g, "\\\"")}"`);
  return `in.(${escaped.join(",")})`;
}

async function jsonOrNull(response) {
  return response.json().catch(() => null);
}

export function createSupabaseCustomerIndexRepository({
  supabaseUrl,
  secretKey,
  rootFolderId,
  fetchImpl = fetch,
} = {}) {
  const origin = httpsOrigin(supabaseUrl);
  const key = requireSecret(secretKey);
  const rootId = requireDriveId(rootFolderId, "감시 폴더 ID");
  if (typeof fetchImpl !== "function") {
    throw repositoryError("CUSTOMER_INDEX_SUPABASE_FETCH_REQUIRED", "Supabase fetch 구현이 필요합니다.");
  }

  const headers = (extra = {}) => ({ apikey: key, ...extra });

  async function request(path, options = {}, code = "CUSTOMER_INDEX_SUPABASE_REQUEST_FAILED") {
    const response = await fetchImpl(`${origin}/rest/v1/${path}`, {
      ...options,
      headers: headers(options.headers),
    });
    const data = await jsonOrNull(response);
    if (!response.ok) throw repositoryError(code, "Customer Index 저장소 요청에 실패했습니다.", response.status);
    return data;
  }

  async function insert(table, row, { onConflict = "", prefer = "return=representation" } = {}) {
    const query = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : "";
    return request(`${table}${query}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        prefer,
      },
      body: JSON.stringify(row),
    }, "CUSTOMER_INDEX_SUPABASE_WRITE_FAILED");
  }

  async function selectOne(table, params) {
    const query = new URLSearchParams({ ...params, limit: "1" });
    const rows = await request(`${table}?${query.toString()}`);
    return Array.isArray(rows) && rows.length ? rows[0] : null;
  }

  return Object.freeze({
    configured: true,

    async beginRun({ workspaceId, startedAt }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const rows = await insert("customer_index_sync_runs", {
        workspace_id: workspace,
        source_root_id: rootId,
        status: "running",
        started_at: startedAt,
      });
      if (!Array.isArray(rows) || rows.length !== 1 || !rows[0]?.id) {
        throw repositoryError("CUSTOMER_INDEX_RUN_CREATE_INVALID", "동기화 실행 로그 생성 결과가 올바르지 않습니다.");
      }
      return { runId: rows[0].id };
    },

    async finishRun({
      workspaceId,
      runId,
      status,
      finishedAt,
      counts,
      checkpointBefore = "",
      checkpointAfter = "",
      errorCode = "",
    }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const id = requireUuid(runId, "runId");
      const query = new URLSearchParams({ id: `eq.${id}`, workspace_id: `eq.${workspace}` });
      await request(`customer_index_sync_runs?${query.toString()}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", prefer: "return=minimal" },
        body: JSON.stringify({
          status,
          finished_at: finishedAt,
          counts: counts || {},
          checkpoint_before: cleanText(checkpointBefore),
          checkpoint_after: cleanText(checkpointAfter),
          error_code: cleanText(errorCode) || null,
        }),
      }, "CUSTOMER_INDEX_RUN_FINISH_FAILED");
    },

    async getCheckpoint({ workspaceId }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const row = await selectOne("customer_index_sync_checkpoints", {
        workspace_id: `eq.${workspace}`,
        source_root_id: `eq.${rootId}`,
        select: "page_token,last_successful_at",
      });
      return row ? {
        pageToken: cleanText(row.page_token),
        lastSuccessfulAt: cleanText(row.last_successful_at),
      } : null;
    },

    async saveCheckpoint({ workspaceId, pageToken, lastSuccessfulAt, runId }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const rows = await insert("customer_index_sync_checkpoints", {
        workspace_id: workspace,
        source_root_id: rootId,
        page_token: cleanText(pageToken),
        last_successful_at: lastSuccessfulAt,
        last_run_id: requireUuid(runId, "runId"),
      }, {
        onConflict: "workspace_id,source_root_id",
        prefer: "resolution=merge-duplicates,return=representation",
      });
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw repositoryError("CUSTOMER_INDEX_CHECKPOINT_SAVE_INVALID", "동기화 체크포인트 저장 결과가 올바르지 않습니다.");
      }
    },

    async getSourceItem({ workspaceId, driveItemId }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const itemId = requireDriveId(driveItemId, "변경 항목 ID");
      const row = await selectOne("customer_index_drive_items", {
        workspace_id: `eq.${workspace}`,
        drive_item_id: `eq.${itemId}`,
        select: "*",
      });
      if (!row) return null;
      return {
        workspaceId: row.workspace_id,
        driveItemId: row.drive_item_id,
        sourceFolderId: row.source_folder_id,
        parentIds: row.parent_ids,
        name: row.name,
        mimeType: row.mime_type,
        itemPath: row.item_path,
        createdTime: row.created_time,
        modifiedTime: row.modified_time,
        md5Checksum: row.md5_checksum,
        fingerprint: row.fingerprint,
        sourceState: row.source_state,
        normalizedNameCandidate: row.normalized_name_candidate,
        linkedCustomerKey: row.linked_customer_key,
        firstSeenAt: row.first_seen_at,
        lastSeenAt: row.last_seen_at,
        lastIndexedAt: row.last_indexed_at,
      };
    },

    async findLinkedIdentityByDriveIds({ workspaceId, driveItemIds }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const ids = [...new Set((driveItemIds || []).filter(Boolean).map((id) => requireDriveId(id)))];
      if (!ids.length) return null;
      const query = new URLSearchParams({
        workspace_id: `eq.${workspace}`,
        drive_item_id: postgresIn(ids),
        active: "eq.true",
        select: "customer_key,human_confirmed,drive_item_id",
        order: "human_confirmed.desc",
        limit: "50",
      });
      const rows = await request(`customer_index_source_links?${query.toString()}`);
      const keys = [...new Set((rows || []).map((row) => cleanText(row.customer_key)).filter(Boolean))];
      return keys.length === 1 ? { customerKey: requirePKey(keys[0]) } : null;
    },

    async listIdentityCandidatesByName({ workspaceId, normalizedName }) {
      const workspace = requireUuid(workspaceId, "workspaceId");
      const name = cleanText(normalizedName);
      if (!name) return [];
      const query = new URLSearchParams({
        workspace_id: `eq.${workspace}`,
        normalized_name: `eq.${name}`,
        active: "eq.true",
        select: "v5_customer_key,human_locked",
        limit: "50",
      });
      const rows = await request(`customer_index_live_identities?${query.toString()}`);
      return (rows || []).map((row) => ({
        customerKey: requirePKey(row.v5_customer_key),
        humanLocked: Boolean(row.human_locked),
      }));
    },

    async upsertSourceItem(input) {
      const workspace = requireUuid(input.workspaceId, "workspaceId");
      const itemId = requireDriveId(input.driveItemId, "변경 항목 ID");
      const row = {
        workspace_id: workspace,
        drive_item_id: itemId,
        source_folder_id: cleanText(input.sourceFolderId) || null,
        parent_ids: Array.isArray(input.parentIds) ? input.parentIds : [],
        name: cleanText(input.name),
        mime_type: cleanText(input.mimeType),
        item_path: cleanText(input.itemPath),
        created_time: cleanText(input.createdTime) || null,
        modified_time: cleanText(input.modifiedTime) || null,
        md5_checksum: cleanText(input.md5Checksum) || null,
        fingerprint: cleanText(input.fingerprint),
        source_state: cleanText(input.sourceState) || "active",
        normalized_name_candidate: cleanText(input.normalizedNameCandidate) || null,
        linked_customer_key: cleanText(input.linkedCustomerKey) || null,
        first_seen_at: input.firstSeenAt,
        last_seen_at: input.lastSeenAt,
        last_indexed_at: input.lastIndexedAt,
      };
      const rows = await insert("customer_index_drive_items", row, {
        onConflict: "workspace_id,drive_item_id",
        prefer: "resolution=merge-duplicates,return=representation",
      });
      if (!Array.isArray(rows) || rows.length !== 1) {
        throw repositoryError("CUSTOMER_INDEX_SOURCE_UPSERT_INVALID", "Drive 항목 저장 결과가 올바르지 않습니다.");
      }
    },

    async createIdentityIfAbsent(input) {
      const workspace = requireUuid(input.workspaceId, "workspaceId");
      const customerKey = requirePKey(input.customerKey);
      const rows = await insert("customer_index_live_identities", {
        workspace_id: workspace,
        v5_customer_key: customerKey,
        full_name: cleanText(input.fullName),
        normalized_name: cleanText(input.normalizedName),
        person_type: cleanText(input.personType),
        identity_status: cleanText(input.identityStatus),
        source_kind: cleanText(input.sourceKind),
        source_folder_id: cleanText(input.sourceFolderId),
        human_locked: Boolean(input.humanLocked),
        active: true,
        last_indexed_at: input.lastIndexedAt,
      }, {
        onConflict: "workspace_id,v5_customer_key",
        prefer: "resolution=ignore-duplicates,return=representation",
      });
      if (!Array.isArray(rows)) {
        throw repositoryError("CUSTOMER_INDEX_IDENTITY_CREATE_INVALID", "신규 Identity 저장 결과가 올바르지 않습니다.");
      }
    },

    async linkSourceIfAbsent(input) {
      const workspace = requireUuid(input.workspaceId, "workspaceId");
      const driveItemId = requireDriveId(input.driveItemId, "변경 항목 ID");
      const customerKey = requirePKey(input.customerKey);
      const rows = await insert("customer_index_source_links", {
        workspace_id: workspace,
        drive_item_id: driveItemId,
        customer_key: customerKey,
        link_type: cleanText(input.linkType),
        confidence: Number(input.confidence),
        human_confirmed: false,
        active: true,
      }, {
        onConflict: "workspace_id,drive_item_id",
        prefer: "resolution=ignore-duplicates,return=representation",
      });
      if (Array.isArray(rows) && rows.length === 1) return;
      const existing = await selectOne("customer_index_source_links", {
        workspace_id: `eq.${workspace}`,
        drive_item_id: `eq.${driveItemId}`,
        select: "customer_key",
      });
      if (!existing || cleanText(existing.customer_key) !== customerKey) {
        throw repositoryError("CUSTOMER_INDEX_SOURCE_LINK_CONFLICT", "기존 Drive 연결과 새 고객키가 충돌합니다.");
      }
    },

    async enqueueReviewIfAbsent(input) {
      await insert("customer_index_review_queue", {
        workspace_id: requireUuid(input.workspaceId, "workspaceId"),
        run_id: requireUuid(input.runId, "runId"),
        drive_item_id: requireDriveId(input.driveItemId, "변경 항목 ID"),
        source_folder_id: cleanText(input.sourceFolderId) || null,
        fingerprint: cleanText(input.fingerprint),
        status: "pending",
        reason: cleanText(input.reason),
        candidate_names: input.candidateNames || [],
        candidate_customer_keys: input.candidateCustomerKeys || [],
        source_snapshot: input.sourceSnapshot || {},
      }, {
        onConflict: "workspace_id,drive_item_id,fingerprint",
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
    },

    async appendEventIfAbsent(input) {
      await insert("customer_index_sync_events", {
        event_key: cleanText(input.eventKey),
        workspace_id: requireUuid(input.workspaceId, "workspaceId"),
        run_id: requireUuid(input.runId, "runId"),
        drive_item_id: requireDriveId(input.driveItemId, "변경 항목 ID"),
        decision: cleanText(input.decision),
        customer_key: cleanText(input.customerKey) || null,
        review_required: Boolean(input.reviewRequired),
        details: input.details || {},
      }, {
        onConflict: "event_key",
        prefer: "resolution=ignore-duplicates,return=minimal",
      });
    },
  });
}
