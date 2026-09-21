import assert from 'node:assert/strict';
import test from 'node:test';
import { register } from 'node:module';

register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const speech = await import('../mobile/src/features/voice/speech-recognition-session.ts');
const transcripts = await import('../mobile/src/features/voice/transcription-provider.ts');

function createPort({ available = true, onDevice = true, installedLocales = ['ko-KR'] } = {}) {
  let events;
  const starts = [];
  let stops = 0;
  return {
    starts,
    get stops() { return stops; },
    port: {
      isRecognitionAvailable: () => available,
      supportsOnDeviceRecognition: () => onDevice,
      getSupportedLocales: async () => ({ locales: ['ko-KR'], installedLocales }),
      requestPermissions: async () => ({ granted: true }),
      start: (options) => starts.push(options),
      stop: () => { stops += 1; events?.end(); },
      abort: () => undefined,
      subscribe: (next) => { events = next; return () => { events = undefined; }; },
    },
    result: (text, isFinal) => events.result({ isFinal, transcripts: [text] }),
    error: (code, message = code) => events.error({ code, message }),
    end: () => events.end(),
  };
}

async function session(options = {}, portOptions = {}) {
  const fake = createPort(portOptions);
  const updates = [];
  const fatals = [];
  const value = speech.createQuickVoiceRecognitionSession(fake.port, { restartDelayMs: 0, onUpdate: (snapshot) => updates.push(snapshot), onFatalError: (error) => fatals.push(error), ...options });
  await value.start();
  return { fake, value, updates, fatals };
}

test('normal Korean final result is committed once with Korean locale and eligible on-device mode', async () => {
  const { fake, value } = await session();
  assert.deepEqual(fake.starts[0], { locale: 'ko-KR', requiresOnDeviceRecognition: true });
  fake.result('내일 오전 10시부터 환경 정비 시작', true);
  assert.equal(value.snapshot().committedText, '내일 오전 10시부터 환경 정비 시작');
});

test('multiple final segments and interim replacement produce one natural sentence without duplication', async () => {
  const { fake, value } = await session();
  fake.result('내일', false);
  assert.equal(value.snapshot().interimText, '내일');
  fake.result('내일', true);
  fake.result('오전 10시부터', true);
  fake.result('환경 정비', false);
  fake.result('환경 정비 시작', true);
  fake.result('환경 정비 시작', true);
  assert.equal(value.snapshot().committedText, '내일 오전 10시부터 환경 정비 시작');
  assert.equal(value.snapshot().interimText, '');
});

test('a normal recognition end restarts and preserves text across the next session', async () => {
  const { fake, value } = await session();
  fake.result('내일 오전', true);
  fake.end();
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fake.starts.length, 2);
  fake.result('10시부터 환경 정비 시작', true);
  assert.equal(value.snapshot().committedText, '내일 오전 10시부터 환경 정비 시작');
});

test('silence only never becomes a canonical transcript and fatal errors do not loop', async () => {
  const { fake, value, fatals } = await session({ maxConsecutiveRestarts: 1 });
  fake.error('not-allowed', 'permission denied');
  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(fake.starts.length, 1);
  assert.equal(fatals.length, 1);
  assert.throws(() => transcripts.createLiveSpeechTranscript({ text: ' [S] [_BEG_] ', provider: 'android-speech-recognition', sourceRef: 'speech-recognition://test', createdAt: '2026-09-22T00:00:00Z', durationMs: 0 }));
  assert.equal(value.snapshot().committedText, '');
});

test('unavailable recognition fails before start so Quick Voice can use its existing Whisper fallback boundary', async () => {
  const fake = createPort({ available: false });
  const value = speech.createQuickVoiceRecognitionSession(fake.port);
  await assert.rejects(value.start(), /음성 인식을 사용할 수 없습니다/);
  assert.equal(fake.starts.length, 0);
});

test('on-device mode is not assumed when Korean is not installed', async () => {
  const { fake } = await session({}, { onDevice: true, installedLocales: [] });
  assert.equal(fake.starts[0].requiresOnDeviceRecognition, false);
});

test('locale capability lookup failure still starts the default Android recognition service', async () => {
  const fake = createPort();
  fake.port.getSupportedLocales = async () => { throw new Error('unsupported API'); };
  const value = speech.createQuickVoiceRecognitionSession(fake.port);
  await value.start();
  assert.deepEqual(fake.starts[0], { locale: 'ko-KR', requiresOnDeviceRecognition: false });
});
