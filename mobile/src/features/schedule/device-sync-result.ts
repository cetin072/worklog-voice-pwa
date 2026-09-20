export type DeviceSyncStatus = 'checking' | 'synced' | 'not-connected' | 'permission' | 'error';
export type DeviceSyncFeedback = { status: DeviceSyncStatus; message: string };
export type DeviceSyncResult = { reminders: DeviceSyncFeedback; calendar: DeviceSyncFeedback };
export const CHECKING_DEVICE_SYNC: DeviceSyncResult = {
  reminders: { status: 'checking', message: '알림 예약 확인 중' },
  calendar: { status: 'checking', message: '캘린더 반영 확인 중' },
};
function errorMessage(area: 'calendar' | 'reminders', error: unknown, fallback: string) {
  console.warn('[schedule-device-sync]', {
    area,
    detail: error instanceof Error ? error.message : 'unknown_error',
  });
  return fallback;
}
/** Independent outcomes: a successful database edit is NOT successful OS sync. */
export async function collectDeviceSyncResult(actions: {
  reminders(): Promise<{ failed: number }>;
  calendar(): Promise<{ updated: boolean; reason: string }>;
}): Promise<DeviceSyncResult> {
  const [reminders, calendar] = await Promise.allSettled([
    Promise.resolve().then(actions.reminders), Promise.resolve().then(actions.calendar),
  ]);
  return {
    reminders: reminders.status === 'rejected'
      ? { status: 'error', message: errorMessage('reminders', reminders.reason, '알림 예약을 확인하지 못했습니다. 다시 확인해주세요.') }
      : reminders.value.failed > 0
        ? { status: 'error', message: `알림 ${reminders.value.failed}개를 옮기거나 확인하지 못했습니다. 마지막 저장 시각을 확인하고 다시 시도해주세요.` }
        : { status: 'synced', message: '' },
    calendar: calendar.status === 'rejected'
      ? { status: 'error', message: errorMessage('calendar', calendar.reason, '캘린더 상태를 확인하지 못했습니다. 다시 확인해주세요.') }
      : calendar.value.updated
        ? { status: 'synced', message: '' }
        : calendar.value.reason === 'not-connected'
          ? { status: 'not-connected', message: '휴대폰 캘린더 미연결 · 업무수첩 일정은 유지됩니다.' }
          : calendar.value.reason === 'permission'
            ? { status: 'permission', message: '캘린더 권한이 없어 반영을 확인하지 못했습니다.' }
            : { status: 'error', message: '캘린더에 반영할 일정 정보를 확인해주세요.' },
  };
}
