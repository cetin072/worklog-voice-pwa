import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const notes = fs.readFileSync('mobile/src/features/settings/patch-notes.ts', 'utf8');
const agents = fs.readFileSync('AGENTS.md', 'utf8');

test('mobile patch notes include the latest merged Quick Voice and briefing management changes', () => {
  assert.match(notes, /2026-09-22/);
  assert.match(notes, /Android 기본 음성 인식/);
  assert.match(notes, /하단 플로팅/);
  assert.match(notes, /브리핑에서 삭제/);
});

test('patch-note upkeep stays build-time and adds no runtime network dependency', () => {
  assert.match(agents, /정적 로컬 데이터만 사용/);
  assert.match(agents, /GitHub\/Firebase\/외부 API에서 패치노트를 가져오지 않는다/);
  assert.match(agents, /테스트 추가, CI 수정, 내부 리팩터링/);
  assert.doesNotMatch(notes, /fetch\(|axios|github\.com|firebase/i);
});
