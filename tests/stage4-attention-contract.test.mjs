import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260919162133_stage4_attention_contract.sql", import.meta.url), "utf8");
const schema = readFileSync(new URL("../supabase/schemas/01_data_core_v1.sql", import.meta.url), "utf8");

test("Stage 4 attention contract is nullable, independent from due_at, and has no legacy backfill", () => {
  assert.match(migration, /add column if not exists next_attention_at timestamptz null/i);
  assert.match(migration, /Existing records deliberately remain null/i);
  assert.doesNotMatch(migration, /set\s+next_attention_at\s*=/i);
  assert.match(schema, /next_attention_at timestamptz/i);
});

test("completed, cancelled, and Note records cannot retain an attention time", () => {
  assert.match(migration, /new\.status in \('completed', 'cancelled'\)/i);
  assert.match(migration, /new\.action_kind = 'note'/i);
  assert.match(migration, /new\.next_attention_at := null/i);
  assert.match(migration, /before insert or update of status, action_kind, next_attention_at/i);
  assert.match(migration, /revoke all on function public\.clear_irrelevant_work_record_attention\(\) from public, anon, authenticated/i);
});

test("resurface lookup gets a minimal active Task-only workspace index", () => {
  assert.match(migration, /work_records_workspace_next_attention_at_idx/i);
  assert.match(migration, /on public\.work_records \(workspace_id, next_attention_at\)/i);
  assert.match(migration, /action_kind = 'task'/i);
  assert.match(migration, /status in \('in_progress', 'waiting', 'needs_review'\)/i);
});
