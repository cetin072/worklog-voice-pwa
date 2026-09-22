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
  // Android services may send overlapping final chunks, for example
  // "내일 오전 10시" followed by "오전 10시부터 환경 정비 시작". Preserve the
  // shared suffix only once instead of treating it as a wholly new segment.
  for (let overlap = Math.min(before.length, next.length); overlap >= 2; overlap -= 1) {
    if (before.endsWith(next.slice(0, overlap))) return clean(`${before}${next.slice(overlap)}`);
  }
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
  let starting = false;
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
  // Some Android recognizers can end a user-requested stop without promoting the
  // last interim hypothesis to a final result. Only during explicit stop do we
  // preserve that visible interim text as a last-chance tail, merged through the
  // same de-duplication logic as normal final callbacks.
  const stoppingText = () => interimText ? mergeRecognitionFinal(committedText, interimText) : committedText;
  const fatal = (message: string) => {
    active = false;
    starting = false;
    stopping = false;
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
        complete?.(stoppingText());
        return;
      }
      restart('세션 종료');
    },
  });

  return Object.freeze({
    async start() {
      if (active || disposed || starting) return;
      starting = true;
      try {
        if (!port.isRecognitionAvailable()) throw new Error('이 기기에서 음성 인식을 사용할 수 없습니다.');
        const permission = await port.requestPermissions();
        if (disposed) return;
        if (!permission.granted) throw new Error('마이크 권한을 허용한 뒤 다시 시도해주세요.');
        const supportsOnDevice = port.supportsOnDeviceRecognition();
        let localeInstalled = false;
        if (supportsOnDevice) {
          try {
            const supported = await port.getSupportedLocales();
            localeInstalled = supported.installedLocales.some((value) => value.toLowerCase() === locale.toLowerCase());
          } catch {
            // Locale introspection is unavailable on some services/API levels.
            // Fall back to the normal Android recognizer instead of blocking dictation.
          }
        }
        if (disposed) return;
        onDevice = supportsOnDevice && localeInstalled;
        active = true;
        stopping = false;
        restartCount = 0;
        publish();
        try { port.start({ locale, requiresOnDeviceRecognition: onDevice }); }
        catch (error) { fatal(error instanceof Error ? error.message : '음성 인식을 시작하지 못했습니다.'); throw error; }
      } finally {
        starting = false;
      }
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
          complete?.(stoppingText());
        }, 600);
        try { port.stop(); }
        catch {
          if (finishTimer) clearTimeout(finishTimer);
          finishTimer = null;
          const complete = finish;
          finish = null;
          complete?.(stoppingText());
        }
      });
      active = false;
      stopping = false;
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
      if (disposed) return;
      disposed = true;
      const shouldAbort = active || stopping || starting;
      active = false;
      starting = false;
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      restartTimer = null;
      if (finishTimer) clearTimeout(finishTimer);
      finishTimer = null;
      const complete = finish;
      finish = null;
      complete?.(committedText);
      // A removed React screen must not leave the Android recognizer recording
      // without listeners. `disposed` is set first, so synchronous native events
      // cannot publish stale state while this cleanup runs.
      if (shouldAbort) {
        try { port.abort(); } catch { /* Best-effort native cleanup. */ }
      }
      unsubscribe();
    },
  });
}
