export const RECORD_NORMALIZATION_VERSION = "record-normalization-v1";

const SAFE_ENTITY_TYPES = new Set(["institution", "organization", "project", "person", "other"]);
const AUTO_REPLACE_TYPES = new Set(["institution", "organization", "project"]);
const TRUSTED_METADATA_SOURCES = new Set(["user_selected", "user_confirmed"]);

function normalizationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function compactText(value, max = 10000) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function boundedConfidence(value, fallback = 0.9) {
  if (value === undefined || value === null || value === "") return fallback;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) {
    throw normalizationError("RECORD_NORMALIZATION_DICTIONARY_CONFIDENCE_INVALID", "업무 사전 confidence는 0~1이어야 합니다.");
  }
  return number;
}

function safeAlias(value) {
  const alias = compactText(value, 120);
  if (!alias || alias.length < 2) return "";
  // Numeric identifiers, phone/account-like values and mixed identifier strings are never dictionary replacement keys.
  if (/\d/.test(alias)) return "";
  return alias;
}

function uniqueAliases(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const alias = safeAlias(value);
    const key = alias.toLocaleLowerCase("ko-KR");
    if (!alias || seen.has(key)) continue;
    seen.add(key);
    result.push(alias);
    if (result.length >= 50) break;
  }
  return result;
}

function normalizeDictionaryEntry(value, index) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw normalizationError("RECORD_NORMALIZATION_DICTIONARY_ENTRY_INVALID", `normalization_dictionary[${index}] 형식이 올바르지 않습니다.`);
  }
  const entityType = compactText(value.entityType ?? value.entity_type ?? value.type, 40).toLowerCase() || "other";
  if (!SAFE_ENTITY_TYPES.has(entityType)) {
    throw normalizationError("RECORD_NORMALIZATION_DICTIONARY_TYPE_INVALID", `normalization_dictionary[${index}] entityType이 올바르지 않습니다.`);
  }
  const canonical = safeAlias(value.canonical ?? value.canonicalValue ?? value.canonical_value);
  if (!canonical) {
    throw normalizationError("RECORD_NORMALIZATION_DICTIONARY_CANONICAL_REQUIRED", `normalization_dictionary[${index}] canonical이 필요합니다.`);
  }
  const aliases = uniqueAliases(Array.isArray(value.aliases) ? value.aliases : []);
  const confidence = boundedConfidence(value.confidence, 0.95);
  const requestedAutoReplace = value.autoReplace === true || value.auto_replace === true;
  // Person names never auto-replace in 0.1. Institution/project replacements require an explicit trusted dictionary flag.
  const autoReplace = requestedAutoReplace && AUTO_REPLACE_TYPES.has(entityType) && confidence >= 0.95;
  return Object.freeze({
    entityType,
    canonical,
    aliases: Object.freeze(uniqueAliases([canonical, ...aliases])),
    confidence,
    autoReplace,
    requiresReview: value.requiresReview === true || value.requires_review === true,
  });
}

export function dictionaryFromWorkspaceMetadata(metadata = {}) {
  const source = metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
  const raw = source.normalization_dictionary ?? source.normalizationDictionary ?? [];
  if (!Array.isArray(raw)) return Object.freeze([]);
  return Object.freeze(raw.slice(0, 200).map(normalizeDictionaryEntry));
}

function literalReplaceAll(source, from, to) {
  if (!from || from === to || !source.includes(from)) return source;
  return source.split(from).join(to);
}

function makeReadableTitle(value) {
  let title = compactText(value, 10000)
    .replace(/[.。!?]+$/g, "")
    .replace(/(?:해야\s*돼|해야\s*해|해야\s*합니다|하기로\s*했어|하기로\s*했습니다|할\s*예정이야|할\s*예정입니다)$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title) return "업무 기록";
  if (title.length <= 120) return title;
  return `${title.slice(0, 117).trim()}…`;
}

function sourceForRecord(record = {}) {
  const original = compactText(record.original_text ?? record.originalText, 10000);
  if (original) return { original, sourceQuality: "original" };
  const fallback = compactText(record.content ?? record.title, 10000);
  return { original: fallback, sourceQuality: fallback ? "fallback_content" : "unknown" };
}

function recordMetadata(record = {}) {
  const metadata = record?.metadata;
  return metadata && typeof metadata === "object" && !Array.isArray(metadata) ? metadata : {};
}

function metadataFieldSource(record, field) {
  const metadata = recordMetadata(record);
  const nested = metadata.fieldProvenance ?? metadata.field_provenance;
  const nestedValue = nested && typeof nested === "object" && !Array.isArray(nested) ? nested[field] : "";
  const direct = nestedValue ?? metadata[`${field}Source`] ?? metadata[`${field}_source`];
  const source = compactText(direct, 40).toLowerCase();
  if (source) return source;
  const legacySource = compactText(metadata.legacy_source ?? metadata.legacySource, 40).toLowerCase();
  if (legacySource === "notion") return "legacy_unverified";
  return "unverified";
}

function dictionaryMatches(text, dictionary) {
  const matches = [];
  for (const entry of dictionary) {
    const matchedAliases = entry.aliases.filter((alias) => text.includes(alias));
    if (!matchedAliases.length) continue;
    matches.push(Object.freeze({ entry, matchedAliases: Object.freeze(matchedAliases) }));
  }
  return matches;
}

export function normalizeWorkRecord(record = {}, options = {}) {
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    throw normalizationError("RECORD_NORMALIZATION_RECORD_INVALID", "정제할 WorkRecord가 필요합니다.");
  }
  const workRecordId = compactText(record.id ?? record.work_record_id, 200);
  if (!workRecordId) throw normalizationError("RECORD_NORMALIZATION_RECORD_ID_REQUIRED", "WorkRecord ID가 필요합니다.");

  const dictionary = Array.isArray(options.dictionary) ? options.dictionary : [];
  const { original, sourceQuality } = sourceForRecord(record);
  let normalizedText = compactText(record.content, 10000) || original;
  const matches = dictionaryMatches(`${original} ${normalizedText}`, dictionary);
  const aliases = [];
  const entities = [];
  let confidence = sourceQuality === "original" ? 0.92 : sourceQuality === "fallback_content" ? 0.55 : 0.3;
  let needsReview = sourceQuality !== "original";

  const institution = compactText(record.institution, 500);
  const institutionSource = institution ? metadataFieldSource(record, "institution") : "unset";
  const institutionTrusted = TRUSTED_METADATA_SOURCES.has(institutionSource);
  let normalizedInstitution = institution;
  let normalizedInstitutionSource = institutionSource;
  let hasDerivedAliases = false;
  if (institution && institutionTrusted) aliases.push(institution);

  for (const match of matches) {
    const { entry, matchedAliases } = match;
    const proposed = matchedAliases.some((alias) => alias !== entry.canonical);
    if (entry.autoReplace) {
      for (const alias of matchedAliases) normalizedText = literalReplaceAll(normalizedText, alias, entry.canonical);
      if (entry.entityType === "institution" || entry.entityType === "organization") {
        normalizedInstitution = entry.canonical;
        normalizedInstitutionSource = "auto_derived";
      }
    } else if (proposed) {
      // Keep uncertain/person-name source text untouched and surface the canonical proposal for review/search only.
      needsReview = true;
    }
    if (entry.requiresReview || entry.confidence < 0.9) needsReview = true;
    confidence = Math.min(confidence, entry.confidence);
    aliases.push(entry.canonical, ...matchedAliases);
    hasDerivedAliases = true;
    entities.push(Object.freeze({
      type: entry.entityType,
      canonical: entry.canonical,
      matchedAliases,
      autoReplaced: entry.autoReplace,
      confidence: entry.confidence,
    }));
  }

  const normalizedTitle = makeReadableTitle(normalizedText || original);
  const reviewState = needsReview ? "needs_review" : "unreviewed";
  const dueAt = compactText(record.due_at ?? record.dueAt, 64) || null;
  const followUp = compactText(record.follow_up ?? record.followUp, 5000) || null;
  const searchAliasSource = aliases.length === 0
    ? "unset"
    : hasDerivedAliases
      ? "auto_derived"
      : institutionTrusted
        ? institutionSource
        : "unverified";

  return Object.freeze({
    workRecordId,
    version: RECORD_NORMALIZATION_VERSION,
    normalizedTitle,
    normalizedText: compactText(normalizedText || original, 10000),
    structuredData: Object.freeze({
      institution: normalizedInstitution || null,
      dueAt,
      status: compactText(record.status, 80) || null,
      recordType: compactText(record.record_type ?? record.recordType, 80) || null,
      followUp,
      entities: Object.freeze(entities),
      sourceQuality,
      provenance: Object.freeze({
        institution: normalizedInstitutionSource,
        searchAliases: searchAliasSource,
      }),
    }),
    searchAliases: Object.freeze(uniqueAliases(aliases)),
    confidence: Number(confidence.toFixed(4)),
    reviewState,
    sourceQuality,
  });
}
