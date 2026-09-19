import type { MobileTranscriptV1 } from './transcription-provider';

export type QuickVoiceDraft = Readonly<{
  version: 1;
  clientRequestId: string;
  recordedAt: string;
  transcript: MobileTranscriptV1;
}>;

type StringStore = Readonly<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}>;

const PREFIX = 'quick_voice_draft_v1_';
const MAX_TRANSCRIPT_LENGTH = 500_000;

function validScope(scope: string) {
  const value = scope.trim();
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(value)) {
    throw new Error('Quick Voice draft scope가 올바르지 않습니다.');
  }
  return value;
}

export function quickVoiceDraftKey(scope: string) {
  return `${PREFIX}${validScope(scope)}`;
}

function parseDate(value: unknown, label: string) {
  const text = typeof value === 'string' ? value.trim() : '';
  const date = new Date(text);
  if (!text || !Number.isFinite(date.getTime())) {
    throw new Error(`${label}가 올바르지 않습니다.`);
  }
  return date.toISOString();
}

function parseTranscript(value: unknown): MobileTranscriptV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('복구할 전사문 형식이 올바르지 않습니다.');
  }
  const candidate = value as Partial<MobileTranscriptV1>;
  const text = typeof candidate.text === 'string' ? candidate.text.trim() : '';
  if (!text || text.length > MAX_TRANSCRIPT_LENGTH || candidate.schemaVersion !== 'v1') {
    throw new Error('복구할 전사문 내용이 올바르지 않습니다.');
  }
  if (!Array.isArray(candidate.segments)) {
    throw new Error('복구할 전사문 구간 정보가 올바르지 않습니다.');
  }
  const language = typeof candidate.language === 'string' ? candidate.language : '';
  const provider = typeof candidate.provider === 'string' ? candidate.provider : '';
  const model = typeof candidate.model === 'string' ? candidate.model : '';
  const providerRequestId = typeof candidate.providerRequestId === 'string' ? candidate.providerRequestId : '';
  const durationMs = Number(candidate.durationMs);
  const sourceAudioRef = candidate.sourceAudioRef;
  if (!language || !provider || !Number.isFinite(durationMs) || durationMs < 0
    || !sourceAudioRef || typeof sourceAudioRef.localRef !== 'string' || !sourceAudioRef.localRef.trim()) {
    throw new Error('복구할 전사문 메타데이터가 올바르지 않습니다.');
  }
  return {
    schemaVersion: 'v1',
    text,
    segments: candidate.segments,
    language,
    provider,
    model,
    providerRequestId,
    durationMs,
    sourceAudioRef: { localRef: sourceAudioRef.localRef.trim() },
    createdAt: parseDate(candidate.createdAt, 'transcript.createdAt'),
  };
}

export function encodeQuickVoiceDraft(draft: QuickVoiceDraft) {
  const clientRequestId = draft.clientRequestId.trim();
  if (!clientRequestId || clientRequestId.length > 200) {
    throw new Error('Quick Voice clientRequestId가 올바르지 않습니다.');
  }
  const normalized: QuickVoiceDraft = {
    version: 1,
    clientRequestId,
    recordedAt: parseDate(draft.recordedAt, 'recordedAt'),
    transcript: parseTranscript(draft.transcript),
  };
  return JSON.stringify(normalized);
}

export function decodeQuickVoiceDraft(raw: string): QuickVoiceDraft {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Quick Voice 임시 기록을 읽지 못했습니다.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Quick Voice 임시 기록 형식이 올바르지 않습니다.');
  }
  const candidate = parsed as Partial<QuickVoiceDraft>;
  if (candidate.version !== 1) {
    throw new Error('Quick Voice 임시 기록 버전을 확인하지 못했습니다.');
  }
  return {
    version: 1,
    clientRequestId: typeof candidate.clientRequestId === 'string' ? candidate.clientRequestId.trim() : '',
    recordedAt: parseDate(candidate.recordedAt, 'recordedAt'),
    transcript: parseTranscript(candidate.transcript),
  };
}

export function createQuickVoiceDraftStorage(store: StringStore, scope: string) {
  const key = quickVoiceDraftKey(scope);
  return Object.freeze({
    async load(): Promise<QuickVoiceDraft | null> {
      const raw = await store.getItem(key);
      if (raw === null) return null;
      const draft = decodeQuickVoiceDraft(raw);
      if (!draft.clientRequestId || draft.clientRequestId.length > 200) {
        throw new Error('Quick Voice 임시 기록의 요청 ID가 올바르지 않습니다.');
      }
      return draft;
    },
    save(draft: QuickVoiceDraft) {
      return store.setItem(key, encodeQuickVoiceDraft(draft));
    },
    clear() {
      return store.removeItem(key);
    },
  });
}
