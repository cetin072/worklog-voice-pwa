import { File, Paths } from 'expo-file-system';

import { assertMeetingRecordingId } from './meeting-minutes-document';
import type { MeetingRecordingEntry } from './meeting-recordings';
import type { MobileTranscriptV1 } from './transcription-provider';

/** Only successful STT text is checkpointed; original M4A and manual minutes stay separate. */
export type MeetingTranscriptCheckpointV1 = Readonly<{
  version: 1;
  recordingId: string;
  sourceUri: string;
  transcript: MobileTranscriptV1;
  savedAt: string;
}>;

const MAX_CHECKPOINT_BYTES = 8_000_000;

function transcriptFile(recordingId: string): File {
  return new File(Paths.document, 'meeting-transcript-' + assertMeetingRecordingId(recordingId) + '.json');
}

function parseCheckpoint(value: unknown, recording: MeetingRecordingEntry): MeetingTranscriptCheckpointV1 {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('저장된 회의 전사문 형식이 올바르지 않습니다.');
  }
  const row = value as Record<string, unknown>;
  const transcript = row.transcript as MobileTranscriptV1 | null;
  if (row.version !== 1 || row.recordingId !== recording.id ||
      row.sourceUri !== recording.uri ||
      typeof row.savedAt !== 'string' || !Number.isFinite(Date.parse(row.savedAt)) ||
      !transcript || transcript.schemaVersion !== 'v1' ||
      typeof transcript.text !== 'string' || !transcript.text.trim() ||
      transcript.text.length > 500_000 || !Array.isArray(transcript.segments) ||
      typeof transcript.provider !== 'string' ||
      !transcript.sourceAudioRef || typeof transcript.sourceAudioRef.localRef !== 'string') {
    throw new Error('전사문 내용 또는 원본 녹음 연결을 검증하지 못했습니다.');
  }
  return Object.freeze({
    version: 1 as const,
    recordingId: recording.id,
    sourceUri: recording.uri,
    transcript,
    savedAt: new Date(row.savedAt).toISOString(),
  });
}

export function loadMeetingTranscript(
  recording: MeetingRecordingEntry,
): MeetingTranscriptCheckpointV1 | null {
  const file = transcriptFile(recording.id);
  if (!file.exists) return null;
  try {
    if (typeof file.size === 'number' && file.size > MAX_CHECKPOINT_BYTES) {
      throw new Error('INVALID_CHECKPOINT_SIZE');
    }
    return parseCheckpoint(JSON.parse(file.textSync()), recording);
  } catch {
    throw new Error('기존 전사문을 읽지 못했습니다. 원본 파일은 보존하고 덮어쓰지 않습니다.');
  }
}

/**
 * First successfully saved transcript wins. This preserves the STT evidence;
 * later user edits belong in meeting-minutes, not this raw checkpoint.
 */
export function saveMeetingTranscript(
  recording: MeetingRecordingEntry,
  transcript: MobileTranscriptV1,
): MeetingTranscriptCheckpointV1 {
  const previous = loadMeetingTranscript(recording);
  if (previous) return previous;
  const checkpoint = parseCheckpoint({
    version: 1, recordingId: recording.id, sourceUri: recording.uri,
    transcript, savedAt: new Date().toISOString(),
  }, recording);
  const destination = transcriptFile(recording.id);
  const pending = new File(Paths.document,
    'meeting-transcript-' + recording.id + '.' + Date.now() + '.' +
    Math.floor(Math.random() * 1e9) + '.pending');
  let moved = false;
  try {
    const payload = JSON.stringify(checkpoint);
    if (payload.length * 3 > MAX_CHECKPOINT_BYTES) throw new Error('CHECKPOINT_TOO_LARGE');
    pending.create();
    pending.write(payload);
    const verified = parseCheckpoint(JSON.parse(pending.textSync()), recording);
    if (verified.transcript.text !== checkpoint.transcript.text ||
        pending.size > MAX_CHECKPOINT_BYTES) throw new Error('CHECKPOINT_VERIFY_FAILED');
    if (destination.exists) {
      // A concurrent writer may already have committed. Never overwrite its raw text.
      return loadMeetingTranscript(recording)!;
    }
    pending.moveSync(destination);
    // Expo moveSync mutates pending.uri; deleting it now would delete the final checkpoint.
    moved = true;
    const saved = loadMeetingTranscript(recording);
    if (!saved || saved.transcript.text !== checkpoint.transcript.text ||
        saved.savedAt !== checkpoint.savedAt) throw new Error('CHECKPOINT_COMMIT_FAILED');
    return saved;
  } catch {
    throw new Error('전사문 보관을 확인하지 못했습니다. 원본 회의 녹음은 보존됩니다.');
  } finally {
    if (!moved && pending.exists) {
      try { pending.delete(); } catch { /* Leave an uncommitted temp file. */ }
    }
  }
}
