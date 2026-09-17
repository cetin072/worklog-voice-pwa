import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190500_schedule_advance_notification_v1.sql',import.meta.url),'utf8');
test('미룬 일정도 동일 schedule id 기준 한 번만 발송되도록 delivery source key를 사용한다',()=>{assert.match(sql,/source_key/);assert.match(sql,/due\.id::text/);assert.match(sql,/on conflict do nothing/);});
