import { useEffect, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Notifications from 'expo-notifications';

import { listScheduleReminders, listTrackedReminderScheduleIds, requestScheduleNotificationPermission } from '@/src/features/schedule/local-notifications';
import { type NotificationPreferences, loadNotificationPreferences, updateNotificationPreferences } from '@/src/platform/worklog-api';
import { mobileTheme } from '@/src/ui/theme';

type PermissionState = 'checking' | 'allowed' | 'not-allowed' | 'error';

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

async function countLocalReminders() {
  const scheduleIds = await listTrackedReminderScheduleIds();
  const groups = await Promise.all(scheduleIds.map((scheduleId) => listScheduleReminders(scheduleId)));
  return groups.reduce((total, reminders) => total + reminders.length, 0);
}

function ToggleRow({ title, detail, enabled, disabled, onPress }: { title: string; detail: string; enabled: boolean; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="switch" accessibilityState={{ checked: enabled, disabled }} disabled={disabled} style={[styles.toggle, disabled ? styles.toggleDisabled : null]} onPress={onPress}>
    <View style={styles.toggleCopy}><Text style={styles.toggleTitle}>{title}</Text><Text style={styles.detail}>{detail}</Text></View>
    <View style={[styles.toggleTrack, enabled ? styles.toggleTrackOn : null]}><View style={[styles.toggleThumb, enabled ? styles.toggleThumbOn : null]} /></View>
  </Pressable>;
}

export function ReminderSettings({ accessToken }: { accessToken: string }) {
  const [permission, setPermission] = useState<PermissionState>('checking');
  const [permissionDetail, setPermissionDetail] = useState('알림 권한을 확인하고 있습니다.');
  const [localCount, setLocalCount] = useState<number | null>(null);
  const [server, setServer] = useState<NotificationPreferences | null>(null);
  const [serverError, setServerError] = useState('');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setPermission('checking'); setPermissionDetail('알림 권한을 확인하고 있습니다.'); setServerError('');
    const [permissionResult, localResult, serverResult] = await Promise.allSettled([
      Notifications.getPermissionsAsync(), countLocalReminders(), loadNotificationPreferences(accessToken),
    ]);
    if (permissionResult.status === 'fulfilled') {
      const result = permissionResult.value;
      setPermission(result.granted ? 'allowed' : 'not-allowed');
      setPermissionDetail(result.granted ? '일정 Local Notification을 예약할 수 있습니다.' : result.canAskAgain ? '권한을 허용하면 일정 Local Notification을 예약할 수 있습니다.' : '휴대폰 설정에서 알림 권한을 허용해야 합니다.');
    } else { setPermission('error'); setPermissionDetail('알림 권한 상태를 확인하지 못했습니다.'); }
    setLocalCount(localResult.status === 'fulfilled' ? localResult.value : null);
    if (serverResult.status === 'fulfilled') setServer(serverResult.value);
    else setServerError(messageOf(serverResult.reason, '서버 Push 상태를 확인하지 못했습니다.'));
  }

  useEffect(() => { void refresh(); }, [accessToken]);

  async function requestPermission() {
    setBusy(true);
    try { await requestScheduleNotificationPermission(); await refresh(); }
    finally { setBusy(false); }
  }

  async function toggleServer(key: 'morningEnabled' | 'afternoonEnabled') {
    if (!server || busy) return;
    setBusy(true); setServerError('');
    try { setServer(await updateNotificationPreferences(accessToken, { [key]: !server[key] })); }
    catch (error) { setServerError(messageOf(error, '서버 알림 설정을 저장하지 못했습니다.')); }
    finally { setBusy(false); }
  }

  const serverConnected = server?.connected === true;
  return <View style={styles.root}>
    <View style={styles.section}><Text style={styles.eyebrow}>일상 설정</Text><Text style={styles.heading}>앱 알림</Text>
      <Text style={[styles.status, permission === 'allowed' ? styles.statusOn : permission === 'error' ? styles.statusError : null]}>{permission === 'allowed' ? '✓ 권한 허용됨' : permission === 'checking' ? '확인 중' : permission === 'error' ? '확인 필요' : '권한 필요'}</Text><Text style={styles.detail}>{permissionDetail}</Text>
      {permission !== 'allowed' ? <Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => void requestPermission()}><Text style={styles.actionText}>알림 권한 확인</Text></Pressable> : null}
    </View>

    <View style={styles.section}><Text style={styles.heading}>일정 리마인더</Text><Text style={styles.detail}>기존 Local Notification 상태만 확인합니다. 외부 Calendar와 일정별 기기 동기화는 보이스 안정화 후 다시 설계합니다.</Text><Text style={styles.status}>{localCount === null ? '예약 상태 확인 중' : localCount ? `예약된 일정 알림 ${localCount}개` : '예약된 일정 알림 없음'}</Text></View>

    <View style={styles.section}><Text style={styles.heading}>서버 Push</Text><Text style={styles.detail}>이 모바일 앱은 서버 Push를 직접 받지 않습니다. 아래 상태는 같은 계정으로 연결한 웹/PWA 알림에만 적용됩니다.</Text>
      {serverError ? <Text style={styles.error}>{serverError}</Text> : null}
      {!server && !serverError ? <Text style={styles.status}>서버 Push 상태 확인 중</Text> : null}
      {server ? <><Text style={[styles.status, serverConnected ? styles.statusOn : null]}>{serverConnected ? '✓ 웹/PWA 연결됨' : '웹/PWA 연결 없음'}</Text>
        <ToggleRow title="오전 업무 알림" detail={server.morningEnabled && serverConnected ? '필요한 날 오전 8:30에 보냅니다.' : '꺼짐 · 웹/PWA 연결 기기에서만 켤 수 있습니다.'} enabled={server.morningEnabled && serverConnected} disabled={busy || (!serverConnected && !server.morningEnabled)} onPress={() => void toggleServer('morningEnabled')} />
        <ToggleRow title="오후 미완료 알림" detail={server.afternoonEnabled && serverConnected ? '남은 업무가 있는 날 오후 4:30에 보냅니다.' : '꺼짐 · 웹/PWA 연결 기기에서만 켤 수 있습니다.'} enabled={server.afternoonEnabled && serverConnected} disabled={busy || (!serverConnected && !server.afternoonEnabled)} onPress={() => void toggleServer('afternoonEnabled')} />
      </> : null}
    </View>

    <View style={styles.diagnostics}><Pressable accessibilityRole="button" accessibilityLabel={diagnosticsOpen ? '알림 테스트·문제 해결 접기' : '알림 테스트·문제 해결 펼치기'} style={styles.diagnosticsHead} onPress={() => setDiagnosticsOpen((value) => !value)}><Text style={styles.heading}>알림 테스트·문제 해결</Text><Text style={styles.disclosure}>{diagnosticsOpen ? '▴' : '▾'}</Text></Pressable>{diagnosticsOpen ? <View style={styles.diagnosticsBody}><Text style={styles.detail}>권한, Local Notification 예약, 웹/PWA 서버 Push 연결을 다시 확인합니다. 테스트 알림을 자동으로 보내지 않습니다.</Text><Pressable accessibilityRole="button" disabled={busy} style={styles.action} onPress={() => void refresh()}><Text style={styles.actionText}>상태 다시 확인</Text></Pressable><Pressable accessibilityRole="button" style={styles.secondaryAction} onPress={() => void Linking.openSettings()}><Text style={styles.secondaryActionText}>휴대폰 알림 설정 열기</Text></Pressable></View> : null}</View>
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 14 }, section: { gap: 8, padding: 14, borderRadius: 16, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border }, eyebrow: { fontSize: 11, fontWeight: '800', letterSpacing: 0.8, color: mobileTheme.colors.textMuted }, heading: { fontSize: 16, fontWeight: '800', color: mobileTheme.colors.text }, detail: { fontSize: 12, lineHeight: 18, color: mobileTheme.colors.textSecondary }, status: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.textSecondary }, statusOn: { color: mobileTheme.colors.success }, statusError: { color: mobileTheme.colors.danger }, error: { fontSize: 12, lineHeight: 18, color: mobileTheme.colors.danger, backgroundColor: '#fff0f0', padding: 9, borderRadius: 10 }, action: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#111827', paddingHorizontal: 12 }, actionText: { color: '#fff', fontSize: 13, fontWeight: '800' }, secondaryAction: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 11, borderWidth: 1, borderColor: mobileTheme.colors.border, paddingHorizontal: 12 }, secondaryActionText: { color: mobileTheme.colors.link, fontSize: 13, fontWeight: '800' }, toggle: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, borderTopWidth: 1, borderTopColor: mobileTheme.colors.borderSubtle }, toggleDisabled: { opacity: 0.55 }, toggleCopy: { flex: 1, minWidth: 0, gap: 3 }, toggleTitle: { fontSize: 14, fontWeight: '800', color: mobileTheme.colors.text }, toggleTrack: { width: 42, height: 24, padding: 3, borderRadius: 12, backgroundColor: '#d1d5db' }, toggleTrackOn: { backgroundColor: '#275daf' }, toggleThumb: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#fff' }, toggleThumbOn: { alignSelf: 'flex-end' }, diagnostics: { borderWidth: 1, borderRadius: 16, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.neutralBackground, overflow: 'hidden' }, diagnosticsHead: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }, disclosure: { color: mobileTheme.colors.link, fontSize: 18, fontWeight: '800' }, diagnosticsBody: { gap: 10, borderTopWidth: 1, borderTopColor: mobileTheme.colors.borderSubtle, padding: 14 },
});
