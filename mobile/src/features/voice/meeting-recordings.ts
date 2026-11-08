import { requireMeetingOwner } from './meeting-owner';
import { File, Paths } from 'expo-file-system';

import type { MobileRecordingAudioInput } from './audio-input';




export type MeetingRecordingEntry = Readonly<{
  id: string;
  uri: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
  sizeBytes: number | null;
  title: string;
}>;

function indexFile(owner = requireMeetingOwner()) {
  return new File(Paths.document, `meeting-recordings-owned-${owner}.json`);
}

function normalizedDate(value: unknown) {
  if (typeof value !== 'string') return '';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function normalizedEntry(value: unknown): MeetingRecordingEntry | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === 'string' ? row.id.trim() : '';
  const uri = typeof row.uri === 'string' ? row.uri.trim() : '';
  const fileName = typeof row.fileName === 'string' ? row.fileName.trim() : '';
  const mimeType = typeof row.mimeType === 'string' ? row.mimeType.trim() : '';
  const createdAt = normalizedDate(row.createdAt);
  const durationMs = Number(row.durationMs);
  const sizeBytes = row.sizeBytes === null || row.sizeBytes === undefined ? null : Number(row.sizeBytes);
  const title = typeof row.title === 'string' ? row.title.trim().slice(0, 120) : '';

  if (!/^meeting-[A-Za-z0-9._-]{1,130}$/.test(id) || !uri || !fileName || !mimeType ||
      !createdAt || !Number.isFinite(durationMs) || durationMs < 0) {
    return null;
  }

  return Object.freeze({
    id,
    uri,
    fileName,
    mimeType,
    durationMs: Math.round(durationMs),
    createdAt,
    sizeBytes: sizeBytes !== null && Number.isFinite(sizeBytes) && sizeBytes >= 0 ? Math.round(sizeBytes) : null,
    title,
  });
}

function writeIndex(entries: readonly MeetingRecordingEntry[], owner = requireMeetingOwner()) {
  // Validate a new index before replacing the old one. Never truncate older records.
  const target = indexFile(owner);
  const pending = new File(Paths.document,
    `meeting-recordings-v1.${Date.now()}.${Math.floor(Math.random() * 1_000_000_000)}.pending`);
  let movedToTarget = false;
  try {
    const text = JSON.stringify({ version: 1, ownerUserId: owner, items: entries });
    pending.create();
    pending.write(text);
    const verified = JSON.parse(pending.textSync()) as { version: number; items: unknown[] };
    if (verified.version !== 1 || !Array.isArray(verified.items) ||
        verified.items.length !== entries.length) {
      throw new Error('INDEX_VERIFICATION_FAILED');
    }
    pending.moveSync(target, { overwrite: true });
    // Expo File.moveSync mutates pending.uri to the destination.
    // It is no longer a disposable temporary file after this point.
    movedToTarget = true;
    const committed = readIndexRaw(owner);
    if (committed.length !== entries.length || entries.some((row) =>
      !committed.some((saved) => saved.id === row.id && saved.uri === row.uri && saved.title === row.title))) {
      throw new Error('INDEX_COMMIT_VERIFICATION_FAILED');
    }
  } catch {
    throw new Error('회의 녹음 목록을 저장하지 못했습니다. 기존 기록을 확인해주세요.');
  } finally {
    if (!movedToTarget && pending.exists) {
      try { pending.delete(); } catch { /* Only an unmoved scratch file is safe to delete. */ }
    }
  }
}

function readIndexRaw(owner = requireMeetingOwner()): MeetingRecordingEntry[] {
  const file = indexFile(owner);
  if (!file.exists) return [];
  try {
    const parsed = JSON.parse(file.textSync()) as { version?: unknown; ownerUserId?: unknown; items?: unknown[] };
    if (parsed?.version !== 1 || parsed.ownerUserId !== owner || !Array.isArray(parsed.items)) {
      throw new Error('INVALID_MEETING_INDEX');
    }
    const entries = parsed.items.map((item) => normalizedEntry(item));
    if (entries.some((entry) => entry === null)) {
      throw new Error('INVALID_MEETING_INDEX_ROW');
    }
    return entries as MeetingRecordingEntry[];
  } catch {
    // Corrupt or unfamiliar data is not an empty list. Do not silently overwrite it.
    throw new Error('회의 녹음 목록을 읽지 못했습니다. 기존 목록 파일은 그대로 보존했습니다.');
  }
}

function fileSize(uri: string) {
  try {
    const file = new File(uri);
    return file.exists && typeof file.size === 'number' ? file.size : null;
  } catch {
    return null;
  }
}

function fileExists(uri: string) {
  try {
    return new File(uri).exists;
  } catch {
    return false;
  }
}

function entryId(recording: MobileRecordingAudioInput) {
  const stamp = recording.createdAt.replace(/[^0-9]/g, '').slice(0, 17);
  const safeFile = recording.fileName.replace(/[^a-zA-Z0-9._-]/g, '-').slice(-80);
  return `meeting-${stamp}-${safeFile}`;
}

export function listMeetingRecordings() {
  // An invalid index is an error; never treat it as a fresh empty history.
  const stored = readIndexRaw();
  // Never scan or attribute pre-existing unowned M4A/JSON files.
  return Object.freeze(stored.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export function isMeetingRecordingFileAvailable(recording: MeetingRecordingEntry): boolean {
  assertMeetingRecordingOwned(recording.id, recording.uri);
  return fileExists(recording.uri);
}

export function rememberMeetingRecording(recording: MobileRecordingAudioInput, owner = requireMeetingOwner()) {
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(owner)) throw Error('MEETING_OWNER_INVALID');
  if (!fileExists(recording.uri)) {
    throw new Error('저장된 회의 녹음 파일을 기기에서 확인하지 못했습니다.');
  }

  const next = Object.freeze({
    id: entryId(recording),
    uri: recording.uri,
    fileName: recording.fileName,
    mimeType: recording.mimeType,
    durationMs: recording.durationMs,
    createdAt: recording.createdAt,
    sizeBytes: fileSize(recording.uri),
    title: readIndexRaw(owner).find(entry => entry.uri === recording.uri)?.title || '',
  } satisfies MeetingRecordingEntry);

  const existing = readIndexRaw(owner).filter((entry) => entry.uri !== next.uri && entry.id !== next.id);
  const merged = [next, ...existing]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  writeIndex(merged, owner);
  if (!readIndexRaw(owner).some((entry) => entry.id === next.id && entry.uri === next.uri)) {
    throw new Error('녹음 목록 저장을 확인하지 못했습니다. 원본 녹음 파일은 보존합니다.');
  }
  return next;
}

export function deleteMeetingRecording(recordingId: string) {
  const id = recordingId.trim();
  if (!id) throw new Error('삭제할 회의 녹음 식별자가 없습니다.');

  const stored = readIndexRaw();
  const target = stored.find((entry) => entry.id === id);
  if (target) {
    try {
      const file = new File(target.uri);
      if (file.exists) file.delete();
    } catch {
      throw new Error('회의 녹음 파일을 삭제하지 못했습니다.');
    }
  }

  // Keep a discoverable entry when a separate, user-authored minutes file exists.
  const keepLinkedMinutes = target ? new File(Paths.document, `meeting-minutes-${target.id}.json`).exists : false;
  const remaining = stored.filter((entry) => entry.id !== id || keepLinkedMinutes);
  writeIndex(remaining);
  return Boolean(target);
}


export function renameMeetingRecording(recordingId: string, title: string) {
  const id = recordingId.trim();
  if (!id) throw new Error('이름을 바꿀 회의 녹음 식별자가 없습니다.');

  const normalizedTitle = title.replace(/\s+/g, ' ').trim();
  if (normalizedTitle.length > 120) {
    throw new Error('회의 녹음 이름은 120자 이하로 입력해주세요.');
  }

  const stored = readIndexRaw();
  const target = stored.find((entry) => entry.id === id);
  if (!target) throw new Error('이름을 바꿀 회의 녹음을 찾지 못했습니다.');

  const updated = stored.map((entry) => entry.id === id
    ? Object.freeze({ ...entry, title: normalizedTitle })
    : entry);
  writeIndex(updated);
  return updated.find((entry) => entry.id === id) || null;
}

/** Lightweight title/date search: only recording metadata, never full transcript files. */
export function searchMeetingRecordings(
  entries: readonly MeetingRecordingEntry[],
  query: string,
): readonly MeetingRecordingEntry[] {
  const term = query.trim().toLocaleLowerCase('ko-KR');
  if (!term) return entries;
  return entries.filter((entry) => {
    const localDate = new Intl.DateTimeFormat('ko-KR', {
      timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date(entry.createdAt));
    return [entry.title, entry.fileName, localDate, localDate.replace(/[^0-9]/g, '')]
      .some((value) => value.toLocaleLowerCase('ko-KR').includes(term));
  });
}

/** Every sensitive boundary re-resolves the row in the current account index. */
export function assertMeetingRecordingOwned(id: string, uri?: string) {
  requireMeetingOwner();
  const row = readIndexRaw().find(item => item.id === id && (!uri || item.uri === uri));
  if (!row) throw Error('이 계정에서 접근할 수 없는 녹음입니다. 원본은 보존했습니다.');
  return row;
}
