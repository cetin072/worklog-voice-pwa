import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// Node 24 strips type-only syntax from this dependency-free TypeScript model.
// The actual exported functions run, without npm packages or native Expo modules.
const core = await import('../mobile/src/features/voice/meeting-minutes-document.ts');
const { assertMeetingRecordingId, createMeetingMinutesDocument, parseMeetingMinutesDocument, formatMeetingMinutesForShare } = core;
const id = 'meeting-20261105123000-recording.m4a';
const when = new Date('2026-11-05T03:30:00Z');

test('local meeting document saves separate raw text and editable minutes without fabricating content', () => {
  const doc = createMeetingMinutesDocument({
    recordingId: id,
    transcriptText: ' 결정 사항은\n 자료 확인입니다. ',
    minutesText: ' 참석자 확인\n 후속 연락 필요 ',
    now: when,
  });
  assert.equal(doc.version, 1);
  assert.equal(doc.recordingId, id);
  assert.equal(doc.transcriptText, '결정 사항은\n 자료 확인입니다.');
  assert.equal(doc.minutesText, '참석자 확인\n 후속 연락 필요');
  assert.equal(doc.createdAt, '2026-11-05T03:30:00.000Z');
  assert.ok(Object.isFrozen(doc));
  assert.deepEqual(parseMeetingMinutesDocument(JSON.parse(JSON.stringify(doc)), id), doc);

  const revised = createMeetingMinutesDocument({
    recordingId: id, previous: doc, transcriptText: doc.transcriptText,
    minutesText: '보고서 수정 후 공유', now: new Date('2026-11-05T03:35:00Z'),
  });
  assert.equal(revised.createdAt, doc.createdAt);
  assert.equal(revised.updatedAt, '2026-11-05T03:35:00.000Z');
  assert.equal(doc.minutesText, '참석자 확인\n 후속 연락 필요', 'old draft remains unchanged');
});

test('wrong recording, invalid content or corrupted drafts fail closed rather than overwrite another recording', () => {
  assert.equal(assertMeetingRecordingId(id), id);
  for (const bad of ['', '../private', 'meeting-../private', 'other-recording', 'meeting-한글', 'meeting-/' ]) {
    assert.throws(() => assertMeetingRecordingId(bad), bad);
  }
  const doc = createMeetingMinutesDocument({ recordingId: id, transcriptText: '', minutesText: '안건', now: when });
  assert.throws(() => parseMeetingMinutesDocument(doc, 'meeting-20261105123000-other.m4a'));
  assert.throws(() => createMeetingMinutesDocument({ recordingId: id, transcriptText: '', minutesText: '' }));
  assert.throws(() => createMeetingMinutesDocument({ recordingId: id, transcriptText: '', minutesText: '가'.repeat(120001) }));
  assert.throws(() => createMeetingMinutesDocument({ recordingId: id, transcriptText: '', minutesText: '수정', previous: { ...doc, recordingId: 'meeting-other' } }));
  assert.throws(() => parseMeetingMinutesDocument({ ...doc, createdAt: 'invalid date' }, id));
  assert.throws(() => parseMeetingMinutesDocument({ ...doc, updatedAt: '2026-11-04T03:30:00Z' }, id));
  assert.throws(() => parseMeetingMinutesDocument({ ...doc, version: 2 }, id));
});

test('share output contains only user-entered text and does not pretend to auto-summarize', () => {
  const doc = createMeetingMinutesDocument({
    recordingId: id, transcriptText: '녹취문 직접 입력', minutesText: '수정한 최종 회의록', now: when,
  });
  const result = formatMeetingMinutesForShare({
    document: doc,
    title: '  협력 회의 ', recordedAt: when.toISOString(),
  });
  assert.match(result, /회의록 — 협력 회의/);
  assert.match(result, /녹음 일시:/);
  assert.match(result, /\[회의록\]/);
  assert.match(result, /수정한 최종 회의록/);
  assert.match(result, /\[녹취문 · 직접 입력\]/);
  assert.match(result, /녹취문 직접 입력/);
  assert.doesNotMatch(result, /자동 요약|AI 생성/);
});

test('Android UI wires local save/read/share to existing recording without exposing auto-transcribe', () => {
  const ui = readFileSync('mobile/src/features/voice/meeting-recording-library.tsx', 'utf8');
  const storage = readFileSync('mobile/src/features/voice/meeting-minutes-storage.ts', 'utf8');
  assert.match(ui, /MeetingMinutesEditor/);
  assert.match(ui, /MeetingRecordingPlayer recording=\{recording\}/);
  assert.match(ui, /loadMeetingMinutes\(recording\.id\)/);
  assert.match(ui, /saveMeetingMinutes\(/);
  assert.match(ui, /Share\.share\(/);
  assert.match(ui, /자동 전사는 아직 연결 전입니다/);
  assert.match(ui, /저장하지 않은 변경/);
  assert.match(ui, /recordingId: recording\.id/);
  assert.match(storage, /Paths\.document/);
  assert.match(storage, /temporary\.moveSync\(target, \{ overwrite: true \}\)/);
  assert.match(storage, /parseMeetingMinutesDocument\(JSON\.parse\(temporary\.textSync\(\)\)/);
  assert.match(storage, /if \(!file\.exists\) return null/);
  assert.doesNotMatch(storage, /fetch\s*\(|upload|service.?role|new File\(input\.recording\.uri\)/i);
  assert.doesNotMatch(ui, /transcribeMeetingRecording\(/);
});
