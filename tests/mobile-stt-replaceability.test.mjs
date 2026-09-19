import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const registry = fs.readFileSync('mobile/src/features/voice/stt-provider-registry.ts', 'utf8');
const provider = fs.readFileSync('mobile/src/features/voice/transcription-provider.ts', 'utf8');
const model = fs.readFileSync('mobile/src/features/voice/stt-model.ts', 'utf8');
const flow = fs.readFileSync('mobile/src/features/voice/quick-voice-flow.ts', 'utf8');
const api = fs.readFileSync('mobile/src/platform/worklog-api.ts', 'utf8');

test('STT providers stay behind a generic registry and unregistered providers fail closed', () => {
  assert.match(registry, /MobileSttProviderRegistry/);
  assert.match(registry, /MobileSttProviderFactory/);
  assert.match(registry, /createMobileSttProviderRegistry/);
  assert.match(registry, /createUnconfiguredMobileTranscriptionProvider/);
  assert.match(registry, /provider identity/);
});

test('core STT contract and worklog API do not import concrete engines', () => {
  for (const source of [provider, flow, api]) {
    assert.doesNotMatch(source, /whisper\.rn|whisper\.cpp|sherpa|faster-whisper/i);
  }
});

test('model lifecycle is provider-neutral and checksum-gated', () => {
  assert.match(model, /SttModelDescriptor/);
  assert.match(model, /SttModelResolver/);
  assert.match(model, /ensureAvailable/);
  assert.match(model, /sha256/);
  assert.match(model, /\^\[a-f0-9\]\{64\}\$/);
  assert.match(model, /validateResolvedSttModel/);
});

test('Quick Voice fast path separates STT, save, and briefing refresh outcomes', () => {
  assert.match(flow, /runQuickVoiceFastPath/);
  assert.match(flow, /transcribeQuickVoice/);
  assert.match(flow, /clientRequestId/);
  assert.match(flow, /stage: QuickVoiceFlowStage/);
  assert.match(flow, /'transcribe' \| 'save'/);
  assert.match(flow, /briefingRefreshError/);
  assert.match(flow, /await input\.refreshBriefing\(\)/);
});

test('mobile saveWorklog accepts a retained idempotency key without breaking default callers', () => {
  assert.match(api, /SaveWorklogOptions/);
  assert.match(api, /clientRequestId\?: string/);
  assert.match(api, /options: SaveWorklogOptions = \{\}/);
  assert.match(api, /options\.clientRequestId\?\.trim\(\) \|\| requestId\(\)/);
  assert.match(api, /recordedAt: normalizedRecordedAt\(options\.recordedAt\)/);
});
