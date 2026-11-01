import type { SavedWorklog } from '@/src/platform/worklog-api';
import type { CaptureDecision } from '../../../../netlify/shared/capture-schedule-input.mjs';

type CaptureDetails = { title: string; dueDate: string; dueTime: string };
export type CaptureEntry = {
  hash: string; uri?: string; owner: string | null; requestId: string; recordedAt: string;
  details?: CaptureDetails; restartDetails?: CaptureDetails; decision?: CaptureDecision; saved?: SavedWorklog; undone?: boolean; paused?: boolean; reminderWarning?: string; reviewContentApplied?: boolean;
};
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
/** Single serialized owner, encrypted backing store. No image bytes or full OCR in ledger. */
export function createCaptureInbox(storage: Storage, newRegistrationId?: () => string) {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const next = tail.then(fn); tail = next.catch(() => undefined); return next; };
  const key = 'worklog.capture.inbox.v1';
  async function read(): Promise<CaptureEntry[]> {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.some(x => !/^[a-f0-9]{64}$/.test(x.hash) || !new RegExp(`^capture-${x.hash}(?:-r(?:[1-9][0-9]{0,15}|[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}))?$`).test(x.requestId))) throw new Error('CAPTURE_INBOX_CORRUPT');
    return rows;
  }
  return {
    receive(image: { hash: string; uri: string }, owner: string | null): Promise<CaptureEntry> { return serial(async () => {
      const rows = await read();
      const old = rows.find(x => x.hash === image.hash && x.owner === owner);
      if (old) return old;
      // Retain dedupe tombstones; never silently evict an uncertain save.
      if (rows.length >= 300) throw new Error('CAPTURE_INBOX_FULL');
      const entry: CaptureEntry = { ...image, owner, requestId: `capture-${image.hash}`, recordedAt: new Date().toISOString() };
      await storage.setItem(key, JSON.stringify([...rows, entry])); return entry;
    }); },
    get(hash: string, owner: string | null) { return serial(async () => (await read()).find(x => x.hash === hash && x.owner === owner) || null); },
    pending(owner: string | null) { return serial(async () => (await read()).filter(x => x.owner === owner && !x.saved && !x.undone && !x.paused).at(-1) || null); },
    /** Explicit user action only. A re-share by itself retains the tombstone. */
    restart(hash: string, owner: string, expectedRequestId: string) { return serial(async () => {
      const rows = await read(); const index = rows.findIndex(x => x.hash === hash && x.owner === owner);
      if (index < 0) throw new Error('CAPTURE_ENTRY_MISSING');
      const old = rows[index];
      // Double taps and stale screens resume the current attempt, never start two.
      if (old.requestId !== expectedRequestId) return old;
      if (!old.undone || !old.saved || !old.decision) throw new Error('CAPTURE_NOT_CANCELLED');
      const nonce = newRegistrationId?.();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(nonce || '')) throw new Error('CAPTURE_REGISTRATION_ID_UNAVAILABLE');
      const restartDetails = old.details || { title: old.decision.title, dueDate: old.decision.date, dueTime: old.decision.time };
      const next: CaptureEntry = { hash, owner, uri: old.uri, requestId: `capture-${hash}-r${nonce}`, recordedAt: new Date().toISOString(),
        decision: { ...old.decision, transcript: '캡처 일정 확인 필요', status: '확인필요' }, restartDetails };
      rows[index] = next; await storage.setItem(key, JSON.stringify(rows)); return next;
    }); },
    put(entry: CaptureEntry) { return serial(async () => {
      const rows = await read(); const index = rows.findIndex(x => x.hash === entry.hash && x.owner === entry.owner);
      if (index < 0) throw new Error('CAPTURE_ENTRY_MISSING');
      if (rows[index].requestId !== entry.requestId) throw new Error('CAPTURE_REGISTRATION_CHANGED');
      rows[index] = entry; await storage.setItem(key, JSON.stringify(rows)); return entry;
    }); },
    claim(hash: string, owner: string) { return serial(async () => {
      const rows = await read(); const old = rows.find(x => x.hash === hash && x.owner === owner);
      if (old) { const anonymous = rows.findIndex(x => x.hash === hash && x.owner === null); if (anonymous >= 0) rows.splice(anonymous,1); await storage.setItem(key,JSON.stringify(rows)); return old; }
      const entry = rows.find(x => x.hash === hash && x.owner === null);
      if (!entry) throw new Error('CAPTURE_ENTRY_MISSING');
      entry.owner = owner; await storage.setItem(key,JSON.stringify(rows));return entry;
    }); },
  };
}
