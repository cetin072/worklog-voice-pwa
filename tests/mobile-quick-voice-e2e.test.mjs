import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const card = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const flow = fs.readFileSync('mobile/src/features/voice/quick-voice-flow.ts', 'utf8');
const downloader = fs.readFileSync('mobile/src/features/voice/stt-model-download.ts', 'utf8');
const runtime = fs.readFileSync('mobile/src/features/voice/providers/whisper-rn-quick-voice-runtime.ts', 'utf8');
const draft = fs.readFileSync('mobile/src/features/voice/quick-voice-draft.ts', 'utf8');
const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');

test('Quick Voice source contract stays provider-neutral while separating capture, automatic save, and briefing refresh', () => {
  assert.match(card, /ensureProvider\(onProgress\?: .*Promise<MobileTranscriptionProvider>/);
  assert.match(card, /useQuickVoicePcmCapture/);
  assert.match(card, /transcribeQuickVoiceCapture/);
  assert.match(card, /createQuickVoiceSaveAttempt/);
  assert.match(card, /const saved = await saveAttempt\.current\.save\(\)/);
  assert.match(card, /브리핑 카드의 ✏️/);
  assert.match(card, /clientRequestId/);
  assert.doesNotMatch(card, /전사문을 확인한 뒤 저장하세요/);
  assert.doesNotMatch(card, /whisper\.rn|initWhisper|transcribeData/);
});

test('Quick Voice retries save with its retained transcript and retries briefing without writing again', () => {
  assert.match(flow, /QuickVoiceFlowError\('save'.*input\.transcript/);
  assert.match(card, /같은 업무 다시 저장/);
  assert.match(card, /브리핑만 다시 불러오기/);
  assert.match(card, /await quickVoice\.refreshBriefing\(\)/);
});

test('runtime model resolver preserves resumable partial downloads and promotes only SHA-256 verified files', () => {
  assert.match(downloader, /fetch\(input\.url/);
  assert.match(downloader, /Range: `bytes=\$\{resumeFrom\}-`/);
  assert.match(downloader, /\.partial/);
  assert.match(downloader, /IncrementalSha256/);
  assert.match(downloader, /readableStream\(\)\.getReader\(\)/);
  assert.match(downloader, /if \(finalFile\.exists\)/);
  assert.match(downloader, /actualHash === descriptor\.sha256/);
  assert.ok(
    downloader.indexOf('if (finalFile.exists)') < downloader.indexOf('Paths.availableDiskSpace'),
    'verified cached model is reused before checking download free space',
  );
  assert.match(downloader, /await verifiedDownload\.move\(finalFile\)/);
  assert.match(downloader, /Paths\.availableDiskSpace/);
  assert.match(runtime, /downloadBytes/);
  assert.match(runtime, /progressListeners/);
  assert.match(card, /음성 모델 받는 중/);
  assert.match(runtime, /huggingface\.co\/ggerganov\/whisper\.cpp/);
});


test('Quick Voice exposes device timing metrics for human benchmark without provider leakage', () => {
  assert.match(flow, /QuickVoiceFlowTimings/);
  assert.match(flow, /transcribeStartedAt = Date\.now\(\)/);
  assert.match(flow, /saveStartedAt = Date\.now\(\)/);
  assert.match(flow, /refreshStartedAt = Date\.now\(\)/);
  assert.match(card, /providerPrepareMs/);
  assert.match(card, /PCM \{quickAudio\.sampleRate\}Hz/);
  assert.match(card, /모델 \{formatMs\(providerPrepareMs\)\}/);
  assert.match(card, /전사 \{formatMs\(flowTimings\?\.transcribeMs/);
  assert.doesNotMatch(card, /whisper\.rn|initWhisper|transcribeData/);
});


test('Android digest streams large model bytes without whole-file allocation', () => {
  assert.match(downloader, /readableStream\(\)\.getReader\(\)/);
  assert.match(downloader, /reader\.read\(\)/);
  assert.match(downloader, /hasher\.update\(value\)/);
  assert.doesNotMatch(downloader, /file\.arrayBuffer\(\)|file\.bytes\(\)/);
});


test('Quick Voice accuracy checkpoint uses the larger multilingual base model outside the APK', () => {
  assert.match(runtime, /whisper\.cpp-base-multilingual/);
  assert.match(runtime, /ggml-base\.bin/);
  assert.match(runtime, /147_951_465/);
  assert.match(runtime, /60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe/);
  assert.doesNotMatch(runtime, /ggml-tiny\.bin/);
});


test('Quick Voice displays actual schedule creation truth instead of parser detection alone', () => {
  assert.match(card, /scheduleCreated/);
  assert.match(card, /일정 생성 완료/);
  assert.doesNotMatch(card, /quickSave\?\.scheduleDetected \? <Text style=\{styles\.scheduleSuccess\}/);
});

test('Quick Voice Stage 1 hardening persists recoverable drafts and clears them after confirmed save', () => {
  assert.match(card, /createQuickVoiceDraftStorage/);
  assert.match(card, /draftScope/);
  assert.match(card, /await draftStorage\(\)\?\.save/);
  assert.match(card, /await clearQuickVoiceDraft\(\)/);
  assert.match(card, /저장 전에 중단된 음성 기록을 복구했습니다/);
  assert.match(draft, /quick_voice_draft_v1_/);
  assert.match(home, /draftScope: session\.user\.id/);
  assert.doesNotMatch(home, /ANDROID_TOUCH_SMOKE_SESSION/);
});

test('Quick Voice starts microphone capture before any Whisper provider preparation and does not guard Home during pre-capture setup', () => {
  const startBegin = card.indexOf('async function startQuickVoice()');
  const startEnd = card.indexOf('async function retryQuickVoiceSave()', startBegin);
  const startBody = card.slice(startBegin, startEnd);
  assert.ok(startBegin >= 0 && startEnd > startBegin);
  assert.match(startBody, /await quickCapture\.start\(\)/);
  assert.doesNotMatch(startBody, /ensureProvider/);

  const transcribeBegin = card.indexOf('async function transcribeCapturedAudio(');
  const transcribeEnd = card.indexOf('function discardQuickVoice()', transcribeBegin);
  const transcribeBody = card.slice(transcribeBegin, transcribeEnd);
  assert.match(transcribeBody, /await quickVoice\.ensureProvider\(\(progress\) => setModelDownload\(progress\)\)/);
  assert.match(transcribeBody, /reportQuickVoiceDebug\('provider_prepare', 'started'\)/);

  assert.match(flow, /\['idle', 'preparing', 'saved', 'refresh_error'\]/);
  assert.match(card, /preparing: '녹음 준비 중'/);
  assert.match(card, /quickPhase === 'transcribing' && modelDownload/);
});

test('Quick Voice fallback can leave the guarded voice flow only after explicitly clearing it', () => {
  assert.match(card, /function openDirectInputFallback\(\)/);
  assert.match(card, /navigationGuard\.current = false/);
  assert.match(card, /onOpenWorklogInput\(\)/);
  assert.match(card, /title="업무 직접 입력" onPress=\{openDirectInputFallback\}/);
  assert.doesNotMatch(card, /save_error[^\n]*업무 직접 입력/s);
});

test('Quick Voice save success has immediate tactile feedback like the web fast-save flow', () => {
  assert.match(card, /Vibration\.vibrate\(120\)/);
  assert.match(card, /savedFeedback\(\)/);
});

test('briefing refreshes serialize instead of dropping a voice-triggered refresh while another load is busy', () => {
  assert.match(home, /briefingRefreshQueue/);
  assert.match(home, /briefingRefreshEpoch/);
  assert.match(home, /briefingRefreshQueue\.current\.run/);
  assert.doesNotMatch(home, /if \(!session \|\| briefingBusy\) return/);
});
