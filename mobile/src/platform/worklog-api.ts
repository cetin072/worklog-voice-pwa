import { getApiBaseUrl } from './config';
import type { PlatformSupabaseClient } from './supabase';

export type BriefingTask = {
  pageId?: string;
  title?: string;
  institution?: string;
  status?: string;
  dueKey?: string;
  nextAttentionAt?: string;
  actionKind?: string;
  daysOverdue?: number;
  daysUntil?: number;
  followUp?: string;
  reason?: 'attention' | 'overdue' | 'today' | string;
};

export type BriefingNote = {
  pageId?: string;
  title?: string;
  institution?: string;
  journalDate?: string;
  recordedAt?: string;
  editedAt?: string;
};

export type BriefingSchedule = {
  scheduleId?: string;
  title?: string;
  startsAt?: string;
  dateKey?: string;
  allDay?: boolean;
  status?: string;
  location?: string;
};

export type MobileBriefing = {
  today?: string;
  generatedAt?: string;
  mode?: string;
  truncated?: boolean | null;
  completeness?: 'complete' | 'partial' | 'unknown';
  queryLimit?: number;
  filteredTaskCount?: number;
  counts?: Partial<Record<'overdue' | 'today' | 'upcoming' | 'undated' | 'total', number>>;
  structure?: Partial<Record<'overdue' | 'today' | 'upcoming' | 'undated', BriefingTask[]>>;
  resurface?: BriefingTask[];
  notes?: BriefingNote[];
  schedules?: { today?: BriefingSchedule[]; upcoming?: BriefingSchedule[]; total?: number };
  scheduleEnabled?: boolean;
};

export type NotificationPreferences = {
  morningEnabled: boolean;
  afternoonEnabled: boolean;
  detailEnabled: boolean;
  morningTime: '08:30';
  afternoonTime: '16:30';
  timezone: 'Asia/Seoul';
  connected: boolean;
};

export type WorkJournalRecord = {
  pageId?: string;
  title?: string;
  institution?: string;
  status?: string;
  followUp?: string;
  journalDate?: string;
  dueAt?: string;
  completedAt?: string;
  recordedAt?: string;
};

export type WorkJournalNote = {
  pageId?: string;
  title?: string;
  institution?: string;
  briefingState?: string;
  journalDate?: string;
  recordedAt?: string;
  editedAt?: string;
};

export type WorkJournalDay = {
  targetDate: string;
  today: string;
  schedules: BriefingSchedule[];
  completed: WorkJournalRecord[];
  notes: WorkJournalNote[];
  openTasks: WorkJournalRecord[];
};

export type WorkRecordSearchStatus = 'completed' | 'in_progress' | 'waiting' | 'needs_review';

export type WorkRecordSearchResult = {
  workRecordId: string;
  title: string;
  snippet: string;
  institution: string;
  status: WorkRecordSearchStatus | string;
  recordedAt?: string;
  dueAt?: string;
  matchType?: string;
};

export type WorkRecordSearchPage = {
  items: WorkRecordSearchResult[];
  nextOffset: number;
  hasMore: boolean;
};

const RECORD_SEARCH_PAGE_SIZE = 50;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function asText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Searches all work records through the existing RLS-protected Supabase RPC.
 * This deliberately does not filter the briefing payload: completed and older
 * records stay searchable, while workspace isolation remains in the database.
 */
export async function searchMyWorkRecords(
  client: PlatformSupabaseClient,
  query: string,
  sourceOffset = 0,
  statuses: readonly string[] = [],
): Promise<WorkRecordSearchPage> {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return { items: [], nextOffset: 0, hasMore: false };
  }
  if (normalizedQuery.length > 120) {
    throw new Error('검색어는 120자 이하로 입력해 주세요.');
  }

  const { data, error } = await client.rpc('search_my_work_records', {
    p_query: normalizedQuery,
    p_limit: RECORD_SEARCH_PAGE_SIZE,
    p_offset: Math.max(0, sourceOffset),
  });
  if (error) {
    throw new Error(error.message || '과거 업무 검색에 실패했습니다.');
  }

  const rows = Array.isArray(data) ? data : [];
  const selectedStatuses = new Set(statuses);
  const items = rows.flatMap((row): WorkRecordSearchResult[] => {
    const value = asRecord(row);
    const workRecordId = asText(value?.work_record_id);
    if (!value || !workRecordId) return [];

    const status = asText(value.status);
    if (status === 'cancelled') return [];
    if (selectedStatuses.size > 0 && !selectedStatuses.has(status)) return [];

    return [{
      workRecordId,
      title: asText(value.title) || '제목 없는 업무',
      snippet: asText(value.snippet),
      institution: asText(value.institution),
      status,
      recordedAt: asText(value.recorded_at) || undefined,
      dueAt: asText(value.due_at) || undefined,
      matchType: asText(value.match_type) || undefined,
    }];
  });

  return {
    items,
    nextOffset: Math.max(0, sourceOffset) + rows.length,
    hasMore: rows.length === RECORD_SEARCH_PAGE_SIZE,
  };
}

async function readJson(response: Response) {
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(String(body.error || `요청에 실패했습니다. (${response.status})`));
  }
  return body;
}

function requestId() {
  return `mobile-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export type SaveWorklogOptions = Readonly<{
  clientRequestId?: string;
  recordedAt?: string;
  sourceType?: 'direct' | 'voice';
  institution?: string;
  institutionSource?: 'user_selected' | 'user_confirmed';
  status?: string;
  type?: string;
  amount?: number | null;
  assignee?: string;
  dueDate?: string;
  followUp?: string;
}>;

export type SavedWorklog = Readonly<{
  pageId?: string;
  dataCoreWorkRecordId?: string;
  cleanTranscript?: string;
  scheduleDetected?: boolean;
  scheduleCreated?: boolean;
  scheduleId?: string;
  dueStart?: string;
  multiAction?: boolean;
  splitCount?: number;
  dataCoreWorkRecordIds?: string[];
  scheduleIds?: string[];
}>;

function normalizedRecordedAt(value?: string) {
  if (!value) return new Date().toISOString();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new Error('업무 기록 시각이 올바르지 않습니다.');
  }
  return date.toISOString();
}

export function parseMobileBriefing(body: Record<string, unknown>): MobileBriefing {
  const structure = asRecord(body.structure); const counts = asRecord(body.counts);
  const buckets = ['overdue', 'today', 'upcoming', 'undated'] as const;
  if (typeof body.today !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(body.today)
    || !structure || !counts || (body.notes !== undefined && !Array.isArray(body.notes))
    || (body.resurface !== undefined && !Array.isArray(body.resurface))
    || !buckets.every((key) => Array.isArray(structure[key])
      && typeof counts[key] === 'number' && Number.isFinite(counts[key]) && Number(counts[key]) >= 0)) {
    throw new Error('브리핑 응답을 확인하지 못했습니다. 기존 브리핑을 유지합니다. 다시 시도해주세요.');
  }
  return { ...body, resurface: Array.isArray(body.resurface) ? body.resurface : [] } as MobileBriefing;
}

export async function loadBriefing(accessToken: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/briefing-fast`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
  return parseMobileBriefing(await readJson(response));
}

export function parseWorkJournalDay(body: Record<string, unknown>): WorkJournalDay {
  const targetDate = asText(body.targetDate);
  const today = asText(body.today);
  const schedules = Array.isArray(body.schedules) ? body.schedules : null;
  const completed = Array.isArray(body.completed) ? body.completed : null;
  const notes = Array.isArray(body.notes) ? body.notes : null;
  const openTasks = Array.isArray(body.openTasks) ? body.openTasks : null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)
    || !/^\d{4}-\d{2}-\d{2}$/.test(today)
    || !schedules || !completed || !notes || !openTasks) {
    throw new Error('업무일지 응답을 확인하지 못했습니다.');
  }
  return {
    targetDate,
    today,
    schedules: schedules as BriefingSchedule[],
    completed: completed as WorkJournalRecord[],
    notes: notes as WorkJournalNote[],
    openTasks: openTasks as WorkJournalRecord[],
  };
}

export async function loadWorkJournalDay(accessToken: string, date: string): Promise<WorkJournalDay> {
  const target = date.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(target)) throw new Error('업무일지 날짜가 올바르지 않습니다.');
  const response = await fetch(`${getApiBaseUrl()}/api/work-journal?date=${encodeURIComponent(target)}`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
  });
  return parseWorkJournalDay(await readJson(response));
}

export async function saveWorklog(
  accessToken: string,
  transcript: string,
  options: SaveWorklogOptions = {},
): Promise<SavedWorklog> {
  const normalizedTranscript = transcript.trim();
  if (!normalizedTranscript) throw new Error('저장할 업무 원문이 없습니다.');

  const clientRequestId = options.clientRequestId?.trim() || requestId();
  if (clientRequestId.length > 200) {
    throw new Error('업무 저장 요청 ID가 너무 깁니다.');
  }

  const response = await fetch(`${getApiBaseUrl()}/api/worklog`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      transcript: normalizedTranscript,
      clientRequestId,
      recordedAt: normalizedRecordedAt(options.recordedAt),
      ...(options.sourceType ? { sourceType: options.sourceType } : {}),
      ...(options.institution ? { institution: options.institution.trim() } : {}),
      ...(options.institutionSource ? { institutionSource: options.institutionSource } : {}),
      ...(options.status ? { status: options.status.trim() } : {}),
      ...(options.type ? { type: options.type.trim() } : {}),
      ...(options.amount !== undefined ? { amount: options.amount } : {}),
      ...(options.assignee ? { assignee: options.assignee.trim() } : {}),
      ...(options.dueDate ? { dueDate: options.dueDate.trim() } : {}),
      ...(options.followUp ? { followUp: options.followUp.trim() } : {}),
    }),
  });
  return readJson(response) as Promise<SavedWorklog>;
}

/** Reuses the canonical worklog edit endpoint for post-transcription correction. */
export async function updateWorklogTitle(accessToken: string, recordId: string, title: string) {
  const normalizedRecordId = recordId.trim();
  const normalizedTitle = title.trim();
  if (!normalizedRecordId) throw new Error('수정할 업무 식별자가 없습니다.');
  if (!normalizedTitle) throw new Error('수정할 업무 원문이 없습니다.');

  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ pageId: normalizedRecordId, title: normalizedTitle }),
  });
  return readJson(response);
}

export async function updateWorklogStatus(accessToken: string, recordId: string, status: '완료' | '진행중' | '대기' | '확인필요') {
  const response = await fetch(`${getApiBaseUrl()}/api/briefing-v2`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recordId, status }),
  });
  return readJson(response);
}

export type WorklogDeleteResult = Readonly<{
  pageId: string;
  deleted: true;
  alreadyDeleted: boolean;
  cancelledScheduleIds: string[];
}>;

export async function deleteWorklog(client: PlatformSupabaseClient, pageId: string): Promise<WorklogDeleteResult> {
  const normalizedId = pageId.trim();
  if (!normalizedId) throw new Error('삭제할 업무 식별자가 없습니다.');
  const { data, error } = await client.rpc('cancel_my_work_record', { p_record_id: normalizedId });
  if (error) throw new Error(error.message || '업무를 삭제하지 못했습니다.');
  const rows = Array.isArray(data) ? data : data ? [data] : [];
  const row = rows[0] as Record<string, unknown> | undefined;
  if (!row || String(row.record_id || '') !== normalizedId || String(row.status_value || '') !== 'cancelled') {
    throw new Error('삭제할 업무를 찾지 못했거나 삭제 권한이 없습니다.');
  }
  return {
    pageId: normalizedId,
    deleted: true,
    alreadyDeleted: row.already_cancelled === true,
    cancelledScheduleIds: Array.isArray(row.cancelled_schedule_ids)
      ? row.cancelled_schedule_ids.map((value) => String(value || '').trim()).filter(Boolean)
      : [],
  };
}

export async function updateBriefingNoteState(
  accessToken: string,
  recordId: string,
  state: 'active' | 'acknowledged',
) {
  const response = await fetch(`${getApiBaseUrl()}/api/briefing-note`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ recordId, state }),
  });
  return readJson(response);
}


export type WorklogEditActionKind = 'task' | 'note';

export type WorklogEditDetails = {
  title: string;
  dueDate: string;
  dueTime: string;
  actionKind?: WorklogEditActionKind;
  actionConversionAllowed?: boolean;
  mode?: string;
};

export type WorklogUpdateResult = Readonly<{
  pageId?: string;
  title?: string;
  dueDate?: string;
  dueTime?: string;
  scheduleUpdated?: boolean;
  actionKind?: WorklogEditActionKind;
  actionKindChanged?: boolean;
  unchanged?: boolean;
  mode?: string;
}>;

export type WorklogReminderResult = Readonly<{
  pageId?: string;
  dueDate?: string;
  dueTime?: string;
  nextAttentionAt?: string | null;
  previousAttentionAt?: string | null;
  previousDueAt?: string | null;
  previousDueHasTime?: boolean;
  mode?: string;
}>;

export async function readWorklogDetails(accessToken: string, pageId: string): Promise<WorklogEditDetails> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ action: 'read', pageId }),
  });
  const body = await readJson(response);
  return {
    title: typeof body.title === 'string' ? body.title : '',
    dueDate: typeof body.dueDate === 'string' ? body.dueDate : '',
    dueTime: typeof body.dueTime === 'string' ? body.dueTime : '',
    actionKind: body.actionKind === 'task' || body.actionKind === 'note' ? body.actionKind : undefined,
    actionConversionAllowed: body.actionConversionAllowed === true,
    mode: typeof body.mode === 'string' ? body.mode : undefined,
  };
}

export async function updateWorklogDetails(
  accessToken: string,
  input: { pageId: string; title: string; dueDate: string; dueTime: string; actionKind?: WorklogEditActionKind },
): Promise<WorklogUpdateResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: 'update',
      pageId: input.pageId,
      title: input.title,
      dueDate: input.dueDate,
      dueTime: input.dueTime,
      ...(input.actionKind ? { actionKind: input.actionKind } : {}),
    }),
  });
  return readJson(response) as Promise<WorklogUpdateResult>;
}

function parseNotificationPreferences(body: Record<string, unknown>): NotificationPreferences {
  if (typeof body.morningEnabled !== 'boolean' || typeof body.afternoonEnabled !== 'boolean'
    || typeof body.detailEnabled !== 'boolean' || typeof body.connected !== 'boolean'
    || body.morningTime !== '08:30' || body.afternoonTime !== '16:30' || body.timezone !== 'Asia/Seoul') {
    throw new Error('서버 알림 상태를 확인하지 못했습니다. 다시 시도해주세요.');
  }
  return body as NotificationPreferences;
}

export async function loadNotificationPreferences(accessToken: string) {
  const response = await fetch(`${getApiBaseUrl()}/api/notification-preferences`, {
    method: 'GET',
    headers: { accept: 'application/json', authorization: `Bearer ${accessToken}` },
  });
  return parseNotificationPreferences(await readJson(response));
}

export async function updateNotificationPreferences(accessToken: string, patch: Pick<Partial<NotificationPreferences>, 'morningEnabled' | 'afternoonEnabled'>) {
  if (typeof patch.morningEnabled !== 'boolean' && typeof patch.afternoonEnabled !== 'boolean') {
    throw new Error('변경할 서버 알림 설정을 선택해주세요.');
  }
  const response = await fetch(`${getApiBaseUrl()}/api/notification-preferences`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify(patch),
  });
  return parseNotificationPreferences(await readJson(response));
}

export async function postponeWorklog(
  accessToken: string,
  input: { pageId: string; dueDate: string; dueTime: string },
): Promise<WorklogReminderResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'postpone', ...input }),
  });
  return readJson(response) as Promise<WorklogReminderResult>;
}

export async function undoPostponeWorklog(accessToken: string, pageId: string): Promise<WorklogReminderResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'undo_postpone', pageId }),
  });
  return readJson(response) as Promise<WorklogReminderResult>;
}

export async function setWorklogAttention(accessToken: string, pageId: string, nextAttentionAt: string | null): Promise<WorklogReminderResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'attention', pageId, nextAttentionAt }),
  });
  return readJson(response) as Promise<WorklogReminderResult>;
}
 
export async function undoWorklogAttention(
  accessToken: string,
  pageId: string,
  expectedAttentionAt: string | null,
  previousAttentionAt: string | null,
): Promise<WorklogReminderResult> {
  const response = await fetch(`${getApiBaseUrl()}/api/worklog-edit`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ action: 'undo_attention', pageId, expectedAttentionAt, previousAttentionAt }),
  });
  return readJson(response) as Promise<WorklogReminderResult>;
}
