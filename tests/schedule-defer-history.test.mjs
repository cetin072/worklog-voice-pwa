import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190000_schedule_defer_reminder_v1.sql',import.meta.url),'utf8');
test('미루기 이력은 이전/새 시작 및 종료 시각과 preset을 기록한다',()=>{for(const field of ['previous_starts_at','previous_ends_at','new_starts_at','new_ends_at','preset'])assert.match(sql,new RegExp(field));});
