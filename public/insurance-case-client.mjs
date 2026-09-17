import { normalizeInsuranceCustomerKey } from "./insurance-customer-index-adapter.mjs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["intake", "checking", "waiting", "active", "closed"]);
const WAITING_PARTIES = new Set(["", "customer", "insurer", "internal", "external"]);

function contractError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function uuid(value, label) {
  const id = String(value || "").trim();
  if (!UUID_PATTERN.test(id)) throw contractError(`INSURANCE_${label}_INVALID`, `${label} 식별자가 올바르지 않습니다.`);
  return id;
}

function requestId(value) {
  const id = String(value || "").trim();
  if (!/^[A-Za-z0-9-]{16,100}$/.test(id)) throw contractError("INSURANCE_REQUEST_ID_INVALID", "요청 식별자가 올바르지 않습니다.");
  return id;
}

function title(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text || text.length > 200) throw contractError("INSURANCE_TITLE_INVALID", "제목은 1자 이상 200자 이하여야 합니다.");
  return text;
}

function firstRow(value, code = "INSURANCE_RESPONSE_INVALID") {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  if (rows.length !== 1) throw contractError(code, "보험사건 응답을 확인하지 못했습니다.");
  return Object.freeze({ ...rows[0] });
}

function dueAt(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00+09:00`;
  if (!Number.isFinite(Date.parse(raw))) throw contractError("INSURANCE_DUE_AT_INVALID", "기한이 올바르지 않습니다.");
  return raw;
}

export function createInsuranceCaseClient({ rpc, nextRequestId, clearRequestId = () => {} } = {}) {
  if (typeof rpc !== "function") throw contractError("INSURANCE_RPC_REQUIRED", "Data Core RPC 경계가 필요합니다.");
  if (typeof nextRequestId !== "function") throw contractError("INSURANCE_REQUEST_ID_FACTORY_REQUIRED", "요청 식별자 생성기가 필요합니다.");

  return Object.freeze({
    async list() {
      const rows = await rpc("list_my_insurance_cases", {});
      return Object.freeze((Array.isArray(rows) ? rows : []).map((row) => Object.freeze({ ...row })));
    },

    async get(insuranceCaseId) {
      return firstRow(await rpc("get_my_insurance_case", {
        p_insurance_case_id: uuid(insuranceCaseId, "CASE_ID"),
      }), "INSURANCE_CASE_NOT_FOUND");
    },

    async readSource(workRecordId) {
      return firstRow(await rpc("get_my_work_record_edit", {
        p_record_id: uuid(workRecordId, "WORK_RECORD_ID"),
      }), "INSURANCE_SOURCE_NOT_FOUND");
    },

    async create({ originalWorkRecordId, customerKey, title: rawTitle } = {}) {
      const originalId = uuid(originalWorkRecordId, "WORK_RECORD_ID");
      const key = normalizeInsuranceCustomerKey(customerKey);
      const normalizedTitle = title(rawTitle);
      const id = requestId(nextRequestId("insurance-case", `${originalId}|${key}|${normalizedTitle}`));
      const result = firstRow(await rpc("create_my_insurance_case", {
        p_client_request_id: id,
        p_original_work_record_id: originalId,
        p_customer_key: key,
        p_title: normalizedTitle,
      }));
      clearRequestId(id);
      return result;
    },

    async update({ insuranceCaseId, expectedRevision, title: rawTitle, status, waitingParty = "", waitingReason = "" } = {}) {
      const normalizedStatus = String(status || "").trim().toLowerCase();
      const normalizedParty = String(waitingParty || "").trim().toLowerCase();
      const revision = Number(expectedRevision);
      if (!STATUSES.has(normalizedStatus)) throw contractError("INSURANCE_STATUS_INVALID", "사건 상태가 올바르지 않습니다.");
      if (!WAITING_PARTIES.has(normalizedParty)) throw contractError("INSURANCE_WAITING_PARTY_INVALID", "대기 상대가 올바르지 않습니다.");
      if (!Number.isInteger(revision) || revision < 1) throw contractError("INSURANCE_REVISION_INVALID", "사건 revision이 올바르지 않습니다.");
      const reason = String(waitingReason || "").trim();
      if (reason.length > 1000) throw contractError("INSURANCE_WAITING_REASON_INVALID", "대기 사유는 1000자 이하여야 합니다.");
      return firstRow(await rpc("update_my_insurance_case", {
        p_insurance_case_id: uuid(insuranceCaseId, "CASE_ID"),
        p_expected_revision: revision,
        p_title: title(rawTitle),
        p_status: normalizedStatus,
        p_waiting_party: normalizedParty || null,
        p_waiting_reason: reason || null,
      }));
    },

    async createAction({ insuranceCaseId, title: rawTitle, dueAt: rawDueAt = "" } = {}) {
      const caseId = uuid(insuranceCaseId, "CASE_ID");
      const normalizedTitle = title(rawTitle);
      const normalizedDueAt = dueAt(rawDueAt);
      const id = requestId(nextRequestId("insurance-action", `${caseId}|${normalizedTitle}|${normalizedDueAt || ""}`));
      const result = firstRow(await rpc("create_my_insurance_case_action", {
        p_insurance_case_id: caseId,
        p_client_request_id: id,
        p_title: normalizedTitle,
        p_due_at: normalizedDueAt,
      }));
      clearRequestId(id);
      return result;
    },

    async completeAction(workRecordId) {
      return firstRow(await rpc("update_my_work_record_status", {
        p_record_id: uuid(workRecordId, "WORK_RECORD_ID"),
        p_status: "completed",
      }), "INSURANCE_ACTION_NOT_FOUND");
    },
  });
}
