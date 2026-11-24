import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';
const blobs = 'const store={get:async()=>null,setJSON:async()=>{}};export const getStore=()=>store;export const getDeployStore=()=>store;';
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: {
  '@netlify/blobs': `data:text/javascript,${encodeURIComponent(blobs)}`,
} } });
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

test('Quick Voice uses the spoken date and time for any title and respects explicit memo and deadline instructions', async () => {
  const { saveWorklog } = await import('../mobile/src/platform/worklog-api.ts');
  const { default: handler } = await import('../netlify/functions/worklog.mts');
  const previousFetch = globalThis.fetch, previousNetlify = globalThis.Netlify;
  globalThis.Netlify = { env: { get: key => ({ WORKLOG_DATA_CORE_PRIMARY_ENABLED: 'true', SUPABASE_URL: 'https://synthetic.invalid', SUPABASE_PUBLISHABLE_KEY: 'synthetic-key', WORKLOG_DATA_SCHEMA: 'worklog' })[key] } };
  const writes = [];
  const scheduleId = '55555555-5555-4555-8555-555555555555';
  globalThis.fetch = async (input, init) => {
    const url = new URL(input);
    if (url.pathname === '/api/worklog') return handler(new Request(url, init), {});
    if (url.pathname === '/api/record-normalize') return Response.json({}, { status: 202 });
    assert.equal(url.origin, 'https://synthetic.invalid');
    assert.equal(url.pathname, '/rest/v1/rpc/save_my_worklog_with_schedule_v2');
    const write = JSON.parse(init.body);
    writes.push(write);
    return Response.json([{
      user_id: '11111111-1111-4111-8111-111111111111', workspace_id: '22222222-2222-4222-8222-222222222222',
      work_record_id: '33333333-3333-4333-8333-333333333333', source_ref_id: '44444444-4444-4444-8444-444444444444',
      schedule_id: write.p_schedule_title ? scheduleId : null,
    }]);
  };
  try {
    const decemberAudio = { ...audio, createdAt: '2026-12-23T16:00:00Z' }; // 12월 24일 01:00 KST
    const cases = [
      ['답퍼 사전 답사 내일 오전 열시', 'schedule', '답퍼 사전 답사', '2026-12-25T10:00:00+09:00'],
      ['답퍼 사전 탑사 내일 오전 열 시', 'schedule', '답퍼 사전 탑사', '2026-12-25T10:00:00+09:00'],
      ['시제품 점검 내일 오전 10시', 'schedule', '시제품 점검', '2026-12-25T10:00:00+09:00'],
      ['시제품 점검 내일 10:00', 'schedule', '시제품 점검', '2026-12-25T10:00:00+09:00'],
      ['자료 정리하기 12월 25일 오전 열시', 'schedule', '자료 정리하기', '2026-12-25T10:00:00+09:00'],
      ['메모: 내일 오전 열시 담당자 미팅', 'note', null, '2026-12-25T10:00:00+09:00'],
      ['내일 오전 열시 자료 정리 할 일로 등록', 'task', null, '2026-12-25T10:00:00+09:00'],
      ['내일 저녁 일곱 시까지 답사 보고서 제출', 'task', null, '2026-12-25T19:00:00+09:00'],
      ['내일 저녁 일곱 시 사전 답사 관련 메모', 'note', null, '2026-12-25T19:00:00+09:00'],
      ['내일 오전 열시 사전 답사 취소', 'note', null, '2026-12-25T10:00:00+09:00'],
      ['내일 오전 열시 또는 오후 3시 사전 답사', 'note', null, null],
    ];
    for (const [text, kind, title, startsAt] of cases) {
      const saved = (await flow.runQuickVoiceFastPath({
        provider: provider(text), audio: decemberAudio, clientRequestId: `synthetic-voice-${writes.length}`,
        saveWorklog: (value, options) => saveWorklog('synthetic-token', value, { ...options, sourceType: 'voice' }),
        refreshBriefing: async () => {},
      })).saveResult;
      const write = writes.at(-1);
      assert.equal(write.p_metadata.actionEngine.kind, kind, text);
      assert.equal(write.p_original_text, text);
      assert.equal(write.p_schedule_title, title, text);
      assert.equal(write.p_schedule_starts_at, title ? startsAt : null, text);
      assert.equal(write.p_due_at, startsAt, text);
      assert.equal(saved.scheduleCreated, kind === 'schedule', text);
      assert.equal(saved.scheduleId, title ? scheduleId : '', text);
      assert.ok(saved.dataCoreWorkRecordId, text);
    }
    assert.equal(writes.length, cases.length);
  } finally {
    globalThis.fetch = previousFetch;
    globalThis.Netlify = previousNetlify;
  }
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
