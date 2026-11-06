import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const files = new Map();
let failNextMove = false;
const Paths = { document: 'file:///worklog' };
class File {
  constructor(...parts) { this.uri = parts.join('/'); }
  get name() { return this.uri.split('/').at(-1) || ''; }
  get creationTime() { return this.exists ? Date.parse('2026-11-06T07:00:00Z') : null; }
  get modificationTime() { return this.creationTime; }
  get exists() { return files.has(this.uri); }
  get size() { return this.exists ? Buffer.byteLength(files.get(this.uri)) : 0; }
  create() {
    if (this.exists) throw new Error('file exists');
    files.set(this.uri, '');
  }
  // Expo 57 File.write is synchronous. Expo 58 changed this API.
  write(value) { files.set(this.uri, String(value)); }
  textSync() {
    if (!this.exists) throw new Error('missing file');
    return files.get(this.uri);
  }
  moveSync(destination, options = {}) {
    if (failNextMove) { failNextMove = false; throw new Error('simulated move failure'); }
    if (!this.exists) throw new Error('missing file');
    if (destination.exists && !options.overwrite) throw new Error('destination exists');
    files.set(destination.uri, files.get(this.uri));
    files.delete(this.uri);
    // Expo File.moveSync updates the source object's URI to its new location.
    this.uri = destination.uri;
  }
  delete() { files.delete(this.uri); }
}
class Directory {
  constructor(...parts) { this.uri = parts.join('/'); }
  list() {
    return [...files.keys()]
      .filter((uri) => uri.startsWith(this.uri + '/') && !uri.slice(this.uri.length + 1).includes('/'))
      .map((uri) => new File(uri));
  }
}
globalThis.__meetingFileMock = { File, Directory, Paths };
const model = await import('../mobile/src/features/voice/meeting-minutes-document.ts');
globalThis.__meetingModel = model;

async function loadActualTypeScript(path, replacements) {
  let source = readFileSync(path, 'utf8');
  for (const [from, to] of replacements) {
    if (from instanceof RegExp) {
      assert.equal([...source.matchAll(new RegExp(from.source, 'g'))].length, 1, 'matched import once');
    } else {
      assert.equal(source.split(from).length, 2, 'actual source must contain expected import once');
    }
    source = source.replace(from, to);
  }
  const js = stripTypeScriptTypes(source, { mode: 'strip' });
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
const expoStub = [/import \{ (?:Directory, )?File, Paths \} from 'expo-file-system';/,
  "const { File, Directory, Paths } = globalThis.__meetingFileMock;"];
const recordings = await loadActualTypeScript('mobile/src/features/voice/meeting-recordings.ts', [
  expoStub,
]);
const minutes = await loadActualTypeScript('mobile/src/features/voice/meeting-minutes-storage.ts', [
  expoStub,
  [/import \{[\s\S]*?\} from '\.\/meeting-minutes-document';/,
   'const { assertMeetingRecordingId, createMeetingMinutesDocument, parseMeetingMinutesDocument } = globalThis.__meetingModel;'],
]);

function reset() { files.clear(); failNextMove = false; }
function recording(index) {
  const uri = `file:///recordings/recording-${String(index).padStart(4, '0')}.m4a`;
  files.set(uri, 'M4A');
  return {
    sourceKind: 'mobile-recording',
    uri,
    fileName: uri.split('/').at(-1),
    mimeType: 'audio/mp4',
    durationMs: 60000,
    createdAt: new Date(Date.UTC(2026, 10, 1, 10, 0, index)).toISOString(),
  };
}
const indexUri = 'file:///worklog/meeting-recordings-v1.json';

test('201+ meetings retain all titles, old records and original audio after new saves', () => {
  reset();
  for (let i = 0; i < 205; i++) recordings.rememberMeetingRecording(recording(i));
  const stored = recordings.listMeetingRecordings();
  assert.equal(stored.length, 205);
  assert.equal(JSON.parse(files.get(indexUri)).items.length, 205);
  assert.ok(stored.some(row => row.fileName === 'recording-0000.m4a'));
  assert.ok(stored.some(row => row.fileName === 'recording-0204.m4a'));
  assert.equal(files.has('file:///recordings/recording-0000.m4a'), true);
});

test('temporarily unavailable audio never removes recording metadata or linked meeting text', () => {
  reset();
  const first = recordings.rememberMeetingRecording(recording(1));
  minutes.saveMeetingMinutes({ recordingId: first.id, transcriptText: '회의 전사', minutesText: '회의록', expectedPrevious: null });
  files.delete(first.uri);
  const listed = recordings.listMeetingRecordings();
  assert.equal(listed.length, 1);
  assert.equal(recordings.isMeetingRecordingFileAvailable(listed[0]), false);
  assert.equal(minutes.loadMeetingMinutes(first.id).minutesText, '회의록');
  recordings.rememberMeetingRecording(recording(2));
  assert.equal(recordings.listMeetingRecordings().length, 2);
  // Explicitly deleting unavailable audio still leaves a discoverable minutes entry.
  recordings.deleteMeetingRecording(first.id);
  assert.equal(recordings.listMeetingRecordings().length, 2);
});

test('stale editor save is rejected without overwriting latest minutes', () => {
  reset();
  const row = recordings.rememberMeetingRecording(recording(3));
  const a = minutes.saveMeetingMinutes({ recordingId: row.id, transcriptText: '', minutesText: '1차', expectedPrevious: null });
  const b = minutes.saveMeetingMinutes({ recordingId: row.id, transcriptText: '', minutesText: '2차', expectedPrevious: a });
  assert.equal(b.minutesText, '2차');
  const uri = `file:///worklog/meeting-minutes-${row.id}.json`;
  const before = files.get(uri);
  assert.throws(() => minutes.saveMeetingMinutes({
    recordingId: row.id, transcriptText: '', minutesText: '오래된 화면', expectedPrevious: a,
  }), /다른 화면에서 변경/);
  assert.equal(files.get(uri), before);
  assert.throws(() => minutes.saveMeetingMinutes({
    recordingId: row.id, transcriptText: '', minutesText: '또 다른 화면', expectedPrevious: null,
  }), /다른 화면에서 변경/);
});

test('corrupt index or damaged minutes fail closed, never silently reset', () => {
  reset();
  const row = recordings.rememberMeetingRecording(recording(5));
  const rawIndex = files.get(indexUri);
  files.set(indexUri, '{broken');
  assert.throws(() => recordings.listMeetingRecordings(), /기존 목록 파일/);
  assert.throws(() => recordings.rememberMeetingRecording(recording(6)), /기존 목록 파일/);
  assert.equal(files.get(indexUri), '{broken');
  files.set(indexUri, rawIndex);
  minutes.saveMeetingMinutes({ recordingId: row.id, transcriptText: '', minutesText: '정상', expectedPrevious: null });
  const uri = `file:///worklog/meeting-minutes-${row.id}.json`;
  files.set(uri, '{invalid');
  assert.throws(() => minutes.loadMeetingMinutes(row.id), /기존 파일은 보존/);
  assert.throws(() => minutes.saveMeetingMinutes({
    recordingId: row.id, transcriptText: '', minutesText: '덮어쓰지 마', expectedPrevious: null,
  }), /기존 파일은 보존/);
  assert.equal(files.get(uri), '{invalid');
});

test('failed temporary index replacement preserves prior index and every recorded audio', () => {
  reset();
  recordings.rememberMeetingRecording(recording(8));
  const baseline = files.get(indexUri);
  failNextMove = true;
  assert.throws(() => recordings.rememberMeetingRecording(recording(9)), /목록을 저장하지 못했습니다/);
  assert.equal(files.get(indexUri), baseline);
  assert.equal(files.has('file:///recordings/recording-0008.m4a'), true);
  assert.equal(files.has('file:///recordings/recording-0009.m4a'), true);
});

test('search matches meeting title and local recording date without loading transcript text', () => {
  reset();
  const a = recordings.rememberMeetingRecording(recording(10));
  const b = recordings.rememberMeetingRecording(recording(11));
  recordings.renameMeetingRecording(a.id, '제품 회의');
  recordings.renameMeetingRecording(b.id, '태장 운영회의');
  const all = recordings.listMeetingRecordings();
  assert.deepEqual(recordings.searchMeetingRecordings(all, '운영회의').map(x => x.id), [b.id]);
  assert.equal(recordings.searchMeetingRecordings(all, '2026').length, 2);
  assert.equal(recordings.searchMeetingRecordings(all, '없음').length, 0);
  assert.equal(recordings.searchMeetingRecordings(all, '').length, 2);
});

test('UI keeps month grouping, explicit search and 20-row page without reading full minutes per card', () => {
  const source = readFileSync('mobile/src/features/voice/meeting-recording-library.tsx', 'utf8');
  assert.match(source, /회의 기록 검색/);
  assert.match(source, /회의명·날짜 검색/);
  assert.match(source, /visibleCount, setVisibleCount/);
  assert.match(source, /matchingItems\.slice\(0, visibleCount\)/);
  assert.match(source, /20건 더 보기/);
  assert.match(source, /formatRecordingMonth/);
  assert.match(source, /hasMeetingMinutes\(recording\.id\)/);
  assert.match(source, /expectedPrevious: saved/);
  assert.match(source, /!loaded \|\| loadFailed/);
  assert.match(source, /isMeetingRecordingFileAvailable\(recording\)/);
});

test('new or existing QA orphan M4A files are recovered into the list without touching audio', () => {
  reset();
  const names = [
    'recording-63a1bd1e-dded-4bef-b324-bad46eb04bfc.m4a',
    'recording-6d7f280c-e101-460f-834d-dca3f77540ed.m4a',
  ];
  for (const name of names) files.set('file:///worklog/' + name, 'PRESERVED-ORIGINAL-AUDIO');
  assert.equal(files.has(indexUri), false);
  const saved = recordings.listMeetingRecordings();
  assert.equal(saved.length, 2);
  assert.ok(saved.every((entry) => entry.durationMs === 0));
  assert.ok(saved.every((entry) => entry.id.startsWith('meeting-')));
  assert.deepEqual(new Set(saved.map((entry) => entry.fileName)), new Set(names));
  assert.equal(recordings.listMeetingRecordings().length, 2, 'recovery is idempotent after app restart');
  for (const name of names) assert.equal(files.get('file:///worklog/' + name), 'PRESERVED-ORIGINAL-AUDIO');
});

test('a damaged index never gets overwritten during M4A recovery', () => {
  reset();
  files.set('file:///worklog/recording-63a1bd1e-dded-4bef-b324-bad46eb04bfc.m4a', 'M4A');
  files.set(indexUri, '{original-broken-metadata');
  assert.throws(() => recordings.listMeetingRecordings(), /기존 목록 파일/);
  assert.equal(files.get(indexUri), '{original-broken-metadata');
});

test('Expo 57 writes index and minutes synchronously, verifies moved files and prevents final-file cleanup', () => {
  const indexSource = readFileSync('mobile/src/features/voice/meeting-recordings.ts', 'utf8');
  const draftSource = readFileSync('mobile/src/features/voice/meeting-minutes-storage.ts', 'utf8');
  assert.match(indexSource, /pending\.write\(text\)/);
  assert.match(draftSource, /temporary\.write\(payload\)/);
  assert.match(indexSource, /movedToTarget = true/);
  assert.match(draftSource, /movedToTarget = true/);
  assert.match(indexSource, /if \(!movedToTarget && pending\.exists\)/);
  assert.match(draftSource, /if \(!movedToTarget && temporary\.exists\)/);
  assert.match(indexSource, /const committed = readIndexRaw\(\)/);
  assert.match(indexSource, /if \(!readIndexRaw\(\)\.some/);
});

test('moving a temporary file never deletes the final saved index or meeting minutes', () => {
  reset();
  const row = recordings.rememberMeetingRecording(recording(12));
  assert.equal(files.has(indexUri), true, 'index must survive temporary cleanup');
  const doc = minutes.saveMeetingMinutes({
    recordingId: row.id, transcriptText: '실제 전사', minutesText: '회의록 보존', expectedPrevious: null,
  });
  assert.equal(minutes.loadMeetingMinutes(row.id).minutesText, '회의록 보존');
  assert.equal(files.has('file:///worklog/meeting-minutes-' + row.id + '.json'), true);
  assert.equal(recordings.listMeetingRecordings().length, 1);
  assert.ok(doc.updatedAt);
});
