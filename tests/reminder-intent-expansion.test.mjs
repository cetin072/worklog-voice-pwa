import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyWorklogAction, isTimedScheduleIntent } from '../netlify/shared/action-engine-v1.mjs';
import { extractScheduleFromText } from '../netlify/shared/schedule-extract.mjs';
const recordedAt = '2026-10-24T10:00:00+09:00';
for (const source of ['내일 오전 9시 진주IC 가기', '내일 오전 9시 진주ic가는 일정', '내일 오전 9시에 회사로 가기', '내일 오전 9시 보고서 확인 알려줘', '10분 뒤 자료 확인 알려줘']) {
  test(`explicit future reminder: ${source}`, () => {
    assert.equal(classifyWorklogAction({ transcript: source, recordedAt }).kind, 'schedule');
  });
}
for (const source of ['내일 오전 9시까지 보고서 제출', '내일 진주IC 가기', '진주IC 가기', '내일 저녁 9시 진주IC 가기 메모', '내일 저녁 9시 알림 취소', '내일 오전 9시 회의 알림 취소', '오전 9시 진주IC 가기', '내일 9시 진주IC 가기', '내일 오전 9시 진주IC 가지 마', '내일 오전 9시 회사로 가는 메모', '내일 오전 9시 자료 확인 알려주지 마', '10분 뒤와 내일 오전 9시에 알려줘']) {
  test(`no silent schedule: ${source}`, () => {
    assert.notEqual(classifyWorklogAction({ transcript: source, recordedAt }).kind, 'schedule');
  });
}
test('explicit note/task category survives newly recognized reminder intent', () => {
  for (const explicitType of ['아이디어', '할 일']) assert.equal(isTimedScheduleIntent({ source: '내일 오전 9시 진주IC 가기', dueStart: '2026-10-25T09:00:00+09:00', explicitType }), false);
});
test('relative instant is calculated from capture time and not device timezone', () => {
  const result = extractScheduleFromText('10분 뒤 알려줘', recordedAt);
  assert.equal(Date.parse(result.dueStart), Date.parse(recordedAt) + 600000);
});

test('evening clock is not an event overriding an explicit note type',()=>{ assert.notEqual(classifyWorklogAction({transcript:'내일 저녁 9시 진주IC 가기',recordedAt,explicitType:'아이디어'}).kind,'schedule'); });
