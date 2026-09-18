import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const card = fs.readFileSync('mobile/src/features/voice/voice-recorder-card.tsx', 'utf8');
const flow = fs.readFileSync('mobile/src/features/voice/quick-voice-flow.ts', 'utf8');
const downloader = fs.readFileSync('mobile/src/features/voice/stt-model-download.ts', 'utf8');
const runtime = fs.readFileSync('mobile/src/features/voice/providers/whisper-rn-quick-voice-runtime.ts', 'utf8');

test('Quick Voice UI stays provider-neutral while executing capture, STT, canonical save, and briefing refresh', () => {
  assert.match(card, /ensureProvider\(onProgress\?: .*Promise<MobileTranscriptionProvider>/);
  assert.match(card, /useQuickVoicePcmCapture/);
  assert.match(card, /runQuickVoiceFastPath/);
  assert.match(card, /saveQuickVoiceTranscript/);
  assert.match(card, /clientRequestId/);
  assert.doesNotMatch(card, /whisper\.rn|initWhisper|transcribeData/);
});

test('Quick Voice retries save with its retained transcript and retries briefing without writing again', () => {
  assert.match(flow, /QuickVoiceFlowError\('save'.*input\.transcript/);
  assert.match(card, /같은 업무 다시 저장/);
  assert.match(card, /브리핑만 다시 불러오기/);
  assert.match(card, /await quickVoice\.refreshBriefing\(\)/);
});

test('runtime model resolver removes incomplete downloads and promotes only SHA-256 verified files', () => {
  assert.match(downloader, /File\.downloadFileAsync/);
  assert.match(downloader, /\.partial/);
  assert.match(downloader, /CryptoDigestAlgorithm\.SHA256/);
  assert.match(downloader, /if \(finalFile\.exists\)/);
  assert.match(downloader, /actualHash === descriptor\.sha256/);
  assert.ok(
    downloader.indexOf('if (finalFile.exists)') < downloader.indexOf('Paths.availableDiskSpace'),
    'verified cached model is reused before checking download free space',
  );
  assert.match(downloader, /await downloaded\.move\(finalFile\)/);
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


test('Android digest hashes model bytes through a TypedArray instead of a bare ArrayBuffer', () => {
  assert.match(downloader, /const bytes = new Uint8Array\(await file\.arrayBuffer\(\)\)/);
  assert.match(downloader, /Crypto\.digest\(Crypto\.CryptoDigestAlgorithm\.SHA256, bytes\)/);
  assert.doesNotMatch(downloader, /Crypto\.digest\(Crypto\.CryptoDigestAlgorithm\.SHA256, await file\.arrayBuffer\(\)\)/);
});
