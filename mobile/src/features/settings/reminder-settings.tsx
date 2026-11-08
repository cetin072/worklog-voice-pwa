import { useEffect, useState } from 'react';
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import {
  getScheduleReminderStatus,
  openExactAlarmPermissionSettings,
  reconcileScheduleReminders,
  requestScheduleNotificationPermission,
} from '@/src/features/schedule/local-notifications';
import { mobileTheme } from '@/src/ui/theme';

type PermissionState = 'checking' | 'allowed' | 'not-allowed' | 'error';
type ReminderStatus = { scheduled: number; pending: number; cleanupPending: number; unverified: number };

export function ReminderSettings() {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [permissionDetail, setPermissionDetail] = useState('알림 권한을 확인하고 있습니다.');
  const [reminders, setReminders] = useState<ReminderStatus | null>(null);
  const [reminderError, setReminderError] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setPermission('checking');
    setPermissionDetail('알림 권한을 확인하고 있습니다.');
    setReminderError(false);

    const [permissionResult, reminderResult] = await Promise.allSettled([
      Notifications.getPermissionsAsync(),
      getScheduleReminderStatus(),
    ]);

    if (permissionResult.status === 'fulfilled') {
      const result = permissionResult.value;
      setPermission(result.granted ? 'allowed' : 'not-allowed');
      setPermissionDetail(
        result.granted
          ? '시간이 있는 일정의 시작 알림을 받을 수 있습니다.'
          : result.canAskAgain
            ? '권한을 허용하면 일정 시작 알림을 받을 수 있습니다.'
            : '휴대폰 설정에서 업무수첩 알림을 허용해주세요.',
      );
    } else {
      setPermission('error');
      setPermissionDetail('알림 권한 상태를 확인하지 못했습니다.');
    }

    setReminders(reminderResult.status === 'fulfilled' ? reminderResult.value : null);
    setReminderError(reminderResult.status === 'rejected');
  }

  useEffect(() => {
    void refresh();
  }, []);

  async function requestPermission() {
    setBusy(true);
    try {
      await requestScheduleNotificationPermission();
      await refresh();
    } catch {
      setPermission('error');
      setPermissionDetail('알림 권한 요청을 마치지 못했습니다. 휴대폰 설정에서 확인하거나 다시 시도해주세요.');
    } finally {
      setBusy(false);
    }
  }

  async function openExactAlarmAccess() {
    setBusy(true);
    try {
      await openExactAlarmPermissionSettings();
      await reconcileScheduleReminders().catch(() => undefined);
      await refresh();
    } catch {
      setPermissionDetail('알람 설정 화면을 열지 못했습니다. 휴대폰 설정에서 확인해주세요.');
    } finally {
      setBusy(false);
    }
  }

  const scheduled = reminders?.scheduled ?? null;
  const pending = reminders?.pending ?? 0;
  const unverified = reminders?.unverified ?? 0;
  const cleanupPending = reminders?.cleanupPending ?? 0;
  const needsExactAlarmAccess = Platform.OS === 'android' && Number(Platform.Version) >= 31 && permission === 'allowed' && pending > 0;

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
        {reminderError ? '알림 예약 상태를 확인하지 못했습니다' : scheduled === null ? '예약 상태 확인 중' : scheduled ? `휴대폰 예약 확인 ${scheduled}개` : pending ? `예약 대기 중 ${pending}개` : unverified ? `알림 확인 필요 ${unverified}개` : '예약된 일정 알림 없음'}
      </Text>
      {scheduled === 0 && pending === 0 && unverified === 0 && cleanupPending === 0 ? <Text style={styles.detail}>날짜와 시작 시각이 확정된 미래 일정이 저장되면 자동으로 시작 알림을 예약합니다. 기록만 저장하거나 시간이 빠진 경우에는 알림이 생성되지 않습니다.</Text> : null}
      {scheduled !== null && scheduled > 0 && pending > 0 ? <Text style={styles.detail}>추가 알림 {pending}개는 아직 예약 대기 중입니다.</Text> : null}
      {unverified > 0 ? <Text style={styles.warningTitle}>저장된 알림 {unverified}개는 휴대폰 예약이 확인되지 않았습니다. 앱을 다시 열어 알림 복구를 확인해주세요.</Text> : null}
      {cleanupPending > 0 ? <Text style={styles.detail}>취소한 일정의 알림 정리 {cleanupPending}개가 대기 중입니다. 앱을 다시 열면 정리를 다시 시도합니다.</Text> : null}
      {needsExactAlarmAccess ? <View style={styles.warning}>
        <Text style={styles.warningTitle}>정확한 일정 알림 권한 확인</Text>
        <Text style={styles.detail}>예약 대기 중인 알림이 있습니다. Android의 ‘알람 및 리마인더’ 권한을 확인한 뒤 상태를 다시 확인해주세요.</Text>
        <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => void openExactAlarmAccess()}>
          <Text style={styles.actionText}>정확한 일정 알림 허용</Text>
        </Pressable>
      </View> : null}
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
  warning: { gap: 8, padding: 12, borderRadius: 12, backgroundColor: mobileTheme.colors.neutralBackground, borderWidth: 1, borderColor: mobileTheme.colors.border },
  warningTitle: { fontSize: 13, fontWeight: '900', color: mobileTheme.colors.text },
  action: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#111827', paddingHorizontal: 12 },
  actionText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  secondaryAction: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: mobileTheme.colors.border, paddingHorizontal: 12 },
  secondaryActionText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' },
});
