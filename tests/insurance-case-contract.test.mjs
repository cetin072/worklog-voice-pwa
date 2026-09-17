import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260917150000_insurance_case_01a1.sql");
const page = read("public/insurance.html");
const app = read("public/insurance.js");
const home = read("public/index.html");
const briefing = read("public/briefing-v2.js");
const sw = read("public/sw.js");

test("insurance case schema stores customer_key without copying customer identity fields", () => {
  assert.match(migration, /create table public\.insurance_cases/);
  assert.match(migration, /customer_key text not null/);
  assert.doesNotMatch(migration, /customer_name\s+text/i);
  assert.doesNotMatch(migration, /phone_number\s+text/i);
  assert.doesNotMatch(migration, /original_work_record_text\s+text/i);
  assert.match(migration, /status in \('intake', 'checking', 'waiting', 'active', 'closed'\)/);
  assert.match(migration, /waiting_party.*'customer'.*'insurer'.*'internal'.*'external'/);
});

test("insurance rows and WorkRecord links enforce workspace isolation", () => {
  assert.match(migration, /alter table public\.insurance_cases enable row level security/);
  assert.match(migration, /alter table public\.insurance_case_work_records enable row level security/);
  assert.match(migration, /private\.can_access_workspace\(workspace_id\)/);
  assert.match(migration, /INSURANCE_CASE_ORIGINAL_WORKSPACE_MISMATCH/);
  assert.match(migration, /INSURANCE_CASE_LINK_WORKSPACE_MISMATCH/);
  assert.match(migration, /original_work_record_id uuid not null references public\.work_records\(id\) on delete restrict/);
  assert.match(migration, /current_action_work_record_id uuid references public\.work_records\(id\) on delete set null/);
});

test("case and action creation are idempotent and preserve action history", () => {
  assert.match(migration, /unique \(workspace_id, client_request_id\)/);
  assert.match(migration, /on conflict \(workspace_id, client_request_id\) do nothing/);
  assert.match(migration, /INSURANCE_CASE_REQUEST_REUSE_CONFLICT/);
  assert.match(migration, /INSURANCE_ACTION_REQUEST_REUSE_CONFLICT/);
  assert.match(migration, /create table public\.insurance_case_work_records/);
  assert.match(migration, /role text not null check \(role in \('original', 'action'\)\)/);
  assert.match(migration, /from public\.save_my_worklog\(/);
  assert.match(migration, /'source', 'insurance_case'/);
  assert.match(migration, /'insuranceCaseId', p_insurance_case_id/);
});

test("state editing uses optimistic revision and action completion cannot close a case", () => {
  assert.match(migration, /and ic\.revision = p_expected_revision/);
  assert.match(migration, /INSURANCE_CASE_REVISION_CONFLICT/);
  assert.doesNotMatch(migration, /update public\.insurance_cases[\s\S]{0,240}action_status[\s\S]{0,120}closed/);
  assert.match(app, /client\.completeAction\(activeCase\.current_action_work_record_id\)/);
  assert.match(app, /await renderDetail\(activeCase\.insurance_case_id\)/);
});

test("insurance UI exposes list, original WorkRecord, state, waiting reason, and Core next action", () => {
  for (const id of [
    "insuranceCaseList", "insuranceCreateForm", "insuranceDetailOriginal",
    "insuranceDetailStatus", "insuranceWaitingParty", "insuranceWaitingReason",
    "insuranceCurrentAction", "insuranceActionForm", "insuranceCompleteAction",
  ]) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(home, /id="insuranceOpen"[^>]+href="\/insurance\.html"/);
  assert.match(briefing, /renderedMode==="data_core"/);
  assert.match(briefing, /insurance\.html\?workRecordId=/);
  assert.match(sw, /"\/insurance\.html"/);
  assert.match(sw, /"\/insurance-case-client\.mjs"/);
  assert.match(sw, /"\/insurance-customer-index-adapter\.mjs"/);
});

test("0.1-A1 stays inside the requested scope", () => {
  const combined = `${migration}\n${page}\n${app}`;
  assert.doesNotMatch(combined, /insurance_claims|insurance_contracts|drive_folder_id|claim_amount|premium_amount/i);
  assert.doesNotMatch(combined, /customer_index_live_identities/);
});
