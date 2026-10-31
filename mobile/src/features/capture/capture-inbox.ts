import type { SavedWorklog } from '@/src/platform/worklog-api';
import type { CaptureDecision } from '../../../../netlify/shared/capture-schedule-input.mjs';

export type CaptureEntry = {
  hash: string; uri?: string; owner: string | null; requestId: string; recordedAt: string;
  details?: { title: string; dueDate: string; dueTime: string }; decision?: CaptureDecision; saved?: SavedWorklog; undone?: boolean; paused?: boolean; reminderWarning?: string;
};
type Storage = { getItem(key: string): Promise<string | null>; setItem(key: string, value: string): Promise<void> };
/** Single serialized owner, encrypted backing store. No image bytes or full OCR in ledger. */
export function createCaptureInbox(storage: Storage) {
  let tail: Promise<unknown> = Promise.resolve();
  const serial = <T,>(fn: () => Promise<T>): Promise<T> => { const next = tail.then(fn); tail = next.catch(() => undefined); return next; };
  const key = 'worklog.capture.inbox.v1';
  async function read(): Promise<CaptureEntry[]> {
    const raw = await storage.getItem(key);
    if (!raw) return [];
    const rows = JSON.parse(raw);
    if (!Array.isArray(rows) || rows.some(x => !/^[a-f0-9]{64}$/.test(x.hash) || !/^capture-[a-f0-9]{64}$/.test(x.requestId))) throw new Error('CAPTURE_INBOX_CORRUPT');
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
    put(entry: CaptureEntry) { return serial(async () => {
      const rows = await read(); const index = rows.findIndex(x => x.hash === entry.hash && x.owner === entry.owner);
      if (index < 0) throw new Error('CAPTURE_ENTRY_MISSING');
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
