import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const draft = await import('../mobile/src/features/voice/quick-voice-draft.ts');

function transcript(text = '내일 오후 두 시 계약서 확인') {
  return {
    schemaVersion: 'v1',
    text,
    segments: [],
    language: 'ko',
    provider: 'test',
    model: 'fixture',
    providerRequestId: 'provider-request',
    durationMs: 1200,
    sourceAudioRef: { localRef: 'memory://quick-voice' },
    createdAt: '2026-09-19T06:00:00.000Z',
  };
}

function memoryStore() {
  const map = new Map();
  return {
    map,
    async getItem(key) { return map.get(key) ?? null; },
    async setItem(key, value) { map.set(key, value); },
    async removeItem(key) { map.delete(key); },
  };
}

test('Quick Voice draft round-trips the exact transcript and idempotency key', () => {
  const input = {
    version: 1,
    clientRequestId: 'mobile-quick-voice-1-abc',
    recordedAt: '2026-09-19T06:00:00Z',
    transcript: transcript(),
  };
  const decoded = draft.decodeQuickVoiceDraft(draft.encodeQuickVoiceDraft(input));
  assert.equal(decoded.clientRequestId, input.clientRequestId);
  assert.equal(decoded.recordedAt, '2026-09-19T06:00:00.000Z');
  assert.equal(decoded.transcript.text, input.transcript.text);
  assert.equal(decoded.transcript.sourceAudioRef.localRef, 'memory://quick-voice');
});

test('Quick Voice drafts are isolated by signed-in account scope and clear independently', async () => {
  const store = memoryStore();
  const a = draft.createQuickVoiceDraftStorage(store, 'user-a');
  const b = draft.createQuickVoiceDraftStorage(store, 'user-b');
  await a.save({ version: 1, clientRequestId: 'id-a', recordedAt: '2026-09-19T06:00:00Z', transcript: transcript('A 업무') });
  await b.save({ version: 1, clientRequestId: 'id-b', recordedAt: '2026-09-19T06:01:00Z', transcript: transcript('B 업무') });
  assert.equal((await a.load()).transcript.text, 'A 업무');
  assert.equal((await b.load()).transcript.text, 'B 업무');
  await a.clear();
  assert.equal(await a.load(), null);
  assert.equal((await b.load()).clientRequestId, 'id-b');
});

test('Quick Voice draft rejects invalid scope, empty transcript and malformed dates', async () => {
  assert.throws(() => draft.quickVoiceDraftKey('bad/scope'));
  assert.throws(() => draft.encodeQuickVoiceDraft({
    version: 1,
    clientRequestId: 'id',
    recordedAt: 'not-a-date',
    transcript: transcript(),
  }));
  assert.throws(() => draft.encodeQuickVoiceDraft({
    version: 1,
    clientRequestId: 'id',
    recordedAt: '2026-09-19T06:00:00Z',
    transcript: transcript('   '),
  }));
});
