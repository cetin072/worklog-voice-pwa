import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/voice/stt-benchmark-fixtures.ts', 'utf8');

test('Korean STT bakeoff keeps one short and one longer fixture stable', () => {
  assert.match(source, /ko-10s-entities/);
  assert.match(source, /ko-30s-workflow/);
  assert.match(source, /9월 22일 오후 2시 30분/);
  assert.match(source, /미래여성가족진흥원/);
});

test('Korean STT fixtures emphasize decision-changing entities', () => {
  for (const value of ['부산시청', '김정원 과장', '350만원', '다음 주 금요일 오후 4시', '이선영 팀장', '태장 홈페이지', '9월 25일', '오전 10시', '1,250만원']) {
    assert.equal(source.includes(value), true, value + ' fixture missing');
  }
});
