import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const fn=fs.readFileSync(new URL('../netlify/functions/schedule-advance-push.mts',import.meta.url),'utf8');
test('일정 사전 알림은 기존 Web Push/VAPID만 재사용한다',()=>{assert.match(fn,/sendWebPush/);assert.match(fn,/vapidConfigFromEnv/);assert.doesNotMatch(fn,/firebase|onesignal|pusher/i);});
