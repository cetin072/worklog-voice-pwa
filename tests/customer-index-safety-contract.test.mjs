import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260917023000_customer_index_daily_sync_v01.sql");
const runnerSource = read("scripts/customer-index-daily-sync.mjs");
const workflowSource = read(".github/workflows/customer-index-daily-sync.yml");
const driveSource = read("netlify/shared/customer-index/google-drive-adapter.mjs");
const syncSource = read("netlify/shared/customer-index/daily-sync.mjs");
const docs = read("docs/CUSTOMER_INDEX_DAILY_INCREMENTAL_SYNC_V01.md");

test("LIVE customer index tables are service-role only", () => {
  const tables = [
    "customer_index_live_identities",
    "customer_index_sync_runs",
    "customer_index_sync_checkpoints",
    "customer_index_drive_items",
    "customer_index_source_links",
    "customer_index_review_queue",
    "customer_index_sync_events",
  ];
  for (const table of tables) {
    assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`));
    assert.match(migration, new RegExp(`revoke all on table public\\.${table} from anon, authenticated`));
    assert.match(migration, new RegExp(`grant select, insert, update, delete on table public\\.${table} to service_role`));
  }
  assert.doesNotMatch(migration, /grant\s+.+\s+to\s+(anon|authenticated)/i);
});

test("Drive connector is read-only and MASTER is a guard target, not a write target", () => {
  assert.match(driveSource, /drive\.metadata\.readonly/);
  assert.doesNotMatch(driveSource, /drive\.file|\/upload\/drive|driveCreate|driveUpdate|driveDelete/);
  assert.equal((driveSource.match(/method:\s*"POST"/g) || []).length, 1, "only OAuth token exchange may POST");
  assert.match(driveSource, /watchFolderId !== masterFileId/);
  assert.match(docs, /MASTER[^\n]*읽기 전용/);
});

test("scheduled workflow is daily, disabled by default, and logs counts only", () => {
  assert.match(workflowSource, /cron: "15 0 \* \* \*"/);
  assert.match(workflowSource, /if: \$\{\{ vars\.CUSTOMER_INDEX_SYNC_ENABLED == 'true' \}\}/);
  assert.match(runnerSource, /CUSTOMER_INDEX_SYNC_ENABLED/);
  assert.match(runnerSource, /changed: result\.changed/);
  assert.doesNotMatch(runnerSource, /result\.(name|fullName|phone|path)/);
});

test("sync engine contains no customer identity deletion path", () => {
  assert.doesNotMatch(syncSource, /deleteIdentity|removeIdentity|deleteCustomer/);
  assert.match(syncSource, /decision:\s*"source_unavailable"/);
  assert.match(syncSource, /NAME_ONLY_MATCH_INSUFFICIENT/);
});
