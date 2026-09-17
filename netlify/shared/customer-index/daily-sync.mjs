import {
  cleanText,
  deterministicPKey,
  eventKey,
  isCreatedAfter,
  isFolder,
  normalizeCustomerName,
  parseFolderIdentityCandidate,
  requireDriveId,
  sourceFingerprint,
} from "./contracts.mjs";

function syncError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireMethod(target, method, label) {
  if (!target || typeof target[method] !== "function") {
    throw syncError("CUSTOMER_INDEX_ADAPTER_INVALID", `${label}.${method} 구현이 필요합니다.`);
  }
}

function requireAdapters(drive, repository) {
  [
    "getStartPageToken",
    "listChanges",
    "resolvePath",
  ].forEach((method) => requireMethod(drive, method, "Drive adapter"));
  [
    "beginRun",
    "finishRun",
    "getCheckpoint",
    "saveCheckpoint",
    "getSourceItem",
    "findLinkedIdentityByDriveIds",
    "listIdentityCandidatesByName",
    "upsertSourceItem",
    "createIdentityIfAbsent",
    "linkSourceIfAbsent",
    "enqueueReviewIfAbsent",
    "appendEventIfAbsent",
  ].forEach((method) => requireMethod(repository, method, "Customer Index repository"));
}

function isoDate(value, fallback = new Date()) {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  if (Number.isNaN(date.getTime())) {
    throw syncError("CUSTOMER_INDEX_DATE_INVALID", "고객 인덱스 실행 시각이 올바르지 않습니다.");
  }
  return date.toISOString();
}

function firstCandidateFolder(pathInfo = {}) {
  const folders = Array.isArray(pathInfo.folders) ? pathInfo.folders : [];
  for (let index = folders.length - 1; index >= 0; index -= 1) {
    const folder = folders[index];
    const parsed = parseFolderIdentityCandidate(folder?.name);
    if (parsed.names.length > 0) return { folder, parsed };
  }
  return { folder: null, parsed: parseFolderIdentityCandidate("") };
}

function reviewReason(parsed, identityCandidates, item, checkpoint) {
  if (parsed.names.length === 0) return "CUSTOMER_NAME_NOT_FOUND";
  if (!parsed.isClearSinglePerson) return "CUSTOMER_FOLDER_AMBIGUOUS";
  if (identityCandidates.length > 1) return "DUPLICATE_NAME_CANDIDATES";
  if (identityCandidates.length === 1) return "NAME_ONLY_MATCH_INSUFFICIENT";
  if (!isFolder(item)) return "NEW_IDENTITY_REQUIRES_FOLDER";
  if (!isCreatedAfter(item, checkpoint)) return "MOVED_OR_OLD_FOLDER_REQUIRES_REVIEW";
  return "CUSTOMER_IDENTITY_REQUIRES_REVIEW";
}

function counts() {
  return {
    changed: 0,
    skipped: 0,
    ignored: 0,
    existingIdentity: 0,
    newIdentity: 0,
    reviewRequired: 0,
    sourceUnavailable: 0,
  };
}

async function recordDecision({
  repository,
  workspaceId,
  runId,
  driveItemId,
  fingerprint,
  decision,
  customerKey = "",
  reviewRequired = false,
  details = {},
}) {
  await repository.appendEventIfAbsent({
    eventKey: eventKey({ workspaceId, driveItemId, fingerprint, decision }),
    workspaceId,
    runId,
    driveItemId,
    decision,
    customerKey,
    reviewRequired,
    details,
  });
}

async function handleUnavailable({
  repository,
  workspaceId,
  runId,
  driveItemId,
  existingSource,
  reason,
  now,
  result,
}) {
  if (!existingSource) {
    result.ignored += 1;
    return;
  }
  const fingerprint = cleanText(existingSource.fingerprint) || sourceFingerprint({
    id: driveItemId,
    name: existingSource.name,
    mimeType: existingSource.mimeType,
    createdTime: existingSource.createdTime,
    modifiedTime: existingSource.modifiedTime,
    parents: existingSource.parentIds,
    trashed: true,
  });
  await repository.upsertSourceItem({
    ...existingSource,
    workspaceId,
    driveItemId,
    sourceState: reason,
    lastSeenAt: now,
    lastIndexedAt: now,
  });
  await recordDecision({
    repository,
    workspaceId,
    runId,
    driveItemId,
    fingerprint,
    decision: "source_unavailable",
    customerKey: existingSource.linkedCustomerKey,
    details: { reason },
  });
  result.sourceUnavailable += 1;
}

async function processChange({
  change,
  checkpoint,
  drive,
  repository,
  workspaceId,
  runId,
  now,
  result,
}) {
  const driveItemId = requireDriveId(change?.fileId ?? change?.file?.id, "변경 항목 ID");
  const existingSource = await repository.getSourceItem({ workspaceId, driveItemId });

  if (change?.removed || change?.file?.trashed) {
    await handleUnavailable({
      repository,
      workspaceId,
      runId,
      driveItemId,
      existingSource,
      reason: change?.removed ? "removed" : "trashed",
      now,
      result,
    });
    return;
  }

  const pathInfo = await drive.resolvePath(change.file);
  if (!pathInfo?.underRoot) {
    await handleUnavailable({
      repository,
      workspaceId,
      runId,
      driveItemId,
      existingSource,
      reason: "moved_out",
      now,
      result,
    });
    return;
  }

  const item = pathInfo.item ?? change.file;
  const fingerprint = sourceFingerprint(item);
  if (existingSource?.fingerprint === fingerprint) {
    result.skipped += 1;
    return;
  }

  result.changed += 1;
  const ancestorIds = Array.isArray(pathInfo.ancestorIds) ? pathInfo.ancestorIds : [];
  const { folder: candidateFolder, parsed } = firstCandidateFolder(pathInfo);
  const sourceFolderId = candidateFolder?.id || (isFolder(item) ? item.id : "");
  const sourceRecord = {
    workspaceId,
    driveItemId,
    sourceFolderId,
    parentIds: Array.isArray(item.parents) ? item.parents : [],
    name: cleanText(item.name),
    mimeType: cleanText(item.mimeType),
    itemPath: cleanText(pathInfo.path),
    createdTime: cleanText(item.createdTime),
    modifiedTime: cleanText(item.modifiedTime),
    md5Checksum: cleanText(item.md5Checksum),
    fingerprint,
    sourceState: "active",
    normalizedNameCandidate: parsed.normalizedNames[0] || "",
    firstSeenAt: existingSource?.firstSeenAt || now,
    lastSeenAt: now,
    lastIndexedAt: now,
  };

  const linked = await repository.findLinkedIdentityByDriveIds({
    workspaceId,
    driveItemIds: [driveItemId, sourceFolderId, ...ancestorIds].filter(Boolean),
  });
  if (linked?.customerKey) {
    await repository.upsertSourceItem({ ...sourceRecord, linkedCustomerKey: linked.customerKey });
    await repository.linkSourceIfAbsent({
      workspaceId,
      driveItemId,
      customerKey: linked.customerKey,
      linkType: "drive_lineage",
      confidence: 1,
    });
    await recordDecision({
      repository,
      workspaceId,
      runId,
      driveItemId,
      fingerprint,
      decision: "existing_identity",
      customerKey: linked.customerKey,
      details: { basis: "linked_drive_lineage" },
    });
    result.existingIdentity += 1;
    return;
  }

  const normalizedName = parsed.normalizedNames[0] || "";
  const identityCandidates = normalizedName
    ? await repository.listIdentityCandidatesByName({ workspaceId, normalizedName })
    : [];

  const canCreate = parsed.isClearSinglePerson
    && identityCandidates.length === 0
    && isFolder(item)
    && isCreatedAfter(item, checkpoint);

  if (canCreate) {
    const customerKey = deterministicPKey(sourceFolderId || item.id);
    await repository.createIdentityIfAbsent({
      workspaceId,
      customerKey,
      fullName: parsed.names[0],
      normalizedName: normalizeCustomerName(parsed.names[0]),
      personType: "고객후보",
      identityStatus: "자동생성-신규폴더",
      sourceKind: "drive_incremental",
      sourceFolderId: sourceFolderId || item.id,
      humanLocked: false,
      lastIndexedAt: now,
    });
    await repository.upsertSourceItem({ ...sourceRecord, linkedCustomerKey: customerKey });
    await repository.linkSourceIfAbsent({
      workspaceId,
      driveItemId,
      customerKey,
      linkType: "new_folder",
      confidence: 1,
    });
    await recordDecision({
      repository,
      workspaceId,
      runId,
      driveItemId,
      fingerprint,
      decision: "new_identity",
      customerKey,
      details: { basis: "new_clear_single_person_folder" },
    });
    result.newIdentity += 1;
    return;
  }

  const reason = reviewReason(parsed, identityCandidates, item, checkpoint);
  await repository.upsertSourceItem({ ...sourceRecord, linkedCustomerKey: "" });
  await repository.enqueueReviewIfAbsent({
    workspaceId,
    runId,
    driveItemId,
    sourceFolderId,
    fingerprint,
    reason,
    candidateNames: parsed.names,
    candidateCustomerKeys: identityCandidates.map((candidate) => candidate.customerKey),
    sourceSnapshot: {
      itemId: driveItemId,
      folderId: sourceFolderId,
      modifiedTime: sourceRecord.modifiedTime,
      mimeType: sourceRecord.mimeType,
    },
  });
  await recordDecision({
    repository,
    workspaceId,
    runId,
    driveItemId,
    fingerprint,
    decision: "review_required",
    reviewRequired: true,
    details: { reason, candidateCount: identityCandidates.length },
  });
  result.reviewRequired += 1;
}

export async function runCustomerIndexDailySync({
  workspaceId,
  drive,
  repository,
  now = new Date(),
} = {}) {
  const workspace = cleanText(workspaceId);
  if (!workspace) throw syncError("CUSTOMER_INDEX_WORKSPACE_REQUIRED", "workspaceId가 필요합니다.");
  requireAdapters(drive, repository);
  const startedAt = isoDate(now);
  const run = await repository.beginRun({ workspaceId: workspace, startedAt });
  const runId = cleanText(run?.runId);
  if (!runId) throw syncError("CUSTOMER_INDEX_RUN_ID_REQUIRED", "동기화 runId가 필요합니다.");

  const result = counts();
  try {
    const checkpoint = await repository.getCheckpoint({ workspaceId: workspace });
    if (!checkpoint?.pageToken) {
      const pageToken = await drive.getStartPageToken();
      await repository.saveCheckpoint({
        workspaceId: workspace,
        pageToken,
        lastSuccessfulAt: startedAt,
        runId,
      });
      await repository.finishRun({
        workspaceId: workspace,
        runId,
        status: "noop",
        finishedAt: startedAt,
        counts: result,
        checkpointBefore: "",
        checkpointAfter: pageToken,
      });
      return Object.freeze({ status: "checkpoint_initialized", runId, ...result });
    }

    let pageToken = checkpoint.pageToken;
    let nextPageToken = pageToken;
    let finalPageToken = pageToken;
    do {
      const page = await drive.listChanges(nextPageToken);
      const changes = Array.isArray(page?.changes) ? page.changes : [];
      for (const change of changes) {
        await processChange({
          change,
          checkpoint,
          drive,
          repository,
          workspaceId: workspace,
          runId,
          now: startedAt,
          result,
        });
      }
      if (cleanText(page?.nextPageToken)) {
        nextPageToken = page.nextPageToken;
      } else {
        finalPageToken = cleanText(page?.newStartPageToken) || nextPageToken;
        nextPageToken = "";
      }
    } while (nextPageToken);

    await repository.saveCheckpoint({
      workspaceId: workspace,
      pageToken: finalPageToken,
      lastSuccessfulAt: startedAt,
      runId,
    });
    const status = result.changed === 0 && result.sourceUnavailable === 0 ? "noop" : "succeeded";
    await repository.finishRun({
      workspaceId: workspace,
      runId,
      status,
      finishedAt: startedAt,
      counts: result,
      checkpointBefore: checkpoint.pageToken,
      checkpointAfter: finalPageToken,
    });
    return Object.freeze({ status, runId, ...result });
  } catch (error) {
    await repository.finishRun({
      workspaceId: workspace,
      runId,
      status: "failed",
      finishedAt: isoDate(now),
      counts: result,
      errorCode: cleanText(error?.code || "CUSTOMER_INDEX_SYNC_FAILED"),
    }).catch(() => {});
    throw error;
  }
}
