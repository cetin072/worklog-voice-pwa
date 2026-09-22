import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const card = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');

test('recording dock renders one guidance line instead of stacking helper and live speech text', () => {
  assert.match(card, /isRecording\s*\?\s*<Text numberOfLines=\{1\} ellipsizeMode="tail" style=\{styles\.quickGuidance\}>\{speechPreview \|\| guidance\}<\/Text>/);
  assert.doesNotMatch(card, /\{guidance \? <Text style=\{styles\.quickGuidance\}>\{guidance\}<\/Text> : null\}[\s\S]{0,180}\{isRecording && speechPreview/);
});

test('recording dock keeps cancel, stop, and live speech state behavior intact', () => {
  assert.match(card, /accessibilityLabel="녹음 취소"/);
  assert.match(card, /accessibilityLabel=\{isRecording \? '음성 기록 종료 후 바로 저장' : '음성 기록 시작'\}/);
  assert.match(card, /setSpeechPreview\(\[snapshot\.committedText, snapshot\.interimText\]/);
});
