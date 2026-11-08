import type { SaveWorklogOptions } from '@/src/platform/worklog-api';

export type ManualDraftValue = Readonly<{ transcript: string; dueDate: string; dueTime: string }>;
export type ManualSaveCheckpoint = Readonly<{
  signature: string;
  transcript: string;
  options: SaveWorklogOptions;
}>;
export type StoredManualDraft = Readonly<{
  version: 1;
  draft: ManualDraftValue;
  attempt: ManualSaveCheckpoint | null;
}>;
type Store = Readonly<{
  getItem(key: string): Promise<string | null>;
  updateItem(key: string, update: (previous: string | null) => string | null): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}>;
const PREFIX = 'worklog.manual.draft.v1.';
const MAX_TEXT = 120_000;

function checkedDate(date: string) {
  if (!date) return true;
  if (!/^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year && value.getUTCMonth() + 1 === month && value.getUTCDate() === day;
}

function normalizeDraft(value: unknown): ManualDraftValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('MANUAL_DRAFT_CORRUPT');
  const row = value as Record<string, unknown>;
  if (typeof row.transcript !== 'string' || row.transcript.length > MAX_TEXT ||
    typeof row.dueDate !== 'string' || typeof row.dueTime !== 'string' ||
    !checkedDate(row.dueDate) ||
    (row.dueTime && (!row.dueDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.dueTime)))) {
    throw Error('MANUAL_DRAFT_CORRUPT');
  }
  return { transcript: row.transcript, dueDate: row.dueDate, dueTime: row.dueTime };
}

export function manualDraftSignature(draft: ManualDraftValue) {
  return JSON.stringify([draft.transcript.trim(), draft.dueDate, draft.dueTime]);
}

function parse(raw: string | null): StoredManualDraft | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (value.version !== 1) throw Error('MANUAL_DRAFT_CORRUPT');
    const draft = normalizeDraft(value.draft);
    let attempt: ManualSaveCheckpoint | null = null;
    if (value.attempt !== null) {
      if (!value.attempt || typeof value.attempt !== 'object' || Array.isArray(value.attempt)) throw Error('MANUAL_DRAFT_CORRUPT');
      const old = value.attempt as Record<string, unknown>;
      const options = old.options as Record<string, unknown> | null;
      const id = options && typeof options.clientRequestId === 'string' ? options.clientRequestId : '';
      const at = options && typeof options.recordedAt === 'string' ? options.recordedAt : '';
      if (old.signature !== manualDraftSignature(draft) || old.transcript !== draft.transcript.trim() ||
        !/^mobile-manual-[A-Za-z0-9._-]{1,180}$/.test(id) ||
        !Number.isFinite(Date.parse(at)) || options?.dueDate !== draft.dueDate ||
        options?.dueTime !== draft.dueTime ||
        (draft.dueTime ? options?.type !== '회의·통화' : options?.type !== undefined)) {
        throw Error('MANUAL_DRAFT_CORRUPT');
      }
      attempt = { signature: String(old.signature), transcript: String(old.transcript), options: {
        clientRequestId: id, recordedAt: new Date(at).toISOString(),
        dueDate: draft.dueDate, dueTime: draft.dueTime,
        ...(draft.dueTime ? { type: '회의·통화' } : {}),
      } };
    }
    return { version: 1, draft, attempt };
  } catch {
    // Never replace an unknown or corrupted saved draft with an empty entry.
    throw Error('이 기기에 저장된 직접 입력 초안을 읽지 못했습니다. 기존 파일을 보존했습니다.');
  }
}

function keyFor(owner: string) {
  if (!/^[A-Za-z0-9._-]{1,120}$/.test(owner)) throw Error('MANUAL_DRAFT_OWNER_INVALID');
  return PREFIX + owner;
}

export function createManualWorkDraftStorage(store: Store, owner: string) {
  const key = keyFor(owner);
  return Object.freeze({
    async load(): Promise<StoredManualDraft | null> {
      return parse(await store.getItem(key));
    },
    async saveDraft(input: ManualDraftValue) {
      const draft = normalizeDraft(input);
      await store.updateItem(key, raw => {
        const previous = parse(raw);
        if (!draft.transcript && !draft.dueDate && !draft.dueTime) return null;
        const attempt = previous?.attempt?.signature === manualDraftSignature(draft)
          ? previous.attempt : null;
        return JSON.stringify({ version: 1, draft, attempt });
      });
    },
    async prepareSave(input: ManualDraftValue, checkpoint: ManualSaveCheckpoint) {
      const draft = normalizeDraft(input);
      if (!draft.transcript.trim() || checkpoint.signature !== manualDraftSignature(draft) ||
        checkpoint.transcript !== draft.transcript.trim()) throw Error('MANUAL_DRAFT_ATTEMPT_MISMATCH');
      // All saved request metadata is validated before it can be replayed.
      const encoded = JSON.stringify({ version: 1, draft, attempt: checkpoint });
      parse(encoded);
      await store.updateItem(key, raw => {
        parse(raw);
        return encoded;
      });
    },
    async clear() {
      await store.removeItem(key);
    },
  });
}
