import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const sql=fs.readFileSync(new URL('../supabase/migrations/20260917190500_schedule_advance_notification_v1.sql',import.meta.url),'utf8');
test('일정 알림 metadata에는 제목을 저장하지 않는다',()=>{const metadata=(sql.match(/jsonb_build_object\([^\n]+/g)||[]).join('\n');assert.doesNotMatch(metadata,/title/i);});
test('일정 제목은 전송 claim에서만 반환한다',()=>{assert.match(sql,/schedule_title text/);assert.match(sql,/due\.title/);});
test('scheduler secret과 app origin으로 claim 경계를 제한한다',()=>{assert.match(sql,/p_scheduler_secret/);assert.match(sql,/ps\.app_origin=p_app_origin/);});
