import { verifiedPublicRpc, type VerifiedRpcAccess } from '@/src/platform/verified-public-rpc';

export type ReportGrant = { author_name: string; can_read_all: boolean };
export type ReportDraft = {
  work_date: string;
  morning: boolean;
  afternoon: boolean;
  work_done: string;
  staff_notes: string;
  other_notes: string;
};
export type DailyReport = ReportDraft & {
  id: number;
  author_name: string;
  can_edit: boolean;
  revision: number;
};
export type ReportSchedule = { id: string; title: string; starts_at: string; all_day: boolean; updated_at: string };

export function dailyReportApi(access: VerifiedRpcAccess, fetchImpl: typeof fetch = fetch) {
  const request = <T>(name: string, body: Record<string, unknown>) =>
    verifiedPublicRpc<T>(access, name, body, {
      ownerChanged: 'DAILY_WORK_OWNER_CHANGED',
      unavailable: 'DAILY_WORK_UNAVAILABLE',
    }, fetchImpl);
  return {
    access: () => request<ReportGrant>('get_daily_work_report_access', {}),
    list: (page: number) => request<DailyReport[]>('search_daily_work_reports', {
      p_from: null, p_to: null, p_query: '', p_page: page,
    }),
    schedules: (date: string) => request<ReportSchedule[]>('list_daily_work_report_schedules', { p_date: date }),
    save: (draft: ReportDraft, revision: number, schedules: ReportSchedule[]) =>
      request<DailyReport>('save_daily_work_report_with_schedules', {
        p_date: draft.work_date,
        p_morning: draft.morning,
        p_afternoon: draft.afternoon,
        p_work: draft.work_done,
        p_staff: draft.staff_notes,
        p_other: draft.other_notes,
        p_revision: revision,
        p_schedules: schedules.map(({ id, updated_at }) => ({ id, updated_at })),
      }),
  };
}
export type DailyReportApi = ReturnType<typeof dailyReportApi>;

export function reportAccessLost(error: unknown) {
  const message = String(error);
  return !message.includes('CALENDAR_FORBIDDEN')
    && /DAILY_WORK_(FORBIDDEN|OWNER_CHANGED)|PGRST30[13]|(?:^|\s)42501\b/.test(message);
}

export function reportErrorMessage(error: unknown) {
  const message = String(error);
  if (/DAILY_WORK_CONFLICT/.test(message)) return '다른 화면에서 이 날짜의 일지를 저장했습니다. 입력을 유지했습니다. 목록에서 최신 일지를 확인해 주세요.';
  if (/DAILY_WORK_SCHEDULE_CHANGED/.test(message)) return '선택한 일정이 변경됐습니다. 일정을 다시 불러와 확인해 주세요.';
  if (/DAILY_WORK_INVALID/.test(message)) return '날짜와 근무 시간대, 내용 길이를 확인해 주세요. 각 내용란은 8,000자까지 저장할 수 있습니다.';
  return '연결을 확인한 뒤 다시 시도해 주세요.';
}
