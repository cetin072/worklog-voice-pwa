import { RECORD_NORMALIZATION_VERSION } from "./record-normalization.mjs";

function text(value) {
  return String(value ?? "").trim();
}

function normalizationMap(rows = []) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const id = text(row?.work_record_id ?? row?.workRecordId);
    if (id) map.set(id, row);
  }
  return map;
}

function reasonFor(record, normalization, version) {
  if (!normalization) return "missing_normalization";
  if (text(normalization.normalization_version) !== version) return "version_changed";
  if (normalization.processing_status === "failed") return "failed";
  if (normalization.processing_status === "needs_review" || normalization.review_state === "needs_review") return "needs_review";
  const confidence = Number(normalization.confidence);
  if (Number.isFinite(confidence) && confidence < 0.8) return "low_confidence";
  return "";
}

export function planRecordNormalizationBackfill(records = [], normalizations = [], options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit) || 25));
  const version = text(options.version) || RECORD_NORMALIZATION_VERSION;
  const byRecord = normalizationMap(normalizations);
  const planned = [];

  for (const record of Array.isArray(records) ? records : []) {
    const id = text(record?.id);
    if (!id) continue;
    const normalization = byRecord.get(id);
    const reason = reasonFor(record, normalization, version);
    if (!reason) continue;
    const original = text(record?.original_text ?? record?.originalText);
    const fallback = text(record?.content ?? record?.title);
    if (!original && !fallback) continue;
    planned.push(Object.freeze({
      workRecordId: id,
      reason,
      sourceQuality: original ? "original" : "fallback_content",
      requiresReview: !original,
      version,
    }));
    if (planned.length >= limit) break;
  }

  return Object.freeze({
    dryRun: options.dryRun !== false,
    limit,
    version,
    count: planned.length,
    items: Object.freeze(planned),
  });
}
