const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function confirmationError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function createWorklogDataCoreScheduleConfirmation({ client } = {}) {
  if (!client || typeof client.rpc !== "function") {
    throw confirmationError("WORKLOG_SCHEDULE_CONFIRM_RPC_REQUIRED", "Data Core RPC client가 필요합니다.");
  }

  return Object.freeze({
    async confirm(candidateId) {
      const id = String(candidateId || "").trim();
      if (!UUID_RE.test(id)) {
        throw confirmationError("WORKLOG_SCHEDULE_CONFIRM_CANDIDATE_ID_INVALID", "ScheduleCandidate ID가 올바르지 않습니다.");
      }

      const data = await client.rpc("confirm_schedule_candidate", { p_candidate_id: id });
      if (!Array.isArray(data) || data.length !== 1) {
        throw confirmationError("WORKLOG_SCHEDULE_CONFIRM_RESPONSE_INVALID", "ScheduleCandidate 확정 결과가 올바르지 않습니다.");
      }

      const row = data[0] || {};
      const returnedCandidateId = String(row.candidate_id || "");
      const scheduleId = String(row.schedule_id || "");
      if (returnedCandidateId !== id || !UUID_RE.test(scheduleId) || String(row.candidate_status || "") !== "confirmed") {
        throw confirmationError("WORKLOG_SCHEDULE_CONFIRM_RESPONSE_INVALID", "ScheduleCandidate 확정 결과가 올바르지 않습니다.");
      }

      return Object.freeze({ candidateId: returnedCandidateId, scheduleId, status: "confirmed" });
    },
  });
}
