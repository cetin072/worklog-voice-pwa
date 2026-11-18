import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

test('confirming a review clears only the displayed date of an open owned task', async () => {
  const db = new PGlite();
  try {
    const owner = '00000000-0000-4000-8000-000000000001';
    const other = '00000000-0000-4000-8000-000000000002';
    const workspace = '00000000-0000-4000-8000-000000000003';
    const otherWorkspace = '00000000-0000-4000-8000-000000000004';
    const record = '00000000-0000-4000-8000-000000000005';
    const shown = '2026-11-18T00:00:00Z';
    const newer = '2026-11-20T00:00:00Z';
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema worklog;
      create function auth.uid() returns uuid language sql stable as
        $$select current_setting('request.jwt.claim.sub')::uuid$$;
      create table worklog.workspaces(id uuid primary key, owner_user_id uuid, kind text, created_at timestamptz default now());
      create table worklog.work_records(
        id uuid primary key, workspace_id uuid, created_by_user_id uuid, status text,
        action_kind text, title text, due_at timestamptz, next_attention_at timestamptz, updated_at timestamptz
      );
      insert into worklog.workspaces(id, owner_user_id, kind) values
        ('${workspace}', '${owner}', 'personal'), ('${otherWorkspace}', '${other}', 'personal');
      insert into worklog.work_records values
        ('${record}', '${workspace}', '${owner}', 'in_progress', 'task', '공급조건', null, '${newer}', now());
      grant usage on schema auth, worklog to anon, authenticated;
      grant select on worklog.workspaces, worklog.work_records to authenticated;
      grant update on worklog.work_records to authenticated;
    `);
    await db.exec(readFileSync('supabase/migrations/20261118091000_lock_work_review_attention.sql', 'utf8'));
    const login = id => db.query("select set_config('request.jwt.claim.sub', $1, false)", [id]);
    const change = (expected, previous = null) => db.query(
      'select * from worklog.undo_my_work_record_attention($1, $2, $3)', [record, expected, previous],
    );
    await db.exec('set role anon');
    await assert.rejects(change(newer), { code: '42501' });
    await db.exec('reset role; set role authenticated');
    await login(other);
    await assert.rejects(change(newer), /WORK_RECORD_NOT_FOUND_OR_FORBIDDEN/);
    await login(owner);
    await assert.rejects(change(shown), /WORK_RECORD_ATTENTION_UNDO_STALE/);
    assert.equal((await change(newer)).rows[0].next_attention_at_value, null);
    await assert.rejects(change(newer), /WORK_RECORD_ATTENTION_UNDO_STALE/);
    assert.equal((await change(null, newer)).rows[0].next_attention_at_value.toISOString(), '2026-11-20T00:00:00.000Z');
    const { rows } = await db.query('select status, title, due_at, workspace_id from worklog.work_records where id = $1', [record]);
    assert.deepEqual(rows[0], { status: 'in_progress', title: '공급조건', due_at: null, workspace_id: workspace });
  } finally {
    await db.close();
  }
});
