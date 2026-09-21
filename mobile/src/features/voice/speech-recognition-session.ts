export type QuickVoiceRecognitionResult = Readonly<{
  isFinal: boolean;
  transcripts: readonly string[];
}>;

export type QuickVoiceRecognitionError = Readonly<{
  code: string;
  message: string;
}>;

export type QuickVoiceRecognitionStartOptions = Readonly<{
  locale: string;
  requiresOnDeviceRecognition: boolean;
}>;

export type QuickVoiceRecognitionPort = Readonly<{
  isRecognitionAvailable(): boolean;
  supportsOnDeviceRecognition(): boolean;
  getSupportedLocales(): Promise<Readonly<{ locales: readonly string[]; installedLocales: readonly string[] }>>;
  requestPermissions(): Promise<Readonly<{ granted: boolean }>>;
  start(options: QuickVoiceRecognitionStartOptions): void;
  stop(): void;
  abort(): void;
  subscribe(events: Readonly<{
    result(event: QuickVoiceRecognitionResult): void;
    error(error: QuickVoiceRecognitionError): void;
    end(): void;
  }>): () => void;
}>;

export type QuickVoiceRecognitionSnapshot = Readonly<{
  active: boolean;
  committedText: string;
  interimText: string;
  restartCount: number;
  onDevice: boolean;
}>;

export type QuickVoiceRecognitionSession = Readonly<{
  start(): Promise<void>;
  stop(): Promise<string>;
  cancel(): void;
  snapshot(): QuickVoiceRecognitionSnapshot;
  dispose(): void;
}>;

type SessionOptions = Readonly<{
  locale?: string;
  restartDelayMs?: number;
  maxConsecutiveRestarts?: number;
  onUpdate?(snapshot: QuickVoiceRecognitionSnapshot): void;
  onFatalError?(error: Error): void;
}>;

const FATAL_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'language-not-supported']);
const RECOVERABLE_ERRORS = new Set(['no-speech', 'speech-timeout', 'network', 'busy', 'client', 'unknown', 'interrupted', 'audio-capture']);

function clean(value: unknown) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

/** Adds only novel recognition text so repeated Android callbacks cannot duplicate a sentence. */
export function mergeRecognitionFinal(committed: string, incoming: string) {
  const before = clean(committed);
  const next = clean(incoming);
  if (!next || before === next || before.endsWith(next) || before.includes(next)) return before;
  if (next.startsWith(before)) return next;
  return clean(`${before} ${next}`);
}

function remainderAfterCommitted(committed: string, interim: string) {
  const before = clean(committed);
  const next = clean(interim);
  if (!next || next === before || before.endsWith(next)) return '';
  if (next.startsWith(before)) return clean(next.slice(before.length));
  return next;
}

export function createQuickVoiceRecognitionSession(port: QuickVoiceRecognitionPort, options: SessionOptions = {}): QuickVoiceRecognitionSession {
  const locale = options.locale || 'ko-KR';
  const restartDelayMs = options.restartDelayMs ?? 250;
  const maxConsecutiveRestarts = options.maxConsecutiveRestarts ?? 3;
  let active = false;
  let stopping = false;
  let disposed = false;
  let committedText = '';
  let interimText = '';
  let restartCount = 0;
  let onDevice = false;
  let restartTimer: ReturnType<typeof setTimeout> | null = null;
  let finish: ((text: string) => void) | null = null;
  let finishTimer: ReturnType<typeof setTimeout> | null = null;

  const snapshot = (): QuickVoiceRecognitionSnapshot => Object.freeze({ active, committedText, interimText, restartCount, onDevice });
  const publish = () => options.onUpdate?.(snapshot());
  const fatal = (message: string) => {
    active = false;
    interimText = '';
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = null;
    if (finishTimer) clearTimeout(finishTimer);
    finishTimer = null;
    const complete = finish;
    finish = null;
    complete?.(committedText);
    publish();
    options.onFatalError?.(new Error(message));
  };
  const restart = (reason: string) => {
    if (!active || stopping || disposed) return;
    if (restartTimer) return;
    if (restartCount >= maxConsecutiveRestarts) {
      fatal(`음성 인식을 다시 시작하지 못했습니다. (${reason})`);
      return;
    }
    restartCount += 1;
    publish();
    restartTimer = setTimeout(() => {
      restartTimer = null;
      if (!active || stopping || disposed) return;
      try { port.start({ locale, requiresOnDeviceRecognition: onDevice }); }
      catch (error) { fatal(error instanceof Error ? error.message : '음성 인식을 시작하지 못했습니다.'); }
    }, restartDelayMs);
  };

  const unsubscribe = port.subscribe({
    result(event) {
      const first = clean(event.transcripts[0]);
      if (!first || !active || disposed) return;
      if (event.isFinal) {
        const prior = committedText;
        committedText = mergeRecognitionFinal(committedText, first);
        interimText = '';
        if (committedText !== prior) restartCount = 0;
      } else {
        interimText = remainderAfterCommitted(committedText, first);
      }
      publish();
    },
    error(error) {
      if (!active || stopping || disposed || error.code === 'aborted') return;
      if (FATAL_ERRORS.has(error.code)) return fatal(error.message || '음성 인식을 사용할 수 없습니다.');
      if (RECOVERABLE_ERRORS.has(error.code)) restart(error.message || error.code);
      else fatal(error.message || '음성 인식 중 알 수 없는 오류가 발생했습니다.');
    },
    end() {
      if (stopping) {
        const complete = finish;
        finish = null;
        if (finishTimer) clearTimeout(finishTimer);
        finishTimer = null;
        complete?.(committedText);
        return;
      }
      restart('세션 종료');
    },
  });

  return Object.freeze({
    async start() {
      if (active || disposed) return;
      if (!port.isRecognitionAvailable()) throw new Error('이 기기에서 음성 인식을 사용할 수 없습니다.');
      const permission = await port.requestPermissions();
      if (!permission.granted) throw new Error('마이크 권한을 허용한 뒤 다시 시도해주세요.');
      const supported = await port.getSupportedLocales();
      const localeInstalled = supported.installedLocales.some((value) => value.toLowerCase() === locale.toLowerCase());
      onDevice = port.supportsOnDeviceRecognition() && localeInstalled;
      active = true;
      stopping = false;
      restartCount = 0;
      publish();
      try { port.start({ locale, requiresOnDeviceRecognition: onDevice }); }
      catch (error) { fatal(error instanceof Error ? error.message : '음성 인식을 시작하지 못했습니다.'); throw error; }
    },
    async stop() {
      if (!active) return committedText;
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      const finalText = await new Promise<string>((resolve) => {
        finish = resolve;
        finishTimer = setTimeout(() => {
          finishTimer = null;
          const complete = finish;
          finish = null;
          complete?.(committedText);
        }, 600);
        try { port.stop(); } catch { resolve(committedText); }
      });
      active = false;
      interimText = '';
      publish();
      return finalText;
    },
    cancel() {
      stopping = true;
      active = false;
      committedText = '';
      interimText = '';
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = null;
      const complete = finish;
      finish = null;
      complete?.('');
      try { port.abort(); } catch { /* Cancellation is best-effort. */ }
      publish();
    },
    snapshot,
    dispose() {
      disposed = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = null;
      unsubscribe();
    },
  });
}
