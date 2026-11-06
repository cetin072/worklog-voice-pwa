import { File, Paths } from 'expo-file-system';

import type { MobileRecordingAudioInput } from './audio-input';

const INDEX_FILE_NAME = 'meeting-recordings-v1.json';


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

function indexFile() {
  return new File(Paths.document, INDEX_FILE_NAME);
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

function writeIndex(entries: readonly MeetingRecordingEntry[]) {
  // Validate a new index before replacing the old one. Never truncate older records.
  const target = indexFile();
  const pending = new File(Paths.document,
    `meeting-recordings-v1.${Date.now()}.${Math.floor(Math.random() * 1_000_000_000)}.pending`);
  try {
    const text = JSON.stringify({ version: 1, items: entries });
    pending.create();
    pending.write(text);
    const verified = JSON.parse(pending.textSync()) as { version: number; items: unknown[] };
    if (verified.version !== 1 || !Array.isArray(verified.items) ||
        verified.items.length !== entries.length) {
      throw new Error('INDEX_VERIFICATION_FAILED');
    }
    pending.moveSync(target, { overwrite: true });
  } catch {
    throw new Error('회의 녹음 목록을 저장하지 못했습니다. 기존 기록을 확인해주세요.');
  } finally {
    if (pending.exists) {
      try { pending.delete(); } catch { /* A failed temp cleanup never deletes a recording. */ }
    }
  }
}

function readIndexRaw(): MeetingRecordingEntry[] {
  const file = indexFile();
  if (!file.exists) return [];
  try {
    const parsed = JSON.parse(file.textSync()) as { version?: unknown; items?: unknown[] };
    if (parsed?.version !== 1 || !Array.isArray(parsed.items)) {
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
  // A temporarily unavailable audio file must not erase its title or linked minutes.
  return Object.freeze(readIndexRaw().sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt)));
}

export function isMeetingRecordingFileAvailable(recording: MeetingRecordingEntry): boolean {
  return fileExists(recording.uri);
}

export function rememberMeetingRecording(recording: MobileRecordingAudioInput) {
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
    title: '',
  } satisfies MeetingRecordingEntry);

  const existing = readIndexRaw().filter((entry) => entry.uri !== next.uri && entry.id !== next.id);
  const merged = [next, ...existing]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  writeIndex(merged);
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
