import type { ReactNode } from 'react';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePlatform } from '@/src/providers/platform-provider';
import { personalCalendarMessage, personalCalendarRequest, type CalendarMonth, type PersonalCalendarEvent } from '../calendar/personal-calendar-api';
import type { BriefingSchedule } from '@/src/platform/worklog-api';
import { calendarDays, calendarTime, eventsOnDay, seoulDate, shiftDay, shiftMonth } from './home-calendar-model';
import { mobileTheme } from '@/src/ui/theme';

export function HomeCalendar({ revision, today, fallback, onOpenCalendar, renderSchedule, focusId, focusDate, onTodayCount }: {
  revision: number; today: string; fallback: BriefingSchedule[]; onOpenCalendar(day?: string): void; onTodayCount(count: number | null): void;
  renderSchedule(schedule: BriefingSchedule): ReactNode; focusId?: string | null; focusDate?: string;
}) {
  const { client, config, session } = usePlatform();
  const [selected, setSelected] = useState(today), [expanded, setExpanded] = useState(false);
  const [opened, setOpened] = useState<string | null>(null), [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; events: PersonalCalendarEvent[]; limited: boolean } | null>(null);
  const [error, setError] = useState('');
  const owner = session?.user.id, integrated = config?.dataSchema === 'worklog';
  const days = calendarDays(selected, expanded);
  const months = [...new Set(days.filter((d): d is string => !!d).map(d => d.slice(0, 7)))].filter(m => m >= '2000-01' && m <= '2099-12');
  const monthKey = months.join(','), key = `${owner}:${monthKey}:${revision}:${reload}`;
  const latest = useRef({ owner, key }); latest.current = { owner, key };
  useEffect(() => { setSelected(today); setOpened(null); }, [today]);
  useEffect(() => {
    if (focusId && focusDate && Number.isFinite(Date.parse(focusDate))) { setSelected(seoulDate(focusDate)); setOpened(focusId); }
  }, [focusId, focusDate]);
  useEffect(() => { onTodayCount(result?.key === key && !result.limited ? eventsOnDay(result.events, today).length : null); }, [result, key, today, onTodayCount]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => { if (state === 'active') setReload(n => n + 1); });
    return () => subscription.remove();
  }, []);
  useEffect(() => {
    let alive = true;
    const current = () => alive && latest.current.owner === owner && latest.current.key === key;
    setError('');
    if (!integrated || !client || !config || !owner) return;
    const access = { client, config, ownerId: owner, current };
    void Promise.all(monthKey.split(',').map(month => personalCalendarRequest<CalendarMonth>(access, 'get_my_calendar_month', { p_month: month + '-01' })))
      .then(values => { if (current()) setResult({ key, events: values.flatMap(v => v.events), limited: values.some(v => v.limited) }); })
      .catch(e => { if (current()) { const message = personalCalendarMessage(e); setError(message.includes('입력은 유지') ? '일정을 불러오지 못했습니다. 다시 시도해주세요.' : message); } });
    return () => { alive = false; };
  }, [client, config, owner, key, integrated, monthKey]);
  const loaded = result?.key === key;
  const busy = integrated && !loaded && !error;
  // A legacy briefing is only a known window, never evidence of an empty month.
  const legacy = fallback.map((s, i): PersonalCalendarEvent => ({ id: s.scheduleId || `legacy-${i}`, source: 'personal', title: s.title || '제목 없는 일정', starts_at: s.startsAt || `${s.dateKey}T00:00:00+09:00`, ends_at: null, all_day: !!s.allDay, location: s.location || null, description: '', status: s.status || 'confirmed', updated_at: '', editable: false }));
  const events = integrated && loaded ? result.events : legacy;
  const rows = eventsOnDay(events, selected);
  const action = (label: string, onPress: () => void, disabled = false) => <Pressable accessibilityRole="button" style={styles.action} disabled={disabled} onPress={onPress}><Text style={styles.link}>{label}</Text></Pressable>;
  return <View style={styles.card}>
    <View style={styles.row}>
      <Pressable accessibilityRole="button" accessibilityLabel="오늘 날짜로 이동" style={styles.monthTitle} onPress={() => setSelected(today)}><Text style={styles.title}>{expanded ? `${Number(selected.slice(0, 4))}년 ${Number(selected.slice(5, 7))}월` : days.includes(today) ? '이번 주' : `${Number(selected.slice(5, 7))}월 ${Number(selected.slice(8))}일 주간`}</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? '이전 달' : '이전 주'} disabled={selected <= '2000-01-07'} style={styles.nav} onPress={() => setSelected(expanded ? shiftMonth(selected, -1) : shiftDay(selected, -7))}><Text style={styles.link}>‹</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={expanded ? '다음 달' : '다음 주'} disabled={selected >= '2099-12-25'} style={styles.nav} onPress={() => setSelected(expanded ? shiftMonth(selected, 1) : shiftDay(selected, 7))}><Text style={styles.link}>›</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} style={styles.action} onPress={() => setExpanded(v => !v)}><Text style={styles.link}>{expanded ? '주 보기 ⌃' : '월 보기 ⌄'}</Text></Pressable>
    </View>
    <View style={styles.grid}>{['월', '화', '수', '목', '금', '토', '일'].map(d => <View key={d} style={styles.weekday}><Text style={styles.muted}>{d}</Text></View>)}
      {days.map((day, index) => day ? <Pressable key={day} accessibilityRole="button" accessibilityLabel={`${day}${day === today ? ' 오늘' : ''}${eventsOnDay(events, day).length ? ' 일정 있음' : ''}`} accessibilityState={{ selected: day === selected }} disabled={day < '2000-01-01' || day > '2099-12-31'} onPress={() => { setSelected(day); setOpened(null); }} style={styles.day}>
        <Text style={[styles.dayNumber, day === selected && styles.selected, day === today && day !== selected && styles.today]}>{Number(day.slice(8))}</Text><Text style={styles.dot}>{eventsOnDay(events, day).length ? '•' : ' '}</Text>
      </Pressable> : <View key={`blank-${index}`} style={styles.day} />)}
    </View>
    <View style={styles.divider} />
    <View style={styles.row}><Text accessibilityRole="header" style={styles.subtitle}>{selected === today ? '오늘 일정' : `${Number(selected.slice(5, 7))}월 ${Number(selected.slice(8))}일 일정`}</Text>{integrated ? action('일정 관리', () => onOpenCalendar(selected)) : null}</View>
    {!integrated ? <Text style={styles.muted}>브리핑에서 확인된 일정만 표시합니다. 월 전체 일정은 포함되지 않습니다.</Text> : null}
    {busy ? <View style={styles.row}><ActivityIndicator /><Text style={styles.muted}>일정 불러오는 중…</Text></View> : null}
    {error ? <View><Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text>{action('일정 다시 불러오기', () => setReload(n => n + 1))}</View> : null}
    {loaded && result.limited ? <Text style={styles.error}>일부 일정만 표시 중입니다. 표시되지 않은 일정이 있을 수 있습니다.</Text> : null}
    {!busy && !error && !rows.length ? <Text style={styles.muted}>{integrated && loaded && !result.limited ? '이 날짜에 등록된 일정이 없습니다.' : '현재 확인된 일정이 없습니다.'}</Text> : null}
    {rows.map(event => {
      const known = fallback.find(s => s.scheduleId === event.id);
      return <View key={event.id}><Pressable accessibilityRole="button" accessibilityLabel={`${event.title} 일정 상세`} accessibilityState={{ expanded: opened === event.id }} style={styles.event} onPress={() => setOpened(id => id === event.id ? null : event.id)}>
        <Text style={styles.time}>{calendarTime(event, selected)}</Text><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.muted}>›</Text>
      </Pressable>{opened === event.id ? known ? renderSchedule(known) : <View style={styles.details}>{event.location ? <Text>{event.location}</Text> : null}{event.description ? <Text>{event.description}</Text> : null}{integrated ? action('내 캘린더에서 확인·수정', () => onOpenCalendar(selected)) : null}</View> : null}</View>;
    })}
    {focusId && !busy && !rows.some(row => row.id === focusId) ? <View style={styles.details}>{fallback.find(s => s.scheduleId === focusId) ? renderSchedule(fallback.find(s => s.scheduleId === focusId)!) : <Text style={styles.muted}>선택한 일정은 해당 날짜의 업무일지 또는 내 캘린더에서 확인해주세요.</Text>}</View> : null}
  </View>;
}
const styles = StyleSheet.create({
  card: { padding: 14, borderRadius: 20, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border, gap: 4 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 4 },
  monthTitle: { flex: 1, minHeight: 44, justifyContent: 'center' }, nav: { minWidth: 32, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '800', color: mobileTheme.colors.text }, subtitle: { fontSize: 17, fontWeight: '700', color: mobileTheme.colors.text },
  action: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 6 }, link: { fontSize: 13, color: mobileTheme.colors.link },
  grid: { flexDirection: 'row', flexWrap: 'wrap' }, weekday: { width: '14.285714%', alignItems: 'center', paddingVertical: 4 },
  day: { width: '14.285714%', minHeight: 48, alignItems: 'center', justifyContent: 'center' }, dayNumber: { textAlign: 'center', minWidth: 32, padding: 5, fontSize: 16, color: mobileTheme.colors.text, borderRadius: 20 },
  selected: { backgroundColor: mobileTheme.colors.link, color: '#ffffff', fontWeight: '800' }, today: { color: mobileTheme.colors.link, fontWeight: '800' }, dot: { fontSize: 12, lineHeight: 14, color: mobileTheme.colors.link },
  divider: { height: 1, backgroundColor: mobileTheme.colors.borderSubtle, marginVertical: 6 },
  event: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 }, time: { fontSize: 14, color: mobileTheme.colors.link, minWidth: 44 }, eventTitle: { flex: 1, fontSize: 16, color: mobileTheme.colors.text },
  muted: { fontSize: 13, color: mobileTheme.colors.textSecondary }, error: { fontSize: 13, color: mobileTheme.colors.danger }, details: { padding: 10, gap: 4, backgroundColor: mobileTheme.colors.neutralBackground },
});
