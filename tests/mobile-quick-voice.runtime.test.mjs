import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const flow = await import('../mobile/src/features/voice/quick-voice-flow.ts');
const stt = await import('../mobile/src/features/voice/transcription-provider.ts');
const inputs = await import('../mobile/src/features/voice/audio-input.ts');
const audio = inputs.createQuickVoicePcmAudioInput({ localRef: 'memory://test', data: new ArrayBuffer(32000), sampleRate: 16000, channels: 1, durationMs: 1000, signal: { rms: 0.1, peak: 0.2, nonZeroRatio: 0.8 }, createdAt: '2026-09-19T01:00:00Z' });
function provider(text = '내일 오후 세 시에 계약서 확인') { return stt.createConfiguredMobileTranscriptionProvider({ provider: 'test', transcribe: async () => ({ text, model: 'fixture', language: 'ko' }) }); }
async function transcript() { return (await flow.transcribeQuickVoiceCapture({ provider: provider(), audio })).transcript; }
const defaults = (t, save) => ({ transcript: t, clientRequestId: 'same-id', recordedAt: audio.createdAt, saveWorklog: save, refreshBriefing: async () => undefined });

test('transcription remains pure and fast path auto-saves the accepted STT transcript', async () => {
  let writes = 0; let refreshes = 0; const p = provider();
  const draft = await flow.transcribeQuickVoiceCapture({ provider: p, audio });
  assert.ok(draft.transcript.text); assert.equal(writes, 0);
  const args = {
    provider: p,
    audio,
    clientRequestId: 'test-id',
    saveWorklog: async (text, options) => { writes++; return { id: options.clientRequestId, text }; },
    refreshBriefing: async () => { refreshes++; },
  };
  const result = await flow.runQuickVoiceFastPath(args);
  assert.equal(writes, 1);
  assert.equal(refreshes, 1);
  assert.equal(result.saveResult.id, 'test-id');
  assert.equal(result.saveResult.text, draft.transcript.text);
});
test('concurrent save retries send one immutable payload, completed attempts cannot save twice', async () => {
  const t = { ...(await transcript()) }; let writes = 0; let unblock; const gate = new Promise((r) => { unblock = r; });
  const args = defaults(t, async (text, options) => { writes++; await gate; return { id: options.clientRequestId, text }; });
  const attempt = flow.createQuickVoiceSaveAttempt(args);
  t.text = 'unexpected external edit'; args.clientRequestId = 'changed-id';
  const pending = [attempt.save(), attempt.save(), attempt.save()]; unblock();
  const results = await Promise.all(pending);
  assert.equal(writes, 1); assert.equal(results[0].saveResult.id, 'same-id'); assert.notEqual(results[0].saveResult.text, t.text);
  await attempt.save(); assert.equal(writes, 1);
});
test('uncertain save response retains the same accepted STT payload and id on retry', async () => {
  const t = { ...(await transcript()) }; const calls = []; let fail = true;
  const attempt = flow.createQuickVoiceSaveAttempt(defaults(t, async (text, opts) => { calls.push({ text, ...opts }); if (fail) { fail = false; throw new Error('response lost'); } return { id: 'existing' }; }));
  await assert.rejects(attempt.save(), (e) => e instanceof flow.QuickVoiceFlowError && e.stage === 'save' && e.transcript.text === attempt.text);
  t.text = 'must not alter the retry'; await attempt.save(); assert.deepEqual(calls[0], calls[1]);
});
test('briefing refresh failure is not a save failure and never triggers a second write', async () => {
  let writes = 0; const attempt = flow.createQuickVoiceSaveAttempt({ ...defaults(await transcript(), async () => { writes++; return { id: 'saved' }; }), refreshBriefing: async () => { throw new Error('refresh failed'); } });
  const result = await attempt.save(); assert.ok(result.briefingRefreshError); assert.equal(result.saveResult.id, 'saved');
  await attempt.save(); assert.equal(writes, 1);
});
test('empty and token-only transcripts cannot reach persistence; a legitimate sentence remains intact', async () => {
  for (const text of ['', '[S]', '[ Silence ] [_BEG_] [_TT_400] ♪']) await assert.rejects(flow.transcribeQuickVoiceCapture({ provider: provider(text), audio }));
  const real = '시청해주셔서 감사합니다'; assert.equal((await flow.transcribeQuickVoiceCapture({ provider: provider(real), audio })).transcript.text, real);
  let writes = 0; await assert.rejects(flow.saveQuickVoiceTranscript(defaults({ ...(await transcript()), text: ' ' }, async () => { writes++; }))); assert.equal(writes, 0);
});
test('screen navigation remains guarded only after audio exists or save/transcription needs attention', () => {
  for (const phase of ['recording', 'captured', 'transcribing', 'saving', 'save_error', 'transcript_error']) assert.equal(flow.quickVoiceNeedsAttention(phase), true);
  for (const phase of ['idle', 'preparing', 'saved', 'refresh_error']) assert.equal(flow.quickVoiceNeedsAttention(phase), false);
});
