import { File, Paths } from 'expo-file-system';

import type { MobileRecordingAudioInput } from './audio-input';

const INDEX_FILE_NAME = 'meeting-recordings-v1.json';
const MAX_RECORDINGS = 200;

export type MeetingRecordingEntry = Readonly<{
  id: string;
  uri: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
  sizeBytes: number | null;
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

  if (!id || !uri || !fileName || !mimeType || !createdAt || !Number.isFinite(durationMs) || durationMs < 0) {
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
  });
}

function writeIndex(entries: readonly MeetingRecordingEntry[]) {
  const file = indexFile();
  if (!file.exists) file.create({ overwrite: true });
  file.write(JSON.stringify({ version: 1, items: entries.slice(0, MAX_RECORDINGS) }));
}

function readIndexRaw(): MeetingRecordingEntry[] {
  const file = indexFile();
  if (!file.exists) return [];

  try {
    const parsed = JSON.parse(file.textSync()) as { items?: unknown[] };
    return Array.isArray(parsed?.items)
      ? parsed.items.flatMap((item) => {
          const entry = normalizedEntry(item);
          return entry ? [entry] : [];
        })
      : [];
  } catch {
    return [];
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
  const stored = readIndexRaw();
  const live = stored.filter((entry) => fileExists(entry.uri));
  const sorted = live.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  if (live.length !== stored.length) writeIndex(sorted);
  return Object.freeze(sorted);
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
  } satisfies MeetingRecordingEntry);

  const existing = readIndexRaw().filter((entry) => entry.uri !== next.uri && entry.id !== next.id);
  const merged = [next, ...existing]
    .filter((entry) => fileExists(entry.uri))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, MAX_RECORDINGS);
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

  const remaining = stored.filter((entry) => entry.id !== id && fileExists(entry.uri));
  writeIndex(remaining);
  return Boolean(target);
}
