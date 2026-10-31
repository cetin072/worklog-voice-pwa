import { captureScheduleInput } from '../../../../netlify/shared/capture-schedule-input.mjs';
import { secureSessionStorage } from '@/src/platform/secure-storage';
import { saveWorklog, readWorklogDetails, updateWorklogDetails, deleteWorklog } from '@/src/platform/worklog-api';
import { getFreshAccessToken } from '@/src/platform/authenticated-access';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { synchronizeSavedScheduleReminders, synchronizeEditedWorklogReminder, cancelSavedScheduleReminders } from '@/src/features/schedule/schedule-reminder-post-save';
import { reminderSessionEpoch } from '@/src/features/schedule/schedule-reminder-snapshot';
import { readOwnedReminderSnapshots } from '@/src/features/schedule/schedule-reminder-snapshot';
import { recognizeCapture } from './capture-ocr';
import { removeCaptureImage } from './capture-files';
import { createCaptureInbox, type CaptureEntry } from './capture-inbox';

export const captureInbox = createCaptureInbox(secureSessionStorage);
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
  await synchronizeEditedWorklogReminder(client, { recordId, schedule: result.schedule, dueDate: input.dueDate, dueTime: input.dueTime }, guard);
  return result;
}
export async function undoCapture(client: PlatformSupabaseClient, entry: CaptureEntry) {
  const guard = reminderSessionEpoch.capture();
  const recordId = entry.saved?.dataCoreWorkRecordId || entry.saved?.pageId;
  if (!recordId) throw new Error('CAPTURE_SAVE_UNCONFIRMED');
  await captureToken(client, entry.owner);
  const result = await deleteWorklog(client, recordId);
  await cancelSavedScheduleReminders(result.cancelledScheduleIds, guard);
  const undone = { ...entry, undone: true }; await captureInbox.put(undone); return undone;
}
export { readWorklogDetails };
