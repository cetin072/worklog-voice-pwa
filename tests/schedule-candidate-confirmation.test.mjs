import test from "node:test";
import assert from "node:assert/strict";
import { createSupabaseDataCoreRestClient } from "../netlify/shared/data-core/supabase-rest-client.mjs";
import { createWorklogDataCoreScheduleConfirmation } from "../netlify/shared/worklog-data-core-schedule-confirmation.mjs";

const CANDIDATE_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SCHEDULE_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

test("Data Core REST RPC uses the authenticated user JWT and publishable key", async () => {
  const calls = [];
  const client = createSupabaseDataCoreRestClient({
    supabaseUrl: "https://project.example.test",
    publishableKey: "publishable-key",
    accessToken: "user-access-token",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        json: async () => [{ candidate_id: CANDIDATE_ID, schedule_id: SCHEDULE_ID, candidate_status: "confirmed" }],
      };
    },
  });

  await client.rpc("confirm_schedule_candidate", { p_candidate_id: CANDIDATE_ID });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://project.example.test/rest/v1/rpc/confirm_schedule_candidate");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers.apikey, "publishable-key");
  assert.equal(calls[0].init.headers.authorization, "Bearer user-access-token");
  assert.deepEqual(JSON.parse(calls[0].init.body), { p_candidate_id: CANDIDATE_ID });
});

test("ScheduleCandidate confirmation adapter normalizes one confirmed schedule result", async () => {
  const calls = [];
  const confirmation = createWorklogDataCoreScheduleConfirmation({
    client: {
      rpc: async (name, body) => {
        calls.push({ name, body });
        return [{ candidate_id: CANDIDATE_ID, schedule_id: SCHEDULE_ID, candidate_status: "confirmed" }];
      },
    },
  });

  const result = await confirmation.confirm(CANDIDATE_ID);
  assert.deepEqual(calls, [{ name: "confirm_schedule_candidate", body: { p_candidate_id: CANDIDATE_ID } }]);
  assert.deepEqual(result, { candidateId: CANDIDATE_ID, scheduleId: SCHEDULE_ID, status: "confirmed" });
});

test("ScheduleCandidate confirmation rejects invalid candidate IDs before RPC", async () => {
  let called = false;
  const confirmation = createWorklogDataCoreScheduleConfirmation({
    client: { rpc: async () => { called = true; return []; } },
  });

  await assert.rejects(
    confirmation.confirm("not-a-uuid"),
    error => error?.code === "WORKLOG_SCHEDULE_CONFIRM_CANDIDATE_ID_INVALID",
  );
  assert.equal(called, false);
});

test("ScheduleCandidate confirmation rejects malformed RPC results", async () => {
  const confirmation = createWorklogDataCoreScheduleConfirmation({
    client: { rpc: async () => [{ candidate_id: CANDIDATE_ID, schedule_id: "bad", candidate_status: "confirmed" }] },
  });

  await assert.rejects(
    confirmation.confirm(CANDIDATE_ID),
    error => error?.code === "WORKLOG_SCHEDULE_CONFIRM_RESPONSE_INVALID",
  );
});
