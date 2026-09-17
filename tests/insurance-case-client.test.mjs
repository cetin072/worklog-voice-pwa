import assert from "node:assert/strict";
import test from "node:test";

import { createInsuranceCaseClient } from "../public/insurance-case-client.mjs";
import {
  createCustomerIndexAdapter,
  createDefaultCustomerIndexAdapter,
  normalizeInsuranceCustomerKey,
} from "../public/insurance-customer-index-adapter.mjs";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
const ACTION_ID = "33333333-3333-4333-8333-333333333333";

test("Customer Index adapter keeps only the P customer key contract", async () => {
  assert.equal(normalizeInsuranceCustomerKey(" p-dev-0001 "), "P-DEV-0001");
  assert.equal(normalizeInsuranceCustomerKey("P-012345ABCDEF"), "P-012345ABCDEF");
  assert.throws(() => normalizeInsuranceCustomerKey("010-1234-5678"), { code: "INSURANCE_CUSTOMER_KEY_INVALID" });

  const resolved = await createCustomerIndexAdapter({
    resolveIdentity: async (key) => key === "P-012345ABCDEF" ? { displayName: "합성 표시명" } : null,
  }).resolve("P-012345ABCDEF");
  assert.deepEqual(resolved, { customerKey: "P-012345ABCDEF", displayName: "합성 표시명", state: "resolved" });

  const preview = createDefaultCustomerIndexAdapter({ hostname: "deploy-preview-343--worklog-voice-pwa.netlify.app" });
  assert.equal((await preview.resolve("P-DEV-0001")).displayName, "DEV 합성 고객");
  const production = createDefaultCustomerIndexAdapter({ hostname: "worklog-voice-pwa.netlify.app" });
  assert.equal((await production.resolve("P-DEV-0001")).state, "not_found");
});

test("case creation preserves one request id until the RPC succeeds", async () => {
  const calls = [];
  const cleared = [];
  const client = createInsuranceCaseClient({
    nextRequestId: (scope, fingerprint) => {
      calls.push({ type: "id", scope, fingerprint });
      return "44444444-4444-4444-8444-444444444444";
    },
    clearRequestId: (id) => cleared.push(id),
    rpc: async (name, body) => {
      calls.push({ type: "rpc", name, body });
      return [{ insurance_case_id: CASE_ID, revision: 1 }];
    },
  });

  const result = await client.create({
    originalWorkRecordId: SOURCE_ID,
    customerKey: "p-dev-0001",
    title: "  입원   서류 확인  ",
  });

  assert.equal(result.insurance_case_id, CASE_ID);
  assert.deepEqual(calls[0], {
    type: "id",
    scope: "insurance-case",
    fingerprint: `${SOURCE_ID}|P-DEV-0001|입원 서류 확인`,
  });
  assert.deepEqual(calls[1], {
    type: "rpc",
    name: "create_my_insurance_case",
    body: {
      p_client_request_id: "44444444-4444-4444-8444-444444444444",
      p_original_work_record_id: SOURCE_ID,
      p_customer_key: "P-DEV-0001",
      p_title: "입원 서류 확인",
    },
  });
  assert.deepEqual(cleared, ["44444444-4444-4444-8444-444444444444"]);
});

test("failed case creation does not clear the retry request id", async () => {
  const cleared = [];
  const client = createInsuranceCaseClient({
    nextRequestId: () => "55555555-5555-4555-8555-555555555555",
    clearRequestId: (id) => cleared.push(id),
    rpc: async () => { throw new Error("network"); },
  });

  await assert.rejects(client.create({
    originalWorkRecordId: SOURCE_ID,
    customerKey: "P-DEV-0001",
    title: "서류 확인",
  }), /network/);
  assert.deepEqual(cleared, []);
});

test("next action uses the insurance RPC and Core WorkRecord completion RPC", async () => {
  const calls = [];
  const client = createInsuranceCaseClient({
    nextRequestId: () => "66666666-6666-4666-8666-666666666666",
    rpc: async (name, body) => {
      calls.push({ name, body });
      if (name === "create_my_insurance_case_action") {
        return [{ insurance_case_id: CASE_ID, action_work_record_id: ACTION_ID, action_status: "in_progress" }];
      }
      return [{ work_record_id: ACTION_ID, status: "completed" }];
    },
  });

  await client.createAction({ insuranceCaseId: CASE_ID, title: "보험사 회신 확인", dueAt: "2026-09-19" });
  await client.completeAction(ACTION_ID);

  assert.deepEqual(calls, [
    {
      name: "create_my_insurance_case_action",
      body: {
        p_insurance_case_id: CASE_ID,
        p_client_request_id: "66666666-6666-4666-8666-666666666666",
        p_title: "보험사 회신 확인",
        p_due_at: "2026-09-19T00:00:00+09:00",
      },
    },
    {
      name: "update_my_work_record_status",
      body: { p_record_id: ACTION_ID, p_status: "completed" },
    },
  ]);
});

test("case update sends the expected revision and waiting state", async () => {
  let call;
  const client = createInsuranceCaseClient({
    nextRequestId: () => "77777777-7777-4777-8777-777777777777",
    rpc: async (name, body) => {
      call = { name, body };
      return [{ insurance_case_id: CASE_ID, revision: 4 }];
    },
  });
  await client.update({
    insuranceCaseId: CASE_ID,
    expectedRevision: 3,
    title: "보상 문의",
    status: "waiting",
    waitingParty: "insurer",
    waitingReason: "담당자 회신 대기",
  });
  assert.deepEqual(call, {
    name: "update_my_insurance_case",
    body: {
      p_insurance_case_id: CASE_ID,
      p_expected_revision: 3,
      p_title: "보상 문의",
      p_status: "waiting",
      p_waiting_party: "insurer",
      p_waiting_reason: "담당자 회신 대기",
    },
  });
});
