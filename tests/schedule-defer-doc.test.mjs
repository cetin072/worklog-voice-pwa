import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const doc=fs.readFileSync(new URL('../docs/SCHEDULE_DEFER_REMINDER_V1.md',import.meta.url),'utf8');
test('기획 문서는 웹/앱 공통 서버 경계와 PWA 전용 snooze 제외를 명시한다',()=>{assert.match(doc,/웹\/앱 공통/);assert.match(doc,/PWA 전용 Snooze 액션은 이 범위에 넣지 않는다/);assert.match(doc,/Production Supabase 적용은 사용자 명시 승인 전 금지/);});
