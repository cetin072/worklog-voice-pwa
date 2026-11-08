import type { SaveWorklogOptions } from '../../platform/worklog-api';

type ManualDraft = Readonly<{ transcript: string; dueDate: string; dueTime: string }>;

/** One mounted account's direct-input retry state. Mirrors Quick Voice's immutable attempt,
 * without depending on its transcription/provider layer. A changed draft is a new intent.
 * This is in-memory recovery only; it does not survive an app restart.
 */
export function createManualWorkSaveSession<T>() {
  let current: {
    signature: string;
    transcript: string;
    options: SaveWorklogOptions;
    pending: Promise<T> | null;
    completed: { value: T } | null;
  } | null = null;

  return {
    save(draft: ManualDraft, persist: (text: string, options: SaveWorklogOptions) => Promise<T>): Promise<T> {
      const transcript = draft.transcript.trim();
      if (!transcript) return Promise.reject(new Error('저장할 업무 원문이 없습니다.'));
      const signature = JSON.stringify([transcript, draft.dueDate, draft.dueTime]);
      // A second tap must not start a different write while the first is unresolved.
      if (current?.pending) return current.pending;
      if (!current || current.signature !== signature) {
        current = {
          signature, transcript,
          options: Object.freeze({
            clientRequestId: `mobile-manual-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`,
            recordedAt: new Date().toISOString(),
            dueDate: draft.dueDate,
            dueTime: draft.dueTime,
            ...(draft.dueTime ? { type: '회의·통화' } : {}),
          }),
          pending: null, completed: null,
        };
      }
      const attempt = current;
      if (attempt.completed) return Promise.resolve(attempt.completed.value);
      attempt.pending = Promise.resolve().then(() => persist(attempt.transcript, attempt.options))
        .then((value) => { attempt.completed = { value }; return value; })
        .finally(() => { attempt.pending = null; });
      return attempt.pending;
    },
    reset() { current = null; },
  };
}
