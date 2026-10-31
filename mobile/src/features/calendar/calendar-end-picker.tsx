import React, { useState } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { CalendarSource } from './calendar-source';

export function calendarDateLabel(value: string, allDay: boolean, timeZone: string) {
  if (!value) return '종료 선택';
  const date = new Date(allDay ? `${value}T12:00:00Z` : value);
  return new Intl.DateTimeFormat('ko-KR', { timeZone: allDay ? 'UTC' : timeZone, dateStyle: 'medium', ...(allDay ? {} : { timeStyle: 'short' }) }).format(date);
}

export function CalendarEndPicker({ source, value, disabled, onChange }: {
  source: CalendarSource; value: string; disabled: boolean; onChange(value: string): void;
}) {
  const [mode, setMode] = useState<'date' | 'time' | null>(null);
  const [candidate, setCandidate] = useState(new Date(source.allDay ? `${source.start}T12:00:00Z` : source.start));
  function accept(selected: Date) {
    setCandidate(selected);
    if (source.allDay) {
      // The user picks the last included day; only the adapter-facing value is exclusive.
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(selected);
      const part = (name: string) => Number(parts.find(p => p.type === name)?.value);
      const exclusive = new Date(Date.UTC(part('year'), part('month') - 1, part('day') + 1));
      onChange(exclusive.toISOString().slice(0, 10)); setMode(null);
    } else if (mode === 'date') setMode('time');
    else { onChange(selected.toISOString()); setMode(null); }
  }
  const displayValue = source.allDay && value ? new Date(Date.parse(`${value}T12:00:00Z`) - 86400000).toISOString().slice(0, 10) : value;
  return <View>
    <Text>{source.allDay ? '마지막 날짜' : '종료 날짜·시간'} · {source.timeZone}</Text>
    <Pressable accessibilityRole="button" accessibilityLabel="종료 날짜와 시간 선택" disabled={disabled || !!source.end} onPress={() => setMode('date')} style={{ minHeight: 48, justifyContent: 'center' }}>
      <Text style={{ fontSize: 16, color: '#1d4ed8' }}>{calendarDateLabel(displayValue, source.allDay, source.timeZone)}</Text>
    </Pressable>
    {mode ? <>
      <DateTimePicker value={candidate} mode={mode} timeZoneName={source.allDay ? 'UTC' : source.timeZone} display={Platform.OS === 'ios' ? 'spinner' : 'default'} locale="ko-KR"
        onChange={(event, selected) => {
          if (event.type === 'dismissed') { setMode(null); return; }
          if (!selected) return;
          if (Platform.OS === 'ios') setCandidate(selected); else accept(selected);
        }} />
      {Platform.OS === 'ios' ? <Pressable accessibilityRole="button" onPress={() => accept(candidate)} style={{ minHeight: 48 }}><Text>선택 완료</Text></Pressable> : null}
    </> : null}
  </View>;
}
