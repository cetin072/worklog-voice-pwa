import test from "node:test";
import assert from "node:assert/strict";

import { publicSupabaseAuthConfig } from "../netlify/shared/platform/supabase-auth-config.mjs";
import { serverSupabaseAdminConfig } from "../netlify/shared/data-core/supabase-admin-config.mjs";
import { createSupabaseAdminRestClient } from "../netlify/shared/data-core/supabase-admin-rest-client.mjs";
import { createTrustedSharedCostAdmin, createTrustedUsageWriter } from "../netlify/shared/data-core/trusted-writers.mjs";

const url = "https://project-ref.supabase.co";
const secret = "sb_secret_fixture_do_not_ship";

function envReader(values) {
  return (name) => values[name];
}

function response(data, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return data; } };
}

test("server admin config는 sb_secret key가 있을 때만 configured 된다", () => {
  assert.deepEqual(
    serverSupabaseAdminConfig(envReader({ SUPABASE_URL: url })),
    { configured: false, supabaseUrl: "", secretKey: "" },
  );

  assert.deepEqual(
    serverSupabaseAdminConfig(envReader({ SUPABASE_URL: url, SUPABASE_SECRET_KEY: "legacy-or-invalid" })),
    { configured: false, supabaseUrl: "", secretKey: "" },
  );

  const config = serverSupabaseAdminConfig(envReader({ SUPABASE_URL: `${url}/`, SUPABASE_SECRET_KEY: secret }));
  assert.equal(config.configured, true);
  assert.equal(config.supabaseUrl, url);
  assert.equal(config.secretKey, secret);
});

test("public Supabase config는 server secret을 읽거나 반환하지 않는다", () => {
  const publicConfig = publicSupabaseAuthConfig(envReader({
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: secret,
    WORKLOG_DATA_CORE_PRIMARY_ENABLED: "true",
  }));

  assert.equal(publicConfig.configured, true);
  assert.equal(publicConfig.publishableKey, "sb_publishable_fixture");
  assert.equal("secretKey" in publicConfig, false);
  assert.equal(JSON.stringify(publicConfig).includes(secret), false);
});

test("admin REST client는 secret을 apikey에만 넣고 Authorization Bearer로 보내지 않는다", async () => {
  const calls = [];
  const client = createSupabaseAdminRestClient({
    supabaseUrl: url,
    secretKey: secret,
    fetchImpl: async (requestUrl, options) => {
      calls.push({ requestUrl, options });
      return response([{ id: "usage_1", workspace_id: "workspace_1", event_key: "event_1" }], { status: 201 });
    },
  });

  await client.insertUsageEventIdempotent({ workspace_id: "workspace_1", event_key: "event_1" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.apikey, secret);
  assert.equal("authorization" in calls[0].options.headers, false);
  assert.match(calls[0].requestUrl, /usage_events/);
});

test("동일 Usage retry는 기존 row로 수렴하고 충돌 payload는 fail-closed 한다", async () => {
  const expected = {
    schema_version: "v1",
    workspace_id: "workspace_1",
    user_id: "user_1",
    event_key: "req:stt:provider",
    request_id: "req",
    feature: "call",
    service: "stt",
    audio_seconds: 60,
    estimated_cost_krw: 10,
    metadata: { source: "test" },
    created_at: "2026-09-15T00:00:00.000Z",
  };

  const sameClient = createSupabaseAdminRestClient({
    supabaseUrl: url,
    secretKey: secret,
    fetchImpl: async (_requestUrl, options) => {
      if (options.method === "POST") return response([], { status: 201 });
      return response([{ id: "usage_existing", ...expected, created_at: "2026-09-15T00:00:01.000Z" }]);
    },
  });
  const same = await sameClient.insertUsageEventIdempotent(expected);
  assert.equal(same.id, "usage_existing");

  const conflictClient = createSupabaseAdminRestClient({
    supabaseUrl: url,
    secretKey: secret,
    fetchImpl: async (_requestUrl, options) => {
      if (options.method === "POST") return response([], { status: 201 });
      return response([{ id: "usage_existing", ...expected, estimated_cost_krw: 99 }]);
    },
  });
  await assert.rejects(
    () => conflictClient.insertUsageEventIdempotent(expected),
    (error) => error?.code === "DATA_CORE_USAGE_EVENT_CONFLICT",
  );
});

test("trusted Usage writer는 Platform Usage Event를 authoritative row로 전달한다", async () => {
  let received;
  const writer = createTrustedUsageWriter({
    async insertUsageEventIdempotent(row) {
      received = row;
      return { id: "usage_1", ...row };
    },
  });

  const result = await writer.record({
    feature: "call",
    service: "stt",
    requestId: "req_1",
    providerRequestId: "provider_1",
    audioSeconds: 45,
    estimatedCostKrw: 12,
  }, {
    userId: "user_1",
    workspaceId: "workspace_1",
    jobId: "job_1",
    now: new Date("2026-09-15T00:00:00Z"),
  });

  assert.equal(writer.configured, true);
  assert.equal(received.event_key, "req_1:stt:provider_1");
  assert.equal(received.user_id, "user_1");
  assert.equal(received.workspace_id, "workspace_1");
  assert.equal(received.audio_seconds, 45);
  assert.equal(result.id, "usage_1");
});

test("trusted Shared Cost admin은 pool upsert와 month recalc를 admin client에 위임한다", async () => {
  const calls = [];
  const admin = createTrustedSharedCostAdmin({
    async upsertSharedCostPool(row) {
      calls.push(["upsert", row]);
      return { id: "pool_1", ...row };
    },
    async recalculateSharedCostAllocations(monthStart) {
      calls.push(["recalc", monthStart]);
      return 4;
    },
  });

  const pool = await admin.upsertPool({
    monthStart: "2026-09-01",
    costKey: "netlify-base",
    provider: "Netlify",
    category: "hosting",
    amountKrw: 200,
  });
  const count = await admin.recalculateMonth("2026-09-01");

  assert.equal(pool.provider, "netlify");
  assert.equal(count, 4);
  assert.equal(calls[0][0], "upsert");
  assert.deepEqual(calls[1], ["recalc", "2026-09-01"]);
});

test("실제 admin REST shared-cost 요청도 apikey only 계약을 유지한다", async () => {
  const calls = [];
  const client = createSupabaseAdminRestClient({
    supabaseUrl: url,
    secretKey: secret,
    fetchImpl: async (requestUrl, options) => {
      calls.push({ requestUrl, options });
      if (requestUrl.includes("/rpc/")) return response(2);
      return response([{ id: "pool_1" }], { status: 201 });
    },
  });

  await client.upsertSharedCostPool({ month_start: "2026-09-01", cost_key: "domain", provider: "domain", category: "domain", amount_krw: 100, allocation_method: "equal_active_user", metadata: {} });
  assert.equal(await client.recalculateSharedCostAllocations("2026-09-01"), 2);
  assert.equal(calls.every((call) => call.options.headers.apikey === secret), true);
  assert.equal(calls.every((call) => !("authorization" in call.options.headers)), true);
});
