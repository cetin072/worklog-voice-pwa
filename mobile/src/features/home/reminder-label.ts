export type ReminderEvidence = {
  pending?: boolean;
  permission: 'granted' | 'denied' | 'undetermined';
  stored: { identifier: string; offsetMinutes: number; triggerAt: string; title: string }[];
  scheduled: { identifier: string; content: { body?: string | null; data?: Record<string, unknown> | null } }[];
};
/** Local settings + native reservation evidence, never a server flag or delivery guarantee. */
export function reminderLabel(scheduleId: string, evidence: ReminderEvidence | null, now = Date.now(), startsAt?: string) {
  if (!evidence || evidence.pending) return '알림 확인 필요';
  if (evidence.permission === 'denied') return '알림 권한 차단 · 설정';
  if (evidence.permission !== 'granted') return '알림 권한 미허용 · 설정';
  const owned = evidence.scheduled.filter(request => request.content.data?.target === 'schedule' && request.content.data.scheduleId === scheduleId);
  if (!evidence.stored.length) return owned.length ? '알림 확인 필요' : '이 기기 알림 없음 · 설정';
  const verified = evidence.stored.every(item => Date.parse(item.triggerAt) > now && (!startsAt || Date.parse(item.triggerAt) === Date.parse(startsAt) - item.offsetMinutes * 60_000) && owned.some(request => request.identifier === item.identifier && request.content.body === item.title && request.content.data?.offsetMinutes === item.offsetMinutes && request.content.data?.triggerAt === item.triggerAt));
  if (!verified) return '알림 설정 기록 있음 · 예약 확인 필요';
  const offsets = evidence.stored.map(item => item.offsetMinutes === 0 ? '시작 시' : item.offsetMinutes === 1440 ? '1일 전' : `${item.offsetMinutes}분 전`);
  return `이 기기 예약: ${offsets.join(' · ')}`;
}
