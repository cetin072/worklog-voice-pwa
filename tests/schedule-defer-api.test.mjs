import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const api=fs.readFileSync(new URL('../netlify/functions/schedule-defer.mts',import.meta.url),'utf8');
test('미루기 API는 Bearer 로그인과 authenticated RPC를 사용한다',()=>{assert.match(api,/Bearer/);assert.match(api,/createSupabaseDataCoreRestClient/);assert.match(api,/defer_my_schedule/);});
test('미루기 API는 클라이언트가 보낸 새 날짜를 그대로 DB에 쓰지 않고 서버 규칙으로 계산한다',()=>{assert.match(api,/deferScheduleTime\(body\?\.startsAt,preset,body\?\.customStartsAt\)/);});
