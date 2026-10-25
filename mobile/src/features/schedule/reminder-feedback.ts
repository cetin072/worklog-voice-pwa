/** Device reservation feedback is separate from successful record/schedule storage. */
export function reminderFailureMessage(error: unknown): string {
  const seen = new Set<unknown>();
  const messages: string[] = [];
  function visit(value: unknown) {
    if (!value || seen.has(value)) return;
    seen.add(value);
    if (value instanceof Error) {
      messages.push(value.message);
      if (value instanceof AggregateError) value.errors.forEach(visit);
      visit(value.cause);
    } else if (typeof value === 'object' && 'message' in value) messages.push(String(value.message));
  }
  visit(error);
  const text = messages.join(' ');
  if (/exact|SCHEDULE_EXACT_ALARM|정확한/i.test(text)) return '기록은 저장됐지만 정확한 알람 권한이 필요합니다. 권한 설정 후 다시 시도해주세요.';
  if (/권한|permission/i.test(text)) return '기록은 저장됐지만 알림 권한이 필요합니다. 휴대폰 설정에서 허용한 뒤 다시 시도해주세요.';
  if (/INACTIVE/.test(text)) return '완료되거나 취소된 기록·일정에는 알림을 예약하지 않습니다.';
  if (/TIME_CONFLICT/.test(text)) return '이미 다른 시각의 일정이 있습니다. 닫았다가 다시 열어 확인해주세요.';
  if (/TIME_REQUIRED|시각|TIME_INVALID/.test(text)) return '알림을 예약하지 않았습니다. 미래의 날짜와 시간을 확인해주세요.';
  if (/PGRST202|function.*not find|schema cache/i.test(text)) return '기록은 저장됐습니다. 기록 알림 확인 기능은 서버 준비가 필요합니다.';
  if (/STALE|OWNER/.test(text)) return '계정 또는 일정이 변경됐습니다. 다시 열어 확인해주세요.';
  return '기록은 저장됐지만 기기 알림 예약을 확인하지 못했습니다. 연결과 권한을 확인한 뒤 다시 시도해주세요.';
}

export function confirmedSeoulInstant(date: string, time: string, now = Date.now()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('TIME_REQUIRED');
  const instant = `${date}T${time}:00+09:00`;
  const parsed = Date.parse(instant);
  if (!Number.isFinite(parsed) || parsed <= now || new Date(parsed + 9 * 3600000).toISOString().slice(0, 16) !== `${date}T${time}`) throw new Error('TIME_INVALID');
  return instant;
}

export function savedReminderMessage(results: readonly { action: string }[], expected: number) {
  const scheduled = results.filter((r) => r.action === 'scheduled').length;
  return expected > 0 && scheduled === expected
    ? `기록 저장 · 일정 ${expected}개 생성 · 이 기기 알림 예약 확인`
    : expected > 0 ? '기록 저장 · 일정 생성 · 기기 알림 예약 미확인. 알림 설정에서 다시 확인해주세요.'
      : '기록 저장 완료 · 일정/알림 미생성. 알림이 필요하면 날짜·시간을 확인해주세요.';
}
