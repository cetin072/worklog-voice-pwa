import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const api=fs.readFileSync(new URL('../netlify/functions/schedule-defer.mts',import.meta.url),'utf8');test('미루기 API는 기존 Supabase Data Core만 사용한다',()=>{assert.match(api,/createSupabaseDataCoreRestClient/);assert.doesNotMatch(api,/firebase|onesignal|pusher/i);});
