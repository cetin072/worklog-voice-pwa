import { CalendarSettings } from '@/src/features/settings/calendar-settings';
import { CalendarExportPreview } from '@/src/features/calendar/calendar-export-preview';
import { homeOverview } from '@/src/features/home/home-overview';
import { HomeReminderStatus } from '@/src/features/home/home-reminder-status';
import { CompactReminderLabel, ScheduleReminderLabel } from '@/src/features/home/schedule-reminder-label';
import { notificationResponseHandler } from '@/src/features/startup/notification-response-gate';
import { StartupScreen } from '@/src/features/startup/startup-screen';
import { initialBriefingState } from '@/src/features/startup/briefing-startup';
import { WorklogReminderSheet } from '@/src/features/schedule/worklog-reminder-sheet';
import type { ReminderTarget } from '@/src/features/schedule/worklog-reminder-adapter';
import { reminderFailureMessage, savedReminderMessage } from '@/src/features/schedule/reminder-feedback';
import { reminderSessionEpoch, reminderSyncEpoch } from '@/src/features/schedule/schedule-reminder-snapshot';
import { briefingMetadata } from '@/src/platform/briefing-metadata';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Button, KeyboardAvoidingView, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VoiceRecorderCard } from '@/src/features/voice/voice-recorder-card';
import { QUICK_VOICE_LAYOUT } from '@/src/features/voice/quick-voice-layout';
import { createConfiguredMobileTranscriptionProvider } from '@/src/features/voice/transcription-provider';
import { MeetingRecordingBanner } from '@/src/features/voice/meeting-recording-banner';
import { prepareQuickVoiceWhisperProvider } from '@/src/features/voice/providers/whisper-rn-quick-voice-runtime';
import { createExpoSpeechRecognitionAdapter } from '@/src/features/voice/providers/expo-speech-recognition-adapter';
import { WorkRecordSearch } from '@/src/features/search/work-record-search';
import { ManualWorkInput, type ManualWorkInputValue } from '@/src/features/work/manual-work-input';
import { WorkRecordEditSheet } from '@/src/features/work/work-record-edit-sheet';
import { TaskReminderActions } from '@/src/features/work/task-reminder-actions';
import { cancelSavedScheduleReminders, recoverSavedScheduleReminders, synchronizeBriefingScheduleReminders, synchronizeSavedScheduleReminders, synchronizeUpdatedScheduleReminder, synchronizeEditedWorklogReminder } from '@/src/features/schedule/schedule-reminder-post-save';
import { markExactAlarmPermissionGuided, openExactAlarmPermissionSettings, shouldGuideExactAlarmPermission } from '@/src/features/schedule/local-notifications';
import { MOBILE_PATCH_NOTES } from '@/src/features/settings/patch-notes';
import { ReminderSettings } from '@/src/features/settings/reminder-settings';
import { createSerialTaskQueue } from '@/src/platform/serial-task-queue';
import { type BriefingNote, type BriefingSchedule, type BriefingTask, type MobileBriefing, type WorkJournalDay, type WorkJournalNote, type WorkJournalRecord, deleteWorklog, loadBriefing, loadWorkJournalDay, postponeWorklog, readWorklogDetails, saveWorklog, setWorklogAttention, undoPostponeWorklog, undoWorklogAttention, updateBriefingNoteState, updateWorklogDetails, updateWorklogStatus } from '@/src/platform/worklog-api';

import { getFreshAccessToken } from '@/src/platform/authenticated-access';
import { usePlatform } from '@/src/providers/platform-provider';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';

const QUICK_VOICE_SPEECH_RECOGNITION = createExpoSpeechRecognitionAdapter();
type AppScreen = 'home' | 'journal' | 'recordSearch' | 'task' | 'input' | 'meeting' | 'settings' | 'reminderSettings' | 'patchNotes';
type BriefingBucket = 'overdue' | 'today' | 'upcoming' | 'undated';
type WorkStatus = '완료' | '진행중' | '대기' | '확인필요';
type AuthMode = 'signIn' | 'signUp';
type DirectSaveFeedback = Readonly<{
  transcript: string;
  scheduleDetected: boolean;
  scheduleCreated: boolean;
  scheduleId: string;
  dueStart: string;
}>;

function emptyManualWorkInput(): ManualWorkInputValue {
  return {
    transcript: '',
    dueDate: '',
    dueTime: '',
  };
}

function manualScheduleText(dueDate: string, dueTime: string) {
  if (!dueDate) return '';
  const date = dueDate.replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$1년 $2월 $3일');
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(dueTime);
  if (!timeMatch) return ` ${date}`;
  const hour = Number(timeMatch[1]);
  const minute = timeMatch[2];
  const meridiem = hour < 12 ? '오전' : '오후';
  const displayHour = hour % 12 || 12;
  return ` ${date} ${meridiem} ${displayHour}시 ${minute}분`;
}

const briefingBuckets: Array<{ key: BriefingBucket; label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }> = [
  { key: 'today', label: '오늘', tone: 'warning' },
  { key: 'overdue', label: '기한 지남', tone: 'danger' },
  { key: 'upcoming', label: '다가오는 업무', tone: 'info' },
  { key: 'undated', label: '기한 없는 업무', tone: 'neutral' },
];

function seoulTodayKey() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function shiftDateKey(value: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return seoulTodayKey();
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + days);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function formatJournalDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'UTC',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(date);
}

function formatJournalTime(value?: string) {
  if (!value) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function exactAlarmAccessError(error: unknown) {
  const message = messageOf(error, '');
  return /SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|SecurityException|exact alarm|exact-alarm/i.test(message);
}

async function maybeGuideExactAlarmPermission(hasTimedSchedule: boolean) {
  if (!hasTimedSchedule || !await shouldGuideExactAlarmPermission()) return;
  await markExactAlarmPermissionGuided();
  Alert.alert(
    '정확한 시간 알림 설정',
    '일정 시작 시각에 맞춰 알려드리려면 Android의 ‘알람 및 리마인더’ 허용이 필요합니다. 한 번만 설정하면 됩니다.',
    [
      { text: '나중에', style: 'cancel' },
      { text: '설정하기', onPress: () => { void openExactAlarmPermissionSettings(); } },
    ],
  );
}

function formatSchedule(schedule: BriefingSchedule) {
  if (schedule.allDay) return `${schedule.dateKey || '날짜 미정'} · 종일`;
  if (!schedule.startsAt) return schedule.dateKey || '시간 미정';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(schedule.startsAt));
}

function formatSavedDue(value: string) {
  const date = new Date(value);
  if (!value || !Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function taskNote(bucket: BriefingBucket, task: BriefingTask) {
  if (bucket === 'overdue') return `${task.dueKey || '기한'}${task.daysOverdue ? ` · ${task.daysOverdue}일 지남` : ''}`;
  if (bucket === 'today') return '오늘 기한';
  if (bucket === 'upcoming') return `${task.dueKey || '기한'}${task.daysUntil ? ` · ${task.daysUntil}일 후` : ''}`;
  return '기한 없음';
}

function ReminderShortcut({ id, title, onPress, disabled = false }: { id?: string; title: string; onPress: () => void; disabled?: boolean }) {
  return <CompactReminderLabel id={id} record title={title} onPress={onPress} disabled={disabled} />;
}


function TaskRow({ bucket, task, onOpen, onReminder, onEdit, onDelete, onComplete, completing = false }: { bucket: BriefingBucket; task: BriefingTask; onOpen: () => void; onReminder: () => void; onEdit?: () => void; onDelete?: () => void; onComplete?: () => void; completing?: boolean }) {
  return <View style={styles.taskRow}>
    <View style={styles.taskMain}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '제목 없는 업무'} 상세 보기`} onPress={onOpen}>
      <Text style={styles.taskTitle}>{task.title || '제목 없는 업무'}</Text>
      <Text style={styles.taskMeta}>{taskNote(bucket, task)}{task.status ? ` · ${task.status}` : ''}</Text>
      {task.nextAttentionAt ? <Text style={styles.taskMeta}>다시 확인할 업무</Text> : null}
      {task.institution ? <Text style={styles.taskBadge}>{task.institution}</Text> : null}
      {task.followUp && task.followUp !== task.title ? <Text style={styles.followUp}>↳ {task.followUp}</Text> : null}
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 12, marginTop: 6 }}>
      {task.pageId ? <ReminderShortcut id={task.pageId} title={task.title || '업무'} onPress={onReminder} disabled={completing} /> : null}
      {task.pageId ? <CalendarExportPreview recordId={task.pageId} title={task.title || '업무'} /> : null}
      </View>
    </View>
    {task.pageId ? <View style={styles.taskActions}>
      <View style={styles.taskMinorActions}>
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '업무'} 수정`} disabled={completing} style={styles.inlineEdit} onPress={onEdit}><Text style={styles.inlineEditText}>✏️</Text></Pressable> : null}
        {onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '업무'} 삭제`} disabled={completing} style={styles.inlineDelete} onPress={onDelete}><Text style={styles.inlineDeleteText}>삭제</Text></Pressable> : null}
      </View>
      {onComplete ? <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '업무'} 완료 처리`} disabled={completing} style={[styles.inlineComplete, completing ? styles.inlineCompleteBusy : null]} onPress={onComplete}><Text style={styles.inlineCompleteText}>{completing ? '처리 중' : '완료'}</Text></Pressable> : null}
    </View> : null}
  </View>;
}

function formatNoteJournalDate(value?: string) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
  const date = new Date(`${value}T00:00:00+09:00`);
  if (!Number.isFinite(date.getTime())) return '';
  return `${new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(date)} 기록`;
}

function NoteRow({ note, onEdit, onDelete, onAcknowledge, onReminder, acknowledging = false }: { note: BriefingNote; onReminder(): void; onEdit?: () => void; onDelete?: () => void; onAcknowledge: () => void; acknowledging?: boolean }) {
  return <View style={styles.taskRow}>
    <View style={styles.taskMain}>
      <Text style={styles.taskTitle}>{note.title || '제목 없는 메모'}</Text>
      {formatNoteJournalDate(note.journalDate) ? <Text style={styles.taskMeta}>{formatNoteJournalDate(note.journalDate)}</Text> : null}
      {note.institution ? <Text style={styles.taskBadge}>{note.institution}</Text> : null}
      {note.pageId ? <ReminderShortcut id={note.pageId} title={note.title || '메모'} onPress={onReminder} disabled={acknowledging} /> : null}
    </View>
    {note.pageId ? <View style={styles.taskActions}>
      <View style={styles.taskMinorActions}>
        {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${note.title || '메모'} 수정`} disabled={acknowledging} style={styles.inlineEdit} onPress={onEdit}><Text style={styles.inlineEditText}>✏️</Text></Pressable> : null}
        {onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={`${note.title || '메모'} 삭제`} disabled={acknowledging} style={styles.inlineDelete} onPress={onDelete}><Text style={styles.inlineDeleteText}>삭제</Text></Pressable> : null}
      </View>
      <Pressable accessibilityRole="button" accessibilityLabel={`${note.title || '메모'} 확인했어요 처리`} disabled={acknowledging} style={[styles.inlineComplete, acknowledging ? styles.inlineCompleteBusy : null]} onPress={onAcknowledge}>
        <Text style={styles.inlineCompleteText}>{acknowledging ? '처리 중' : '확인했어요'}</Text>
      </Pressable>
    </View> : null}
  </View>;
}

function JournalRecordRows({ records, empty, completed = false }: { records?: WorkJournalRecord[]; empty: string; completed?: boolean }) {
  if (!records?.length) return <Text style={styles.emptyText}>{empty}</Text>;
  return records.map((record, index) => <View key={record.pageId || `journal-record-${index}`} style={styles.journalRow}>
    <Text style={styles.journalBullet}>{completed ? '✓' : '○'}</Text>
    <View style={styles.taskMain}>
      <Text style={styles.taskTitle}>{record.title || '제목 없는 업무'}</Text>
      <Text style={styles.taskMeta}>{[
        completed ? formatJournalTime(record.completedAt || record.recordedAt) : '',
        record.status && !completed ? record.status : '',
        record.institution || '',
      ].filter(Boolean).join(' · ')}</Text>
      {record.followUp ? <Text style={styles.followUp}>↳ {record.followUp}</Text> : null}
    </View>
  </View>);
}

function JournalNoteRows({ notes, empty }: { notes?: WorkJournalNote[]; empty: string }) {
  if (!notes?.length) return <Text style={styles.emptyText}>{empty}</Text>;
  return notes.map((note, index) => <View key={note.pageId || `journal-note-${index}`} style={styles.journalRow}>
    <Text style={styles.journalBullet}>•</Text>
    <View style={styles.taskMain}>
      <Text style={styles.taskTitle}>{note.title || '제목 없는 메모'}</Text>
      <Text style={styles.taskMeta}>{[
        formatJournalTime(note.recordedAt),
        note.institution || '',
      ].filter(Boolean).join(' · ')}</Text>
    </View>
  </View>);
}

function JournalScheduleRows({ schedules, empty }: { schedules?: BriefingSchedule[]; empty: string }) {
  if (!schedules?.length) return <Text style={styles.emptyText}>{empty}</Text>;
  return schedules.map((schedule, index) => <View key={schedule.scheduleId || `journal-schedule-${index}`} style={styles.journalRow}>
    <Text style={styles.journalTime}>{schedule.allDay ? '종일' : formatJournalTime(schedule.startsAt) || '시간 미정'}</Text>
    <View style={styles.taskMain}>
      <Text style={styles.taskTitle}>{schedule.title || '제목 없는 일정'}</Text>
      {schedule.location ? <Text style={styles.taskMeta}>{schedule.location}</Text> : null}
    </View>
  </View>);
}

function ScheduleRows({ schedules, empty, onReminder }: { schedules?: BriefingSchedule[]; empty: string; onReminder(schedule: BriefingSchedule): void }) {
  if (!schedules?.length) return <Text style={styles.emptyText}>{empty}</Text>;
  return schedules.map((schedule, index) => <View key={schedule.scheduleId || `${schedule.title}-${index}`} style={styles.scheduleRow}><Text style={styles.scheduleDate}>{formatSchedule(schedule)}</Text><Text style={styles.taskTitle}>{schedule.title || '제목 없는 일정'}</Text>{schedule.location ? <Text style={styles.taskMeta}>{schedule.location}</Text> : null}{schedule.scheduleId ? <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 12, marginTop: 6 }}><ScheduleReminderLabel schedule={schedule} onPress={() => onReminder(schedule)} />{['confirmed', '확정'].includes(schedule.status || '') ? <CalendarExportPreview scheduleId={schedule.scheduleId} title={schedule.title || '일정'} startsAt={schedule.startsAt} allDay={schedule.allDay} dateKey={schedule.dateKey} /> : null}</View> : null}</View>);
}

function AuthAction({ title, variant, disabled = false, onPress }: { title: string; variant: 'google' | 'primary'; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled }} disabled={disabled} style={[styles.authAction, variant === 'google' ? styles.authGoogleAction : styles.authPrimaryAction, disabled ? styles.authActionDisabled : null]} onPress={onPress}>
    {variant === 'google' ? <Image accessible={false} source={require('../assets/google-g.png')} style={{ width: 20, height: 20 }} /> : null}
    <Text style={[styles.authActionText, variant === 'primary' ? styles.authPrimaryActionText : null]}>{title}</Text>
  </Pressable>;
}

function AuthModeSelector({ mode, onChange }: { mode: AuthMode; onChange: (mode: AuthMode) => void }) {
  return <View style={styles.authModeSelector}>
    <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'signIn' }} style={[styles.authModeChoice, mode === 'signIn' ? styles.authModeChoiceActive : null]} onPress={() => onChange('signIn')}>
      <Text style={[styles.authModeChoiceText, mode === 'signIn' ? styles.authModeChoiceTextActive : null]}>로그인</Text>
    </Pressable>
    <Pressable accessibilityRole="button" accessibilityState={{ selected: mode === 'signUp' }} style={[styles.authModeChoice, mode === 'signUp' ? styles.authModeChoiceActive : null]} onPress={() => onChange('signUp')}>
      <Text style={[styles.authModeChoiceText, mode === 'signUp' ? styles.authModeChoiceTextActive : null]}>무료 회원가입</Text>
    </Pressable>
  </View>;
}

function SettingsMenuItem({ eyebrow, title, description, onPress, accessibilityLabel, destructive = false }: { eyebrow: string; title: string; description: string; onPress: () => void; accessibilityLabel?: string; destructive?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel} style={[styles.settingsMenuItem, destructive ? styles.settingsMenuItemDestructive : null]} onPress={onPress}>
    <View style={styles.settingsMenuCopy}><Text style={styles.settingsMenuEyebrow}>{eyebrow}</Text><Text style={[styles.settingsMenuTitle, destructive ? styles.settingsMenuTitleDestructive : null]}>{title}</Text><Text style={styles.settingsMenuDescription}>{description}</Text></View>
    <Text style={[styles.settingsMenuChevron, destructive ? styles.settingsMenuTitleDestructive : null]}>›</Text>
  </Pressable>;
}

const ANDROID_TOUCH_SMOKE_MODE = process.env.EXPO_PUBLIC_ANDROID_TOUCH_SMOKE === '1';
// QA-only build switch: preserve the real PCM, Whisper, save, and refresh path
// while bypassing only the normal Android SpeechRecognizer preference.
const FORCE_WHISPER_FALLBACK_QA_MODE = process.env.EXPO_PUBLIC_FORCE_WHISPER_FALLBACK_QA === '1';
const ANDROID_TOUCH_SMOKE_PROVIDER = createConfiguredMobileTranscriptionProvider({
  provider: 'android-touch-smoke',
  async transcribe() { return { text: 'android touch smoke' }; },
});
const ANDROID_TOUCH_SMOKE_BRIEFING: MobileBriefing = {
  today: seoulTodayKey(), generatedAt: new Date().toISOString(), completeness: 'complete', mode: 'data_core', scheduleEnabled: true, counts: { overdue: 0, today: 1, upcoming: 0, undated: 0, total: 1 },
  // Synthetic build only: exercise the real compact schedule/task layout without user data.
  structure: { overdue: [], today: [{ pageId: '11111111-1111-4111-8111-111111111111', title: '검수용 업무: 일정과 알림 상태 확인', dueKey: seoulTodayKey(), dueTime: '10:00', status: '진행중' }], upcoming: [], undated: [] }, resurface: [], notes: [],
  schedules: { today: [{ scheduleId: '22222222-2222-4222-8222-222222222222', title: '검수용 일정: 긴 제목 줄바꿈과 알림 버튼 확인', startsAt: `${seoulTodayKey()}T10:00:00+09:00`, status: 'confirmed' }], upcoming: [], total: 1 },
};

function HomeHeader({ onOpenRecordSearch, onOpenSettings }: { onOpenRecordSearch: () => void; onOpenSettings: () => void }) {
  return <View style={styles.header}>
    <View style={styles.headerTitleWrap}><Text style={styles.eyebrow}>나의 개인 업무공간</Text><Text style={styles.headerTitle}>🎙 업무수첩</Text></View>
    <View style={styles.headerActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="과거 업무 검색" style={styles.headerButton} onPress={onOpenRecordSearch}><Text style={styles.headerButtonIcon}>⌕</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="설정 열기" style={styles.headerButton} onPress={onOpenSettings}><Text style={styles.headerButtonIcon}>⚙</Text></Pressable>
    </View>
  </View>;
}

export default function HomeScreen() {
  const { session } = usePlatform();
  return <HomeScreenApp androidTouchSmoke={ANDROID_TOUCH_SMOKE_MODE} key={session?.user.id || 'signed-out'} />;
}

function HomeScreenApp({ androidTouchSmoke = false }: { androidTouchSmoke?: boolean }) {
  const platform = usePlatform();
  const { error, authError, rememberedEmail, reload, clearAuthError, signIn, signUp, signInWithGoogle, signOut } = platform;
  const phase = platform.phase;
  const session = platform.session;
  const client = platform.client;
  const config = platform.config;
  const loadHomeBriefing = androidTouchSmoke ? async () => ANDROID_TOUCH_SMOKE_BRIEFING : loadBriefing;
  const loadHomeJournal = androidTouchSmoke ? async (_token: string, date: string): Promise<WorkJournalDay…28620 tokens truncated…= createRequire(new URL('../../mobile/package.json', import.meta.url));
const ts = require('typescript');
const source = readFileSync(new URL('../../mobile/app/index.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = ['taskNote', 'formatSchedule', 'ReminderShortcut', 'TaskRow', 'NoteRow', 'formatNoteJournalDate', 'ScheduleRows'];
const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name.text)).map(node => node.getText(ast)).join('\n');
const start = source.indexOf("{screen === 'home' ? <>") + "{screen === 'home' ? ".length;
const end = source.indexOf("\n    {screen === 'journal'", start);
const home = source.slice(start, end).trim().replace(/ : null\}$/, '');
const compiled = ts.transpileModule(`${declarations}\nfunction renderHome() { return (${home}); }\nreturn { renderHome, TaskRow };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;
export function homeHarness(context) {
 const states = []; let cursor = 0; let back; let cleanup;
 const node = (type, props, ...children) => ({ type, props: { ...props, children } });
 const base = { React: { createElement: node, Fragment: 'Fragment' }, View: 'View', Text: 'Text', Pressable: 'Pressable', Button: 'Button', ActivityIndicator: 'ActivityIndicator',
  useState(initial) { const i = cursor++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; },
  useEffect(fn) { cleanup?.(); cleanup = fn(); }, BackHandler: { addEventListener(_name, fn) { back = fn; return { remove() { back = null; } }; } },
  styles: new Proxy({}, { get: (_o, key) => key }), sectionToneStyles: {},
  CompactReminderLabel: props => node('Pressable', { onPress: props.onPress, accessibilityLabel: `${props.title} 알림 확인 필요` }, '알림 확인 필요'),
  ScheduleReminderLabel: props => node('Text', {}, '알림 확인 필요'), MeetingRecordingBanner: () => null,
  CalendarExportPreview: () => null,
  lastDirectSave: null, briefingInfo: { heading: '오늘의 브리핑', warnings: [] }, briefingBusy: false, briefingError: '', notificationScheduleId: null,
  briefingNow: 0, reminderTarget: null, upcomingExpanded: false, expandedBuckets: {}, taskBusyId: null, noteBusyId: null, notes: [], visibleNotes: [], extraNotes: 0,
  undoTask: null, undoPostpone: null, undoAttention: null, undoNote: null, message: '', overview: {},
  briefingBuckets: [{ key: 'today', label: '오늘', tone: 'warning' }, { key: 'overdue', label: '기한 지남', tone: 'danger' }, { key: 'upcoming', label: '다가오는 업무', tone: 'info' }, { key: 'undated', label: '기한 없는 업무', tone: 'neutral' }],
  refreshBriefing() {}, setScreen() {}, setReminderTarget() {}, setSelectedTask() {}, openTaskEditor() {}, confirmDeleteRecord() {}, completeTaskInline() {},
  ...context,
 };
 base.setTaskFilter = key => { base.activeFilter = key; };
 base.setUpcomingExpanded = update => { base.upcomingExpanded = update(base.upcomingExpanded); };
 base.setExpandedBuckets = update => { base.expandedBuckets = update(base.expandedBuckets); };
 const api = new Function('scope', `with(scope) { ${compiled} }`)(base);
 function expand(value) {
  if (Array.isArray(value)) return value.flatMap(expand);
  if (!value || typeof value !== 'object') return value;
  if (typeof value.type === 'function') return expand(value.type(value.props));
  return { ...value, props: { ...value.props, children: expand(value.props.children) } };
 }
 return { context: base, render() { cursor = 0; return expand(api.renderHome()); }, back() { return back?.(); } };
}
export function nodes(tree) { return Array.isArray(tree) ? tree.flatMap(nodes) : tree && typeof tree === 'object' ? [tree, ...nodes(tree.props?.children)] : []; }
export function words(tree) { return Array.isArray(tree) ? tree.map(words).join(' ') : tree && typeof tree === 'object' ? words(tree.props?.children) : String(tree ?? ''); }

