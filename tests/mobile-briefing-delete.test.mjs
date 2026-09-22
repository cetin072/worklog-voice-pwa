import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const api = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');
const briefingReader = fs.readFileSync('netlify/shared/worklog-data-core-briefing-reader.mjs', 'utf8');
const journalMigration = fs.readFileSync('supabase/migrations/20260919120000_stage3_auto_work_journal.sql', 'utf8');
const deleteMigration = fs.readFileSync('supabase/migrations/20260922103000_work_record_soft_delete_v1.sql', 'utf8');

test('mobile briefing exposes confirmed delete beside tasks and notes without using completion', () => {
  assert.match(home, /accessibilityLabel=\{\`\$\{task\.title \|\| '업무'\} 삭제\`\}/);
  assert.match(home, /accessibilityLabel=\{\`\$\{note\.title \|\| '메모'\} 삭제\`\}/);
  assert.match(home, /style: 'destructive'/);
  assert.match(home, /완료 기록이나 업무일지에는 남기지 않습니다/);
  assert.match(home, /deleteWorklog\(accessToken, recordId\)/);
  assert.match(home, /reconcileCanceledScheduleArtifacts\(client\)/);
  assert.match(home, /inlineDelete/);
});

test('mobile delete calls the edit API and hides retained cancelled rows from search', () => {
  assert.match(api, /export async function deleteWorklog/);
  assert.match(api, /JSON\.stringify\(\{ action: 'delete', pageId \}\)/);
  assert.match(api, /if \(status === 'cancelled'\) return \[\]/);
});

test('soft-deleted work records are excluded from briefing and automatic work journal projections', () => {
  assert.match(briefingReader, /status: "in\.\(in_progress,waiting,needs_review\)"/);
  assert.match(journalMigration, /where wr\.status = 'completed'/);
  assert.match(journalMigration, /where wr\.status in \('in_progress', 'waiting', 'needs_review'\)/);
  assert.match(journalMigration, /wr\.status <> 'cancelled'/);
  assert.match(deleteMigration, /set status = 'cancelled'/);
  assert.doesNotMatch(deleteMigration, /delete\s+from\s+public\.work_records/i);
});
