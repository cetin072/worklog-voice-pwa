import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const fn=fs.readFileSync(new URL('../netlify/functions/schedule-advance-push.mts',import.meta.url),'utf8');
test('일정 Push 성공/실패 모두 delivery finish를 기록한다',()=>{assert.match(fn,/success:true/);assert.match(fn,/success:false/);assert.match(fn,/WEB_PUSH_UNKNOWN/);});
