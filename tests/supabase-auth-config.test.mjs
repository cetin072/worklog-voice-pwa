import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { publicSupabaseAuthConfig } from "../netlify/shared/platform/supabase-auth-config.mjs";

test("Supabase 공개 Auth 설정은 HTTPS origin과 publishable key만 노출한다", () => {
  const config = publicSupabaseAuthConfig((name) => ({
    SUPABASE_URL: "https://project.supabase.co/",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_example",
    WORKLOG_DATA_CORE_PRIMARY_ENABLED: "true"
  })[name]);

  assert.deepEqual(config, {
    configured: true,
    supabaseUrl: "https://project.supabase.co",
    publishableKey: "sb_publishable_example",
    dataCorePrimaryEnabled: true
  });
});

test("Supabase 공개 Auth 설정은 누락되었거나 HTTP인 값을 비활성화한다", () => {
  assert.equal(publicSupabaseAuthConfig(() => "").configured, false);
  assert.equal(publicSupabaseAuthConfig((name) => name === "SUPABASE_URL" ? "http://localhost:54321" : "sb_publishable_example").configured, false);
  assert.equal(publicSupabaseAuthConfig((name) => ({ SUPABASE_URL: "https://project.supabase.co", SUPABASE_PUBLISHABLE_KEY: "key", WORKLOG_DATA_CORE_PRIMARY_ENABLED: "false" })[name]).dataCorePrimaryEnabled, false);
});

test("Personal Workspace bootstrap migration은 사용자별 단일 공간과 인증된 RPC 경계를 둔다", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260914161008_personal_workspace_bootstrap.sql", import.meta.url), "utf8");
  assert.match(sql, /create unique index workspaces_one_personal_per_owner_idx/i);
  assert.match(sql, /where kind = 'personal'/i);
  assert.match(sql, /v_user_id uuid := \(select auth\.uid\(\)\)/i);
  assert.match(sql, /on conflict \(workspace_id, user_id\)/i);
  assert.match(sql, /revoke all on function public\.bootstrap_personal_workspace\(\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.bootstrap_personal_workspace\(\) to authenticated, service_role/i);
  assert.match(sql, /after insert on auth\.users/i);
});

test("Worklog dual-write migration은 Data Core 두 엔티티의 요청 ID 수렴을 강제한다", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260914161258_data_core_worklog_idempotency.sql", import.meta.url), "utf8");
  assert.match(sql, /alter table public\.work_records\s+add column client_request_id text/i);
  assert.match(sql, /unique \(workspace_id, client_request_id\)/i);
  assert.match(sql, /alter table public\.source_refs\s+add column client_request_id text/i);
  assert.match(sql, /char_length\(client_request_id\) between 16 and 100/i);
});

test("WorkRecord 상태 mutation은 workspace member가 아니라 creator 본인으로 제한된다", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20260915011501_restrict_work_record_mutations_to_creator.sql", import.meta.url), "utf8");
  assert.match(sql, /drop policy if exists work_records_update_member/i);
  assert.match(sql, /create policy work_records_update_creator/i);
  assert.match(sql, /created_by_user_id = \(select auth\.uid\(\)\)/i);
});
