import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190000_schedule_defer_reminder_v1.sql',import.meta.url),'utf8');
test('미루기는 본인이 생성한 일정만 변경한다',()=>assert.match(sql,/created_by_user_id=\(select auth\.uid\(\)\)/));
test('미루기 이력은 authenticated 사용자 본인만 조회한다',()=>{assert.match(sql,/enable row level security/);assert.match(sql,/changed_by_user_id = \(select auth\.uid\(\)\)/);});
test('미루기 RPC는 anon/public에 열지 않는다',()=>{assert.match(sql,/revoke all .* from public, anon/);assert.match(sql,/grant execute .* to authenticated/);});
