import { captureScheduleInput } from '../../../../netlify/shared/capture-schedule-input.mjs';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import { saveWorklog, readWorklogDetails, updateWorklogDetails, deleteWorklog } from '@/src/platform/worklog-api';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { synchronizeSavedScheduleReminders, synchronizeEditedWorklogReminder, cancelSavedScheduleReminders } from '@/src/features/schedule/schedule-reminder-post-save';
import { reminderSessionEpoch } from '@/src/features/schedule/schedule-reminder-snapshot';
import { readOwnedReminderSnapshots } from '@/src/features/schedule/schedule-reminder-snapshot';
import { findWorklogReminder } from '@/src/features/schedule/worklog-reminder-adapter';
import { recognizeCapture } from './capture-ocr';
import { removeCaptureImage } from './capture-files';
import { createCaptureInbox, type CaptureEntry } from './capture-inbox';

export const captureInbox = createCaptureInbox(secureSessionStorage);
export const captureImportState = { galleryActive: false };
type CaptureChange = { owner: string; recordId: string; dueDate: string; cancelled?: boolean };
const captureListeners = new Map<(change: CaptureChange) => void, string | undefined>();
const pendingCaptureChanges = new Map<string, CaptureChange>();
/** Invalidate the existing Home read model; never inject a synthetic saved row. */
export const captureChanges = {
  subscribe(listener: (change: CaptureChange) => void, owner?: string) {
    captureListeners.set(listener, owner);
    const pending = owner ? pendingCaptureChanges.get(owner) : null;
    if (pending) { pendingCaptureChanges.delete(owner!); listener(pending); }
    return () => { captureListeners.delete(listener); };
  },
  publish(change: CaptureChange) {
    let delivered = false;
    for (const [listener, owner] of captureListeners) {
      if (owner && owner !== change.owner) continue;
      try { listener(change); if (owner === change.owner) delivered = true; } catch { /* UI refresh cannot turn a committed save into failure. */ }
    }
    if (!delivered) pendingCaptureChanges.set(change.owner, change);
  },
};
let tail: Promise<unknown> = Promise.resolve();
async function captureToken(client: PlatformSupabaseClient, owner: string | null) {
  if (!owner) throw new Error('CAPTURE_ACCOUNT_CHANGED');
  const token = await getFreshAccessToken(client);
  const user = await client.auth.getUser(token);
  if (user.error || user.data.user?.id !== owner) throw new Error('CAPTURE_ACCOUNT_CHANGED');
  return token;
}
export function processCapture(entry: CaptureEntry, client: PlatformSupabaseClient, owner: string) {
  const run = tail.then(async () => {
    const guard = reminderSessionEpoch.capture();
    const current = async () => { const auth = await client.auth.getUser(); if (!guard() || auth.error || auth.data.user?.id !== owner) throw new Error('CAPTURE_ACCOUNT_CHANGED'); };
    await current();
    // Re-read under the queue: double effect / rapid re-share cannot save twice.
    let latest = await captureInbox.get(entry.hash, owner);
    if (latest?.hash !== entry.hash) throw new Error('CAPTURE_NEWER_SHARE_PENDING');
    entry = latest;
    if (entry.undone) return entry;
    if (!entry.decision) {
      if (!entry.uri) throw new Error('CAPTURE_IMAGE_MISSING');
      const text = await recognizeCapture(entry.uri);
      entry = { ...entry, decision: captureScheduleInput(text) };
      await current(); await captureInbox.put(entry);
    }
    if (!entry.saved) {
      const decision = entry.decision!;
      await current();
      const result = await saveWorklog(await captureToken(client, owner), decision.transcript, { sourceType: 'capture', clientRequestId: entry.requestId, recordedAt: entry.recordedAt, status: decision.status, followUp: decision.followUp });
      const id = result.dataCoreWorkRecordId || result.pageId;
      if (!id) throw new Error('CAPTURE_SAVE_UNCONFIRMED');
      // Persist the receipt even if the account changed during the request.
      entry = { ...entry, saved: result }; await captureInbox.put(entry);
    }
    await current();
    // New review imports preserve their scanned appointment text. Keep the
    // existing date-neutral save contract, then use the owned edit API once.
    // The saved receipt survives failures; retry cannot insert a second record.
    if (entry.decision?.kind === 'review' && !entry.reviewContentApplied) {
      const token = await captureToken(client, owner);
      const recordId = entry.saved!.dataCoreWorkRecordId || entry.saved!.pageId!;
      const existing = await readWorklogDetails(token, recordId);
      await current();
      const scannedTitle = entry.decision.reviewContentTitle ? entry.decision.title : entry.decision.description.slice(0, 140);
      if (existing.title === '캡처 일정 확인 필요' && scannedTitle.trim()) {
        await updateWorklogDetails(token, { pageId: recordId, title: scannedTitle, dueDate: existing.dueDate, dueTime: existing.dueTime });
        entry = { ...entry, details: { title: scannedTitle, dueDate: existing.dueDate, dueTime: existing.dueTime } };
      } else entry = { ...entry, details: existing }; // Preserve any intervening user edit.
      entry = { ...entry, reviewContentApplied: true };
      await captureInbox.put(entry);
    }
    captureChanges.publish({ owner, recordId: entry.saved!.dataCoreWorkRecordId || entry.saved!.pageId!, dueDate: entry.details?.dueDate || entry.decision?.date || '' });
    // Storage success and reminder success are deliberately separate.
    const ids = entry.saved?.scheduleIds || (entry.saved?.scheduleId ? [entry.saved.scheduleId] : []);
    if (ids.length) {
      try {
        const canonical = await readOwnedReminderSnapshots(client, ids, guard);
        await synchronizeSavedScheduleReminders({ schedules: canonical.rows }, guard);
        entry = { ...entry, reminderWarning: undefined };
      } catch { entry = { ...entry, reminderWarning: '기록은 저장됐지만 알림 예약은 확인이 필요합니다.' }; }
      await captureInbox.put(entry);
    }
    try {
      const details = await readWorklogDetails(await captureToken(client, owner), entry.saved!.dataCoreWorkRecordId || entry.saved!.pageId!);
      entry = { ...entry, details }; await captureInbox.put(entry);
    } catch { /* A committed save remains successful if a detail refresh is offline. */ }
    await current();
    if (entry.uri) { await removeCaptureImage(entry.uri); entry = { ...entry, uri: undefined }; await captureInbox.put(entry); }
    return entry;
  });
  tail = run.catch(() => undefined); return run;
}
export async function editCapture(client: PlatformSupabaseClient, entry: CaptureEntry, input: { title: string; dueDate: string; dueTime: string }) {
  const guard = reminderSessionEpoch.capture();
  const recordId = entry.saved?.dataCoreWorkRecordId || entry.saved?.pageId;
  if (!recordId) throw new Error('CAPTURE_SAVE_UNCONFIRMED');
  const result = await updateWorklogDetails(await captureToken(client, entry.owner), { pageId: recordId, ...input });
  try {
    const outcome = await synchronizeEditedWorklogReminder(client, { recordId, schedule: result.schedule, dueDate: input.dueDate, dueTime: input.dueTime }, guard);
    const schedule = result.schedule || (outcome === 'created' ? await findWorklogReminder(client, { recordId, title: input.title }, guard) : null);
    return { ...result, schedule, scheduleCreated: schedule?.status === 'confirmed' };
  } finally {
    captureChanges.publish({ owner: entry.owner!, recordId, dueDate: input.dueDate });
  }
}
export async function undoCapture(client: PlatformSupabaseClient, entry: CaptureEntry) {
  const guard = reminderSessionEpoch.capture();
  const recordId = entry.saved?.dataCoreWorkRecordId || entry.saved?.pageId;
  if (!recordId) throw new Error('CAPTURE_SAVE_UNCONFIRMED');
  await captureToken(client, entry.owner);
  const result = await deleteWorklog(client, recordId);
  captureChanges.publish({ owner: entry.owner!, recordId, dueDate: '', cancelled: true });
  await cancelSavedScheduleReminders(result.cancelledScheduleIds, guard);
  const undone = { ...entry, undone: true }; await captureInbox.put(undone); return undone;
}
export { readWorklogDetails };
