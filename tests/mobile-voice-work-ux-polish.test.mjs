import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const voice = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const quickVoiceLayout = fs.readFileSync('mobile/src/features/voice/quick-voice-layout.ts', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const manual = fs.readFileSync('mobile/src/features/work/manual-work-input.tsx', 'utf8');
const sheet = fs.readFileSync('mobile/src/features/work/work-record-edit-sheet.tsx', 'utf8');
const search = fs.readFileSync('mobile/src/features/search/work-record-search.tsx', 'utf8');
const api = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');

test('Voice UX mirrors the strongest web recording affordances', () => {
  assert.match(voice, /QUICK_VOICE_LAYOUT\.micSize/);
  assert.match(quickVoiceLayout, /micSize: 128/);
  assert.doesNotMatch(voice, /marginTop: -28/);
  assert.match(voice, /accessibilityLabel="녹음 취소"/);
  assert.match(voice, /backgroundColor: '#b91c1c'/);
  assert.match(voice, /● 녹음 중 ·/);
  assert.match(voice, /recordingElapsedMs/);
  assert.match(voice, /quickMicTimer/);
  assert.match(voice, /말씀하세요\. 끝나면 빨간 버튼을 누르세요/);
  assert.match(voice, /음성을 글자로 바꾸는 중/);
  assert.match(voice, /업무수첩에 저장하는 중/);
  assert.match(voice, /브리핑에 반영하는 중/);
});

test('Home reserves enough real scroll space for the larger floating voice dock', () => {
  assert.match(home, /quickDockHeight \+ 32/);
  assert.match(home, /Math\.max\(220, Math\.ceil\(event\.nativeEvent\.layout\.height\)\)/);
});

test('Native direct input keeps the useful web manual fields instead of collapsing them to transcript only', () => {
  for (const label of ['기관', '상태', '유형', '금액', '담당자', '기한', '후속조치']) {
    assert.match(manual, new RegExp(label));
  }
  assert.match(home, /<ManualWorkInput/);
  assert.match(home, /institutionSource: 'user_selected'/);
  assert.match(home, /manualInput\.status/);
  assert.match(home, /manualInput\.type/);
  assert.match(home, /manualInput\.amount/);
  assert.match(api, /institutionSource\?: 'user_selected' \| 'user_confirmed'/);
  assert.match(api, /dueDate\?: string/);
  assert.match(api, /followUp\?: string/);
});

test('Stage 2 edit sheet adds native polish without losing the shared editing model', () => {
  assert.match(sheet, /useSafeAreaInsets/);
  assert.match(sheet, /dragHandle/);
  assert.match(sheet, /paddingBottom: 18 \+ insets\.bottom/);
  assert.match(sheet, /statusTone/);
  assert.match(sheet, /statusSuccess/);
  assert.match(sheet, /statusError/);
  assert.match(sheet, /✓ 저장 완료/);
  assert.match(sheet, /음성 원문은 그대로 보존됩니다/);
});

test('Briefing and search expose large one-tap edit actions and immediate post-save title feedback', () => {
  assert.match(home, /inlineEdit: \{ minHeight: 48, minWidth: 48/);
  assert.match(home, /updateVisibleTaskTitle/);
  assert.match(home, /✓ 업무를 수정했습니다/);
  assert.match(search, /editIconAction/);
  assert.match(search, /width: 48, height: 48/);
  assert.match(search, /setItems\(\(current\) => current\.map/);
  assert.match(search, /✓ 업무를 수정했습니다/);
});

test('Edit sheets remain dismissible while loading and block close only while saving', () => {
  assert.match(sheet, /if \(saving\) return/);
  assert.match(home, /function closeTaskEditor\(\)[\s\S]*if \(editBusy\) return/);
  assert.match(search, /function cancelEditor\(\)[\s\S]*if \(editBusy\) return/);
  assert.doesNotMatch(home, /function closeTaskEditor\(\)[\s\S]{0,120}editLoading/);
  assert.doesNotMatch(search, /function cancelEditor\(\)[\s\S]{0,120}editLoading/);
});
