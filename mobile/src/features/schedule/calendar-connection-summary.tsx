import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { readCalendarConnectionStatus, type CalendarConnectionStatus } from './device-calendar';
import { mobileTheme } from '@/src/ui/theme';

const INITIAL: CalendarConnectionStatus = Object.freeze({
  state: 'not-selected',
  label: '캘린더 확인 중',
  detail: '연결 상태를 확인하고 있습니다.',
  calendarId: null,
  isGoogle: false,
});

export function CalendarConnectionSummary({
  onPressManage,
  refreshKey = 0,
  compact = false,
}: {
  onPressManage?: () => void;
  refreshKey?: number;
  compact?: boolean;
}) {
  const [status, setStatus] = useState<CalendarConnectionStatus>(INITIAL);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void readCalendarConnectionStatus()
      .then((value) => {
        if (!active) return;
        setStatus(value);
        setError('');
      })
      .catch((nextError) => {
        if (!active) return;
        setError(nextError instanceof Error ? nextError.message : '캘린더 연결 상태를 확인하지 못했습니다.');
      });
    return () => { active = false; };
  }, [refreshKey]);

  const connected = !error && status.state === 'connected';
  const body = <View style={[styles.root, compact ? styles.rootCompact : null, connected ? styles.rootConnected : null]}>
    <View style={styles.iconWrap}><Text style={styles.icon}>{connected ? '✓' : status.state === 'permission-required' ? '!' : '○'}</Text></View>
    <View style={styles.copy}>
      <Text style={[styles.label, connected ? styles.labelConnected : null]}>{error ? '캘린더 확인 실패' : status.label}</Text>
      <Text style={styles.detail}>{error || status.detail}</Text>
    </View>
    {onPressManage ? <Text style={styles.action}>관리 ›</Text> : null}
  </View>;

  if (!onPressManage) return body;
  return <Pressable accessibilityRole="button" accessibilityLabel="캘린더 연결 상태 및 설정 열기" onPress={onPressManage}>{body}</Pressable>;
}

const styles = StyleSheet.create({
  root: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 12,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    borderColor: mobileTheme.colors.border,
    backgroundColor: mobileTheme.colors.neutralBackground,
  },
  rootCompact: { minHeight: 54, paddingVertical: 9 },
  rootConnected: { borderColor: '#b8d9bf', backgroundColor: '#eef8f0' },
  iconWrap: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: mobileTheme.colors.surface },
  icon: { fontSize: 15, fontWeight: '900', color: mobileTheme.colors.success },
  copy: { flex: 1, minWidth: 0, gap: 2 },
  label: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.text },
  labelConnected: { color: mobileTheme.colors.success },
  detail: { fontSize: 11, lineHeight: 16, color: mobileTheme.colors.textSecondary },
  action: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link },
});
