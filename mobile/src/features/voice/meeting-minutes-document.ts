/**
 * Local meeting-minutes draft. Audio and automatic STT remain separate sources.
 * Nothing here interprets a meeting or fabricates decisions/action items.
 */
export type MeetingMinutesDocumentV1 = Readonly<{
  version: 1;
  recordingId: string;
  transcriptText: string;
  minutesText: string;
  createdAt: string;
  updatedAt: string;
}>;

const MAX_FIELD_LENGTH = 120_000;
const RECORDING_ID = /^meeting-[A-Za-z0-9._-]{1,130}$/;

export function assertMeetingRecordingId(value: string): string {
  if (!RECORDING_ID.test(value)) {
    throw new Error('회의 녹음 식별자를 확인할 수 없습니다.');
  }
  return value;
}

function checkedText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
    throw new Error(`${label}은 12만 자 이내의 텍스트여야 합니다.`);
  }
  return value.trim();
}

function validDate(value: unknown): string {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('회의록 저장 시각이 올바르지 않습니다.');
  }
  return new Date(value).toISOString();
}

export function createMeetingMinutesDocument(input: {
  recordingId: string;
  transcriptText: string;
  minutesText: string;
  previous?: MeetingMinutesDocumentV1 | null;
  now?: Date;
}): MeetingMinutesDocumentV1 {
  const recordingId = assertMeetingRecordingId(input.recordingId);
  const transcriptText = checkedText(input.transcriptText, '녹취문');
  const minutesText = checkedText(input.minutesText, '회의록');
  if (!transcriptText && !minutesText) {
    throw new Error('녹취문이나 회의록 내용을 입력해주세요.');
  }
  if (input.previous && input.previous.recordingId !== recordingId) {
    throw new Error('다른 녹음의 회의록을 덮어쓸 수 없습니다.');
  }
  const now = input.now ?? new Date();
  const updatedAt = validDate(now.toISOString());
  return Object.freeze({
    version: 1 as const,
    recordingId,
    transcriptText,
    minutesText,
    createdAt: input.previous?.createdAt ?? updatedAt,
    updatedAt,
  });
}

export function parseMeetingMinutesDocument(value: unknown, recordingId: string): MeetingMinutesDocumentV1 {
  assertMeetingRecordingId(recordingId);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('저장된 회의록 형식이 올바르지 않습니다.');
  }
  const row = value as Record<string, unknown>;
  if (row.version !== 1 || row.recordingId !== recordingId) {
    throw new Error('다른 녹음이거나 지원하지 않는 회의록입니다.');
  }
  const transcriptText = checkedText(row.transcriptText, '녹취문');
  const minutesText = checkedText(row.minutesText, '회의록');
  if (!transcriptText && !minutesText) {
    throw new Error('저장된 회의록에 내용이 없습니다.');
  }
  const createdAt = validDate(row.createdAt);
  const updatedAt = validDate(row.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw new Error('회의록 저장 시각이 서로 맞지 않습니다.');
  }
  return Object.freeze({
    version: 1 as const,
    recordingId,
    transcriptText,
    minutesText,
    createdAt,
    updatedAt,
  });
}

export function formatMeetingMinutesForShare(input: {
  document: MeetingMinutesDocumentV1;
  title: string;
  recordedAt: string;
}): string {
  const name = input.title.trim() || '회의 녹음';
  const recordedAt = new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(validDate(input.recordedAt)));
  const parts = [`회의록 — ${name}`, `녹음 일시: ${recordedAt}`];
  if (input.document.minutesText) parts.push('', '[회의록]', input.document.minutesText);
  if (input.document.transcriptText) parts.push('', '[녹취문 · 직접 입력]', input.document.transcriptText);
  return parts.join('\n');
}
