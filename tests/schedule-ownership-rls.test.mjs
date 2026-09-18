import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const schema = fs.readFileSync('supabase/schemas/01_data_core_v1.sql', 'utf8');
const migration = fs.readFileSync('supabase/migrations/20260919010000_schedule_creator_rls_and_soft_delete.sql', 'utf8');

test('schedule updates are creator-only in both RLS predicates', () => {
  for (const source of [schema, migration]) {
    assert.match(source, /create policy schedules_update_creator/i);
    assert.match(source, /using \([\s\S]*created_by_user_id = \(select auth\.uid\(\)\)[\s\S]*\)/i);
    assert.match(source, /with check \([\s\S]*created_by_user_id = \(select auth\.uid\(\)\)[\s\S]*\)/i);
  }
});

test('authenticated users cannot hard-delete schedules or work records', () => {
  assert.match(migration, /drop policy if exists schedules_delete_member/i);
  assert.match(migration, /drop policy if exists work_records_delete_member/i);
  assert.match(migration, /revoke delete on table public\.schedules from authenticated/i);
  assert.match(migration, /revoke delete on table public\.work_records from authenticated/i);
  assert.doesNotMatch(schema, /create policy schedules_delete_member/i);
  assert.doesNotMatch(schema, /create policy work_records_delete_member/i);
});
