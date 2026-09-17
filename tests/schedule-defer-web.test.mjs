import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
const client=fs.readFileSync(new URL('../public/schedule-defer.js',import.meta.url),'utf8');
const presets=fs.readFileSync(new URL('../public/schedule-defer-presets.js',import.meta.url),'utf8');
test('웹 미루기 client는 인증 fetch와 공통 API만 사용한다',()=>{assert.match(client,/worklogAuthFetch/);assert.match(client,/\/api\/schedule-defer/);});
test('웹 미루기 선택지는 제품 합의 순서를 유지한다',()=>{for(const label of ['1일 뒤','1주 뒤','15일 뒤','1개월 뒤','날짜 직접 선택']) assert.match(presets,new RegExp(label));});
