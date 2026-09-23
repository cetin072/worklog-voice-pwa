import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import { listScheduleReminders, listTrackedReminderScheduleIds, requestScheduleNotificationPermission } from '@/src/features/schedule/local-notifications';
import { mobileTheme } from '@/src/ui/theme';

type PermissionState = 'checking' | 'allowed' | 'not-allowed' | 'error';

async function countLocalReminders() {
  const scheduleIds = await listTrackedReminderScheduleIds();
  const groups = await Promise.all(scheduleIds.map((scheduleId) => listScheduleReminders(scheduleId)));
  return groups.reduce((total, reminders) => total + reminders.length, 0);
}

export function ReminderSettings() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [permissionDetail, setPermissionDetail] = useState('알림 권한을 확인하고 있습니다.');
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setPermission('checking');
    setPermissionDetail('알림 권한을 확인하고 있습니다.');

    const [permissionResult, localResult] = await Promise.allSettled([
      Notifications.getPermissionsAsync(),
      countLocalReminders(),
    ]);

    if (permissionResult.status === 'fulfilled') {
      const result = permissionResult.value;
      setPermission(result.granted ? 'allowed' : 'not-allowed');
      setPermissionDetail(
        result.granted
          ? '시간이 있는 일정의 시작 알림을 예약할 수 있습니다.'
          : result.canAskAgain
            ? '권한을 허용하면 일정 시작 알림을 받을 수 있습니다.'
            : '휴대폰 설정에서 업무수첩 알림을 허용해주세요.',
      );
    } else {
      setPermission('error');
      setPermissionDetail('알림 권한 상태를 확인하지 못했습니다.');
    }

    setLocalCount(localResult.status === 'fulfilled' ? localResult.value : null);
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function requestPermission() {
    setBusy(true);
    try {
      await requestScheduleNotificationPermission();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return <View style={styles.root}>
    <View style={styles.section}>
      <Text style={styles.eyebrow}>알림</Text>
      <Text style={styles.heading}>앱 알림</Text>
      <Text style={[styles.status, permission === 'allowed' ? styles.statusOn : permission === 'error' ? styles.statusError : null]}>
        {permission === 'allowed' ? '✓ 권한 허용됨' : permission === 'checking' ? '확인 중' : permission === 'error' ? '확인 필요' : '권한 필요'}
      </Text>
      <Text style={styles.detail}>{permissionDetail}</Text>
      {permission !== 'allowed'
        ? <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => void requestPermission()}>
          <Text style={styles.actionText}>알림 권한 확인</Text>
        </Pressable>
        : null}
    </View>

    <View style={styles.section}>
      <Text style={styles.heading}>일정 알림</Text>
      <Text style={styles.detail}>시간이 있는 일정은 시작 시각에 한 번 알려드립니다.</Text>
      <Text style={styles.status}>
        {localCount === null ? '예약 상태 확인 중' : localCount ? `예약된 일정 알림 ${localCount}개` : '예약된 일정 알림 없음'}
      </Text>
      <Pressable accessibilityRole="button" disabled={busy} style={styles.secondaryAction} onPress={() => void refresh()}>
        <Text style={styles.secondaryActionText}>상태 다시 확인</Text>
      </Pressable>
      <Pressable accessibilityRole="button" style={styles.secondaryAction} onPress={() => void Linking.openSettings()}>
        <Text style={styles.secondaryActionText}>휴대폰 알림 설정 열기</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 14 },
  section: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: mobileTheme.colors.textMuted },
  heading: { fontSize: 16, fontWeight: '800', color: mobileTheme.colors.text },
  detail: { fontSize: 12, lineHeight: 18, color: mobileTheme.colors.textSecondary },
  status: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.textSecondary },
  statusOn: { color: mobileTheme.colors.success },
  statusError: { color: mobileTheme.colors.danger },
  action: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#111827', paddingHorizontal: 12 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  secondaryAction: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: mobileTheme.colors.border, paddingHorizontal: 12 },
  secondaryActionText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' },
});
