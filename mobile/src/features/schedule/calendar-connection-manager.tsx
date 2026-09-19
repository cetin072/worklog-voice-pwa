import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  getPreferredCalendarId,
  listWritableCalendarOptions,
  readCalendarConnectionStatus,
  setPreferredCalendarId,
  type WritableCalendarOption,
} from './device-calendar';
import { mobileTheme } from '@/src/ui/theme';

function calendarMeta(calendar: WritableCalendarOption) {
  if (calendar.isGoogle) {
    return calendar.ownerAccount
      ? `Google Calendar · ${calendar.ownerAccount}`
      : 'Google Calendar';
  }
  return calendar.ownerAccount || calendar.sourceName || '휴대폰 캘린더';
}

export function CalendarConnectionManager({ onChanged }: { onChanged?: () => void }) {
  const [options, setOptions] = useState<WritableCalendarOption[]>([]);
  const [preferredId, setPreferredId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function refreshWithoutPrompt() {
    try {
      const status = await readCalendarConnectionStatus();
      setPreferredId(status.calendarId);
      if (status.state === 'connected') setMessage(`${status.label} · ${status.detail}`);
      else setMessage(status.detail);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '캘린더 상태를 확인하지 못했습니다.');
    }
  }

  useEffect(() => { void refreshWithoutPrompt(); }, []);

  async function loadOptions() {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      const calendars = await listWritableCalendarOptions();
      const current = await getPreferredCalendarId();
      setOptions(calendars);
      setPreferredId(current);
      setLoaded(true);
      if (!calendars.length) {
        setMessage('수정 가능한 캘린더가 없습니다. Android 설정에서 Google 계정의 Calendar 동기화를 켜주세요.');
        return;
      }
      setMessage(current ? '현재 기본 Calendar를 확인했습니다. 필요하면 아래에서 변경하세요.' : '업무수첩 일정이 저장될 기본 Calendar를 선택하세요.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '캘린더 목록을 불러오지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function choose(calendar: WritableCalendarOption) {
    if (busy) return;
    setBusy(true);
    setMessage('');
    try {
      await setPreferredCalendarId(calendar.id);
      setPreferredId(calendar.id);
      setMessage(calendar.isGoogle
        ? `✓ Google Calendar 기본 저장 대상으로 선택했습니다 · ${calendar.ownerAccount || calendar.title}`
        : `✓ ${calendar.title} 캘린더를 기본 저장 대상으로 선택했습니다.`);
      onChanged?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '기본 Calendar를 변경하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }

  const selected = options.find((calendar) => calendar.id === preferredId) || null;

  return <View style={styles.root}>
    <View style={styles.head}>
      <View style={styles.copy}>
        <Text style={styles.eyebrow}>DEFAULT CALENDAR</Text>
        <Text style={styles.title}>일정 저장 캘린더</Text>
        <Text style={styles.help}>업무수첩에서 새 일정을 Calendar에 추가할 때 사용할 기본 대상을 정합니다.</Text>
      </View>
      <Pressable accessibilityRole="button" style={styles.loadButton} disabled={busy} onPress={() => void loadOptions()}>
        <Text style={styles.loadButtonText}>{busy ? '확인 중…' : loaded ? '목록 새로고침' : '연결·선택'}</Text>
      </Pressable>
    </View>

    {selected ? <View style={styles.selected}>
      <Text style={styles.selectedTitle}>✓ 현재 기본: {selected.title}</Text>
      <Text style={styles.selectedMeta}>{calendarMeta(selected)}</Text>
    </View> : null}

    {loaded ? <View style={styles.options}>
      {options.map((calendar) => {
        const active = calendar.id === preferredId;
        return <Pressable
          key={calendar.id}
          accessibilityRole="button"
          accessibilityLabel={`${calendar.title} 캘린더 ${active ? '선택됨' : '선택'}`}
          disabled={busy}
          style={[styles.option, active ? styles.optionActive : null]}
          onPress={() => void choose(calendar)}
        >
          <View style={styles.optionCopy}>
            <Text style={[styles.optionTitle, active ? styles.optionTitleActive : null]}>
              {calendar.isGoogle ? 'G · ' : ''}{calendar.title}{calendar.isPrimary ? ' · 기본' : ''}
            </Text>
            <Text style={styles.optionMeta}>{calendarMeta(calendar)}</Text>
          </View>
          <Text style={[styles.check, active ? styles.checkActive : null]}>{active ? '✓' : '○'}</Text>
        </Pressable>;
      })}
    </View> : null}

    {message ? <Text style={styles.message}>{message}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { gap: 10, padding: 12, borderRadius: mobileTheme.radius.control, borderWidth: 1, borderColor: mobileTheme.colors.borderSubtle, backgroundColor: mobileTheme.colors.neutralBackground },
  head: { gap: 10 },
  copy: { gap: 4 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: mobileTheme.colors.textMuted },
  title: { fontSize: 16, fontWeight: '800', color: mobileTheme.colors.text },
  help: { fontSize: 12, lineHeight: 18, color: mobileTheme.colors.textSecondary },
  loadButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', borderRadius: mobileTheme.radius.compact, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  loadButtonText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link },
  selected: { gap: 3, padding: 10, borderRadius: mobileTheme.radius.compact, backgroundColor: '#eef8f0', borderWidth: 1, borderColor: '#b8d9bf' },
  selectedTitle: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.success },
  selectedMeta: { fontSize: 11, color: mobileTheme.colors.textSecondary },
  options: { gap: 8 },
  option: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: mobileTheme.radius.compact, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  optionActive: { borderColor: mobileTheme.colors.link, backgroundColor: '#edf4ff' },
  optionCopy: { flex: 1, minWidth: 0, gap: 3 },
  optionTitle: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.text },
  optionTitleActive: { color: mobileTheme.colors.link },
  optionMeta: { fontSize: 11, color: mobileTheme.colors.textSecondary },
  check: { fontSize: 16, fontWeight: '900', color: mobileTheme.colors.textMuted },
  checkActive: { color: mobileTheme.colors.link },
  message: { fontSize: 12, lineHeight: 18, color: mobileTheme.colors.textSecondary },
});
