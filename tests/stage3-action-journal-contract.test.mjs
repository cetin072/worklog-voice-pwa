import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const migration = fs.readFileSync('supabase/migrations/20260919083000_stage3_action_journal_contract.sql', 'utf8');
const schema = fs.readFileSync('supabase/schemas/01_data_core_v1.sql', 'utf8');
const fastSaveMigration = fs.readFileSync('supabase/migrations/20260916002515_worklog_save_fast_path.sql', 'utf8');

test('Stage 3-1 adds an explicit action/journal contract without forcing legacy Task/Note guesses', () => {
  assert.match(migration, /add column action_kind text/);
  assert.match(migration, /action_kind is null or action_kind in \('task', 'note'\)/);
  assert.doesNotMatch(migration, /set action_kind\s*=/i);
  assert.match(schema, /action_kind text check \(action_kind is null or action_kind in \('task', 'note'\)\)/);
});

test('journal_date is distinct from recorded_at and safely backfills legacy records in Asia\/Seoul', () => {
  assert.match(migration, /add column journal_date date/);
  assert.match(migration, /journal_date = \(recorded_at at time zone 'Asia\/Seoul'\)::date/);
  assert.match(migration, /alter column journal_date set not null/);
  assert.match(migration, /if new\.journal_date is null then/);
  assert.match(migration, /coalesce\(new\.recorded_at, now\(\)\) at time zone 'Asia\/Seoul'/);
  assert.match(schema, /journal_date date not null/);
  assert.match(schema, /work_records_workspace_journal_date_idx/);
});

test('briefing acknowledgement is non-destructive and has an undoable timestamp lifecycle', () => {
  assert.match(migration, /briefing_state text not null default 'active'/);
  assert.match(migration, /briefing_state in \('active', 'acknowledged'\)/);
  assert.match(migration, /new\.briefing_state = 'acknowledged'[\s\S]*new\.acknowledged_at := coalesce\(new\.acknowledged_at, now\(\)\)/);
  assert.match(migration, /new\.briefing_state = 'active'[\s\S]*new\.acknowledged_at := null/);
  assert.match(schema, /acknowledged_at timestamptz/);
  assert.match(schema, /work_records_workspace_active_notes_idx/);
});

test('Task completion time is captured on completion and cleared when completion is undone', () => {
  assert.match(migration, /new\.status = 'completed' and old\.status is distinct from 'completed'/);
  assert.match(migration, /new\.completed_at := coalesce\(new\.completed_at, now\(\)\)/);
  assert.match(migration, /new\.status is distinct from 'completed' and old\.status = 'completed'/);
  assert.match(migration, /new\.completed_at := null/);
  assert.match(schema, /completed_at timestamptz/);
});

test('declarative schema mirrors the migration trigger contract', () => {
  for (const token of [
    'private.apply_work_record_action_journal_state',
    'work_records_apply_action_journal_state',
    'briefing_state',
    'completed_at',
    'acknowledged_at',
    'work_records_workspace_active_notes_idx',
  ]) {
    assert.match(schema, new RegExp(token.replaceAll('.', '\\.')));
  }
});

test('existing fast-save RPC remains compatible because new journal fields are trigger/default backed', () => {
  assert.match(fastSaveMigration, /insert into public\.work_records/);
  assert.doesNotMatch(fastSaveMigration, /journal_date/);
  assert.doesNotMatch(fastSaveMigration, /action_kind/);
  assert.match(migration, /before insert or update of recorded_at, journal_date, status, briefing_state, completed_at, acknowledged_at/);
  assert.match(migration, /briefing_state text not null default 'active'/);
});
