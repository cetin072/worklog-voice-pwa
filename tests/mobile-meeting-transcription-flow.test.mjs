import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('mobile/src/features/voice/meeting-transcription-flow.ts', 'utf8');
const executable = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

test('Meeting transcription reuses common preprocessing and Transcript V1 boundaries', () => {
  assert.match(source, /transcribeMeetingRecording/);
  assert.match(source, /prepareRecordingForStt/);
  assert.match(source, /createPreparedAudioCheckpoint/);
  assert.match(source, /transcribeMobileAudio/);
  assert.match(source, /MobileTranscriptV1/);
});

test('Meeting transcription keeps preprocess and STT failures separate', () => {
  assert.match(source, /MeetingTranscriptionFlowError/);
  assert.match(source, /'preprocess' \| 'transcribe'/);
  assert.match(source, /new MeetingTranscriptionFlowError\(\s*'preprocess'/);
  assert.match(source, /new MeetingTranscriptionFlowError\(\s*'transcribe'/);
});

test('Meeting transcription measures preprocessing and transcription latency separately', () => {
  assert.match(source, /preprocessStartedAt = Date\.now\(\)/);
  assert.match(source, /transcribeStartedAt = Date\.now\(\)/);
  assert.match(source, /preprocessMs/);
  assert.match(source, /transcribeMs/);
});

test('Meeting transcription does not create worklogs, schedules, summaries or uploads', () => {
  assert.doesNotMatch(executable, /saveWorklog\s*\(|refreshBriefing\s*\(|scheduleId\s*[:=]|summarize\s*\(|upload\s*\(|fetch\s*\(/i);
});

test('Meeting transcription never deletes the source or prepared audio in the flow', () => {
  assert.doesNotMatch(executable, /\.delete\s*\(|\bremove\s*\(|\bunlink\s*\(/i);
});
