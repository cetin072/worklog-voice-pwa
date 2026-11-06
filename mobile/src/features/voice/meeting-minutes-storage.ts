import { File, Paths } from 'expo-file-system';

import {
  assertMeetingRecordingId,
  createMeetingMinutesDocument,
  parseMeetingMinutesDocument,
  type MeetingMinutesDocumentV1,
} from './meeting-minutes-document';

function meetingMinutesFile(recordingId: string) {
  return new File(Paths.document, `meeting-minutes-${assertMeetingRecordingId(recordingId)}.json`);
}

export function loadMeetingMinutes(recordingId: string): MeetingMinutesDocumentV1 | null {
  const file = meetingMinutesFile(recordingId);
  if (!file.exists) return null;
  try {
    // One recording's text only. Never decode a full audio file into JS memory.
    if (typeof file.size === 'number' && file.size > 1_000_000) {
      throw new Error('파일이 너무 큽니다.');
    }
    return parseMeetingMinutesDocument(JSON.parse(file.textSync()), recordingId);
  } catch {
    // A corrupt but existing local draft is NOT an empty draft: avoid overwriting it.
    throw new Error('저장된 회의록을 읽지 못했습니다. 기존 파일은 보존했습니다.');
  }
}

/** One caller-owned snapshot prevents stale editors from silently overwriting a newer draft. */
export function saveMeetingMinutes(input: {
  recordingId: string;
  transcriptText: string;
  minutesText: string;
  expectedPrevious: MeetingMinutesDocumentV1 | null;
}): MeetingMinutesDocumentV1 {
  // Read/validate the previous version before any write. A damaged draft
  // cannot be silently reset or overwritten.
  const previous = loadMeetingMinutes(input.recordingId);
  const expected = input.expectedPrevious;
  const unchanged = previous === null || expected === null
    ? previous === expected
    : previous.createdAt === expected.createdAt &&
      previous.updatedAt === expected.updatedAt &&
      previous.transcriptText === expected.transcriptText &&
      previous.minutesText === expected.minutesText;
  if (!unchanged) {
    throw new Error('회의록이 다른 화면에서 변경됐습니다. 입력을 보존했으니 다시 열어 확인해주세요.');
  }
  const document = createMeetingMinutesDocument({ ...input, previous });
  const target = meetingMinutesFile(input.recordingId);
  const temporary = new File(
    Paths.document,
    `meeting-minutes-${input.recordingId}.${Date.now()}.${Math.floor(Math.random() * 1_000_000_000)}.pending`,
  );
  let movedToTarget = false;
  try {
    temporary.create();
    const payload = JSON.stringify(document);
    temporary.writeSync(payload);
    const check = parseMeetingMinutesDocument(JSON.parse(temporary.textSync()), input.recordingId);
    if (check.transcriptText !== document.transcriptText || check.minutesText !== document.minutesText) {
      throw new Error('회의록 임시 저장 검증 실패');
    }
    // Same document storage, move only AFTER the new document was read back.
    temporary.moveSync(target, { overwrite: true });
    // moveSync changes temporary.uri to the final document path.
    movedToTarget = true;
    const saved = loadMeetingMinutes(input.recordingId);
    if (!saved || saved.updatedAt !== document.updatedAt ||
        saved.transcriptText !== document.transcriptText || saved.minutesText !== document.minutesText) {
      throw new Error('회의록 최종 저장 검증 실패');
    }
    return saved;
  } catch {
    throw new Error('회의록 저장을 확인하지 못했습니다. 입력은 현재 화면에 그대로 남아 있습니다.');
  } finally {
    // Never delete or modify the original M4A; only clean up our temp draft.
    if (!movedToTarget && temporary.exists) {
      try { temporary.delete(); } catch { /* Leave failed temp in private app storage. */ }
    }
  }
}

/** Check only private draft metadata; full text loads only when the editor opens. */
export function hasMeetingMinutes(recordingId: string): boolean {
  return meetingMinutesFile(recordingId).exists;
}
