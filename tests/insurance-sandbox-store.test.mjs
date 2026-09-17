import assert from "node:assert/strict";
import test from "node:test";

import { createInsuranceCaseClient } from "../public/insurance-case-client.mjs";
import { createInsuranceSandboxRpc, INSURANCE_SANDBOX_SOURCE_ID, isInsuranceSandboxHost } from "../public/insurance-sandbox-store.mjs";

function memoryStorage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test("Sandbox host uses an isolated local flow for case, waiting, action, completion, close and reopen", async () => {
  assert.equal(isInsuranceSandboxHost("worklog-insurance-sandbox.netlify.app"), true);
  assert.equal(isInsuranceSandboxHost("worklog-voice-pwa.netlify.app"), false);
  const client = createInsuranceCaseClient({
    rpc: createInsuranceSandboxRpc({ storage: memoryStorage() }),
    nextRequestId: (scope) => `${scope}-00000000-0000-4000-8000-000000000000`,
  });
  const created = await client.create({ originalWorkRecordId: INSURANCE_SANDBOX_SOURCE_ID, customerKey: "P-DEV-0001", title: "합성 보험 문의" });
  const caseId = created.insurance_case_id;
  await client.update({ insuranceCaseId: caseId, expectedRevision: 1, title: "합성 보험 문의", status: "waiting", waitingParty: "insurer", waitingReason: "합성 회신 대기" });
  await client.createAction({ insuranceCaseId: caseId, title: "합성 서류 확인", dueAt: "2026-09-30" });
  let detail = await client.get(caseId);
  await client.completeAction(detail.current_action_work_record_id);
  detail = await client.get(caseId);
  assert.equal(detail.current_action_status, "completed");
  await client.update({ insuranceCaseId: caseId, expectedRevision: detail.revision, title: detail.title, status: "closed" });
  detail = await client.get(caseId);
  await client.update({ insuranceCaseId: caseId, expectedRevision: detail.revision, title: detail.title, status: "active" });
  assert.equal((await client.get(caseId)).status, "active");
});
