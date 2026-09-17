import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190000_schedule_defer_reminder_v1.sql',import.meta.url),'utf8');
test('미루기 시 종료시각은 기존 일정 duration을 보존한다',()=>{assert.match(sql,/v_duration := case when v\.ends_at is null then null else v\.ends_at-v\.starts_at end/);assert.match(sql,/p_new_starts_at\+v_duration/);});
