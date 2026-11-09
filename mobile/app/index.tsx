import type { ReactNode } from 'react';
import { CalendarSettings } from '@/src/features/settings/calendar-settings';
import { CalendarExportPreview } from '@/src/features/calendar/calendar-export-preview';
import { CaptureImportButton } from '@/src/features/capture/capture-import-button';
import { captureChanges } from '@/src/features/capture/capture-runtime';
import { firstNonEmptyTaskBucket, homeOverview } from '@/src/features/home/home-overview';
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
import Constants from 'expo-constants';
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
import { createManualWorkSaveSession } from '@/src/features/work/manual-work-save';
import { WorkRecordEditSheet } from '@/src/features/work/work-record-edit-sheet';
import { TaskReminderActions } from '@/src/features/work/task-reminder-actions';
import { cancelSavedScheduleReminders, recoverSavedScheduleReminders, synchronizeBriefingScheduleReminders, synchronizeSavedScheduleReminders, synchronizeUpdatedScheduleReminder, synchronizeEditedWorklogReminder } from '@/src/features/schedule/schedule-reminder-post-save';
import { markExactAlarmPermissionGuided, openExactAlarmPermissionSettings, shouldGuideExactAlarmPermission } from '@/src/features/schedule/local-notifications';
import { MOBILE_PATCH_NOTES } from '@/src/features/settings/patch-notes';
import { appBuildInfo } from '@/src/features/settings/app-build-info';
import { ReminderSettings } from '@/src/features/settings/reminder-settings';
import { createSerialTaskQueue } from '@/src/platform/serial-task-queue';
import { type BriefingNote, type BriefingSchedule, type BriefingTask, type MobileBriefing, type WorkJournalDay, type WorkJournalNote, type WorkJournalRecord, deleteWorklog, loadBriefing, loadWorkJournalDay, postponeWorklog, readWorklogDetails, saveWorklog, setWorklogAttention, undoPostponeWorklog, undoWorklogAttention, updateBriefingNoteState, updateWorklogDetails, updateWorklogStatus } from '@/src/platform/worklog-api';

import { getFreshAccessToken } from '@/src/platform/authenticated-access';
import { usePlatform } from '@/src/providers/platform-provider';
import type { PlatformSupabaseClient } from '@/src/platform/supabase';
import { mobileTheme } from '@/src/ui/theme';

const QUICK_VOICE_SPEECH_RECOGNITION = createExpoSpeechRecognitionAdapter();
const APP_BUILD_INFO = appBuildInfo(Constants.expoConfig);
type AppScreen = 'home' | 'journal' | 'recordSearch' | 'task' | 'input' | 'meeting' | 'settings' | 'reminderSettings' | 'patchNotes';
type BriefingBucket = 'overdue' | 'today' | 'upcoming' | 'undated';
type WorkStatus = '완료' | '진행중' | '대기' | '확인필요';
type AuthMode = 'signIn' | 'signUp';
type DirectSaveFeedback = Readonly<{
  recordId: string;
  transcript: string;
  scheduleDetected: boolean;
  scheduleCreated: boolean;
  scheduleId: string;
  dueStart: string;
  scheduleWarning: string;
}>;

function emptyManualWorkInput(): ManualWorkInputValue {
  return {
    transcript: '',
    dueDate: '',
    dueTime: '',
  };
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

const NETWORK_CONNECTION_MESSAGE = '서버에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.';

function messageOf(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  if (/UnknownHostException|Unable to resolve host|Network request failed|Failed to fetch|fetch failed|ENOTFOUND|EAI_AGAIN|ERR_NAME_NOT_RESOLVED|SocketTimeoutException|ETIMEDOUT/i.test(message)) return NETWORK_CONNECTION_MESSAGE;
  return message;
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

function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return <View style={styles.settingsGroup}>
    <Text accessibilityRole="header" style={styles.settingsGroupTitle}>{title}</Text>
    <View style={styles.settingsGroupCard}>{children}</View>
  </View>;
}

function SettingsMenuItem({ title, description, onPress, accessibilityLabel, destructive = false, expanded }: { title: string; description?: string; onPress: () => void; accessibilityLabel?: string; destructive?: boolean; expanded?: boolean }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} accessibilityState={expanded === undefined ? undefined : { expanded }} style={[styles.settingsMenuItem, destructive ? styles.settingsMenuItemDestructive : null]} onPress={onPress}>
    <View style={styles.settingsMenuCopy}>
      <Text style={[styles.settingsMenuTitle, destructive ? styles.settingsMenuTitleDestructive : null]}>{title}</Text>
      {description ? <Text style={styles.settingsMenuDescription}>{description}</Text> : null}
    </View>
    <Text accessibilityElementsHidden importantForAccessibility="no" style={[styles.settingsMenuChevron, destructive ? styles.settingsMenuTitleDestructive : null]}>{expanded ? '⌄' : '›'}</Text>
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

export default function HomeScreen({ initialScreen = 'home' }: { initialScreen?: 'home' | 'input' } = {}) {
  const { session } = usePlatform();
  return <HomeScreenApp androidTouchSmoke={ANDROID_TOUCH_SMOKE_MODE} initialScreen={initialScreen} key={session?.user.id || 'signed-out'} />;
}

function HomeScreenApp({ androidTouchSmoke = false, initialScreen = 'home' }: { androidTouchSmoke?: boolean; initialScreen?: 'home' | 'input' }) {
  const platform = usePlatform();
  const { error, authError, rememberedEmail, reload, clearAuthError, signIn, signUp, signInWithGoogle, signOut } = platform;
  const phase = platform.phase;
  const session = platform.session;
  const client = platform.client;
  const config = platform.config;
  const loadHomeBriefing = androidTouchSmoke ? async () => ANDROID_TOUCH_SMOKE_BRIEFING : loadBriefing;
  const loadHomeJournal = androidTouchSmoke ? async (_token: string, date: string): Promise<WorkJournalDay> => ({ targetDate: date, today: date, schedules: [], completed: [], notes: [], openTasks: [] }) : loadWorkJournalDay;
  const freshHomeAccessToken = androidTouchSmoke ? async (_client: PlatformSupabaseClient) => session?.access_token || 'android-touch-smoke-token' : getFreshAccessToken;
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signIn');
  const [manualInput, setManualInput] = useState<ManualWorkInputValue>(() => emptyManualWorkInput());
  // HomeScreenApp is keyed by user ID: retries never cross an account boundary.
  const manualSaveSession = useRef(createManualWorkSaveSession<Awaited<ReturnType<typeof saveWorklog>>>());
  const manualSaveInFlight = useRef(false);
  const [briefingNow, setBriefingNow] = useState(Date.now());
  useEffect(() => {
    const updateClock = () => setBriefingNow(Date.now());
    const timer = setInterval(updateClock, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') updateClock(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const [screen, applyScreen] = useState<AppScreen>(initialScreen);
  const [policyExpanded, setPolicyExpanded] = useState(false);
  useEffect(() => { if (screen !== 'settings') setPolicyExpanded(false); }, [screen]);
  const quickVoiceNavigation = useRef(false);
  function warnPendingVoice() {
    Alert.alert('음성 기록을 먼저 확인해주세요', '녹음을 마치고 전사문을 저장하거나 버리면 다른 화면으로 이동할 수 있습니다.');
  }
  function setScreen(next: AppScreen) {
    if (next !== 'home' && quickVoiceNavigation.current) { warnPendingVoice(); return; }
    applyScreen(next);
  }
  const [reminderTarget, setReminderTarget] = useState<ReminderTarget | null>(null);
  const [savedReminder, setSavedReminder] = useState<{ target: ReminderTarget; message: string } | null>(null);
  useEffect(() => { setReminderTarget(null); setSavedReminder(null); }, [session?.user.id]);
  const [selectedTask, setSelectedTask] = useState<{ bucket: BriefingBucket; task: BriefingTask } | null>(null);
  const [notificationScheduleId, setNotificationScheduleId] = useState<string | null>(null);
  const [scheduleFocusReason, setScheduleFocusReason] = useState<'notification' | 'created' | null>(null);
  const [message, setMessage] = useState('');
  const [messageTone, setMessageTone] = useState<'success' | 'error' | 'info'>('info');
  const [briefing, setBriefing] = useState<MobileBriefing | null>(null);
  const [journalDate, setJournalDate] = useState(() => seoulTodayKey());
  const [journal, setJournal] = useState<WorkJournalDay | null>(null);
  const [journalReloadKey, setJournalReloadKey] = useState(0);
  const [journalBusy, setJournalBusy] = useState(false);
  const [journalError, setJournalError] = useState('');
  const [briefingError, setBriefingError] = useState('');
  const [briefingBusy, setBriefingBusy] = useState(false);
  const briefingRefreshQueue = useRef(createSerialTaskQueue());
  const briefingRefreshEpoch = useRef(0);
  const initialReminderRecovery = useRef<Promise<unknown>>(Promise.resolve());
  const [busy, setBusy] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  // React state can lag behind rapid taps; block overlapping status writes immediately.
  const taskStatusInFlight = useRef(false);
  // Edit and soft-delete share a synchronous lock. React busy state alone
  // cannot prevent two writes before the first render completes.
  const recordMutationInFlight = useRef(false);
  // Use a synchronous lock: React busy state may not update before a second tap.
  const reminderMutationInFlight = useRef(false);
  const [undoTask, setUndoTask] = useState<{ pageId: string; status: WorkStatus; title: string; previousAttentionAt: string | null } | null>(null);
  const [reminderBusyId, setReminderBusyId] = useState<string | null>(null);
  const [undoPostpone, setUndoPostpone] = useState<{ pageId: string; title: string } | null>(null);
  const [undoAttention, setUndoAttention] = useState<{ pageId: string; title: string; appliedAttentionAt: string | null; previousAttentionAt: string | null } | null>(null);
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);
  const [undoNote, setUndoNote] = useState<{ pageId: string; title: string } | null>(null);
  const [editTaskId, setEditTaskId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editDate, setEditDate] = useState('');
  const [editTime, setEditTime] = useState('');
  const [editActionKind, setEditActionKind] = useState<'task' | 'note' | undefined>(undefined);
  const [editOriginalActionKind, setEditOriginalActionKind] = useState<'task' | 'note' | undefined>(undefined);
  const [editActionConversionAllowed, setEditActionConversionAllowed] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const editReadEpoch = useRef(0);
  const editDirty = useRef({ title: false, date: false, time: false, kind: false });
  useEffect(() => () => { editReadEpoch.current += 1; }, [session?.user.id]);
  const editDetailsCache = useRef(new Map<string, Awaited<ReturnType<typeof readWorklogDetails>>>());
  const [editReady, setEditReady] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [editStatusTone, setEditStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [expandedBuckets, setExpandedBuckets] = useState<Partial<Record<BriefingBucket, boolean>>>({});
  const [taskFilter, setTaskFilter] = useState<BriefingBucket | null>(null);
  const [upcomingExpanded, setUpcomingExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [patchNotesExpanded, setPatchNotesExpanded] = useState(false);
  const [lastDirectSave, setLastDirectSave] = useState<DirectSaveFeedback | null>(null);

  useEffect(() => { if (!email && rememberedEmail) setEmail(rememberedEmail); }, [email, rememberedEmail]);
  useEffect(() => {
    if (!session || !client) return;
    return captureChanges.subscribe(change => {
      if (change.owner !== session.user.id) return;
      if (!change.cancelled) {
        const today = seoulTodayKey();
        const bucket: BriefingBucket = !change.dueDate ? 'undated' : change.dueDate === today ? 'today' : change.dueDate < today ? 'overdue' : 'upcoming';
        setTaskFilter(bucket);
        setExpandedBuckets(current => ({ ...current, [bucket]: true }));
        setUpcomingExpanded(true);
      }
      void refreshBriefing();
    }, session.user.id);
  }, [client, session?.user.id, session?.access_token]);
  useEffect(() => {
    reminderSessionEpoch.invalidate();
    reminderSyncEpoch.invalidate();
    briefingRefreshEpoch.current += 1;
    briefingRefreshQueue.current.reset();
    if (!session) { quickVoiceNavigation.current = false; setBriefing(null); setJournal(null); setJournalDate(seoulTodayKey()); setScreen('home'); return; }
    if (androidTouchSmoke) void refreshBriefing();
    return () => { briefingRefreshEpoch.current += 1; briefingRefreshQueue.current.reset(); };
  }, [session?.access_token]);
  useEffect(() => {
    if (!session || !client || androidTouchSmoke) return;
    let alive = true;
    const recover = async () => {
      try { await recoverSavedScheduleReminders(client); }
      catch (nextError) { if (alive) console.warn('[schedule-reminder] recovery pending', messageOf(nextError, 'unknown')); }
      if (alive) setBriefingNow(Date.now());
    };
    const { data: authChanges } = client.auth.onAuthStateChange((event) => {
      if (event !== 'INITIAL_SESSION') { reminderSessionEpoch.invalidate(); reminderSyncEpoch.invalidate(); }
    });
    initialReminderRecovery.current = recover();
    void refreshBriefing();
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      initialReminderRecovery.current = recover();
      void refreshBriefing();
    });
    return () => { alive = false; reminderSessionEpoch.invalidate(); reminderSyncEpoch.invalidate(); authChanges.subscription.unsubscribe(); subscription.remove(); };
  }, [androidTouchSmoke, client, session?.access_token]);
  useEffect(() => {
    if (!session || !client || screen !== 'journal') return;
    let alive = true;
    setJournal(null);
    setJournalBusy(true);
    setJournalError('');
    void freshHomeAccessToken(client)
      .then((token) => loadHomeJournal(token, journalDate))
      .then((next) => { if (alive) setJournal(next); })
      .catch((nextError) => { if (alive) setJournalError(messageOf(nextError, '업무일지를 불러오지 못했습니다.')); })
      .finally(() => { if (alive) setJournalBusy(false); });
    return () => { alive = false; };
  }, [screen, journalDate, journalReloadKey, client, session?.access_token]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (quickVoic…11893 tokens truncated…'created' ? '✅ 방금 생성된 일정' : '🔔 알림에서 연 일정'}</Text><ScheduleRows key={`${briefingNow}:${Boolean(reminderTarget)}`} onReminder={(schedule) => setReminderTarget({ scheduleId: schedule.scheduleId, title: schedule.title || '일정' })} schedules={allSchedules.filter((schedule) => schedule.scheduleId === notificationScheduleId)} empty={scheduleFocusReason === 'created'
          ? '방금 저장한 일정이 현재 브리핑에 보이지 않습니다. 이 화면은 오늘과 14일 이내 일정만 보여주므로, 표시되지 않는다고 저장이 누락된 것은 아닙니다. 해당 날짜의 업무일지에서 확인해주세요.'
          : '알림에서 연 일정이 현재 브리핑에 보이지 않습니다. 목록을 새로고침하거나 해당 날짜의 업무일지에서 확인해주세요.'} /></View> : null}
        <View style={styles.scheduleGroup}><Text style={styles.detailTitle}>오늘</Text><ScheduleRows key={`${briefingNow}:${Boolean(reminderTarget)}`} onReminder={(schedule) => setReminderTarget({ scheduleId: schedule.scheduleId, title: schedule.title || '일정' })} schedules={briefing.schedules?.today?.filter(schedule => schedule.scheduleId !== notificationScheduleId)} empty={briefing.schedules?.today?.length ? '선택한 일정은 위에 표시했습니다.' : '오늘 확정 일정이 없습니다.'} /></View>
        <Pressable accessibilityRole="button" accessibilityState={{ expanded: upcomingExpanded }} onPress={() => setUpcomingExpanded(value => !value)}><Text style={styles.linkText}>다가오는 일정 {briefing.schedules?.upcoming?.length || 0}개 · {upcomingExpanded ? '접기' : '보기'}</Text></Pressable>
        {upcomingExpanded ? <View style={styles.scheduleGroup}><Text style={styles.detailTitle}>14일 이내</Text><ScheduleRows key={`${briefingNow}:${Boolean(reminderTarget)}`} onReminder={(schedule) => setReminderTarget({ scheduleId: schedule.scheduleId, title: schedule.title || '일정' })} schedules={briefing.schedules?.upcoming?.filter(schedule => schedule.scheduleId !== notificationScheduleId)} empty="다가오는 일정이 없습니다." /></View> : null}
      </View> : null}

      {overview.hasTasks ? <View style={styles.homeFilters}>{briefingBuckets.map(bucket => <Pressable key={bucket.key} accessibilityRole="button" accessibilityState={{ selected: activeFilter === bucket.key }} style={[styles.homeFilter, activeFilter === bucket.key ? styles.homeFilterActive : null]} onPress={() => setTaskFilter(bucket.key)}><Text>{bucket.label} {structure[bucket.key].length}</Text></Pressable>)}</View> : null}
      {briefing && overview.hasTasks ? briefingBuckets.filter(bucket => bucket.key === activeFilter).map((bucket) => {
        const tasks = structure[bucket.key] || [];
        const expanded = expandedBuckets[bucket.key] === true;
        const visibleTasks = expanded ? tasks : tasks.slice(0, 3);
        const extra = Math.max(0, tasks.length - 3);
        return <View key={bucket.key} style={[styles.briefingSection, sectionToneStyles[bucket.tone]]}>
          <View style={styles.briefingSectionHead}><Text style={styles.briefingSectionTitle}>{bucket.key === 'overdue' ? '🔴' : bucket.key === 'today' ? '🟠' : bucket.key === 'upcoming' ? '🔵' : '⚪'} {bucket.label}</Text><Text style={styles.sectionCount}>{tasks.length}</Text></View>
          {tasks.length ? visibleTasks.map((task, index) => <View key={task.pageId || `${bucket.key}-${index}`}>
            <TaskRow bucket={bucket.key} task={task} onOpen={() => { setSelectedTask({ bucket: bucket.key, task }); setScreen('task'); }} onReminder={() => setReminderTarget({ recordId: task.pageId, title: task.title || '업무' })} onEdit={() => void openTaskEditor(task)} onDelete={() => task.pageId ? confirmDeleteRecord(task.pageId, task.title || '업무', 'task') : undefined} onComplete={() => void completeTaskInline(task)} completing={taskBusyId === task.pageId} />
          </View>) : <Text style={styles.emptyText}>{bucket.key === 'today' ? '오늘 기한인 업무가 없습니다. 다른 기한은 위 필터에서 확인하세요.' : '이 기한의 업무가 없습니다.'}</Text>}
          {extra ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? `${bucket.label} 접기` : `${bucket.label} ${extra}개 더 보기`} style={styles.moreButton} onPress={() => setExpandedBuckets((value) => ({ ...value, [bucket.key]: !expanded }))}><Text style={styles.moreButtonText}>{expanded ? '접기' : `${extra}개 더 보기`}</Text></Pressable> : null}
        </View>;
      }) : null}

      {undoTask ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoTask.title} 완료 처리</Text><Pressable accessibilityRole="button" disabled={Boolean(taskBusyId)} onPress={() => void undoCompletedTask()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoPostpone ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoPostpone.title} 미루기</Text><Pressable accessibilityRole="button" disabled={Boolean(reminderBusyId)} onPress={() => void undoPostponedTask()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoAttention ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoAttention.title} 다시 알림</Text><Pressable accessibilityRole="button" disabled={Boolean(reminderBusyId)} onPress={() => void undoTaskAttention()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}

      {notes.length ? <View style={[styles.briefingSection, styles.sectionNeutral]}>
        <View style={styles.briefingSectionHead}><Text style={styles.briefingSectionTitle}>📝 메모 · 참고</Text><Text style={styles.sectionCount}>{notes.length}</Text></View>
        {visibleNotes.map((note, index) => <NoteRow key={note.pageId || `note-${index}`} note={note} onReminder={() => setReminderTarget({ recordId: note.pageId, title: note.title || '메모' })} onEdit={() => void openNoteEditor(note)} onDelete={() => note.pageId ? confirmDeleteRecord(note.pageId, note.title || '메모', 'note') : undefined} onAcknowledge={() => void acknowledgeNote(note)} acknowledging={noteBusyId === note.pageId} />)}
        {extraNotes ? <Pressable accessibilityRole="button" accessibilityLabel={notesExpanded ? '메모 · 참고 접기' : `메모 · 참고 ${extraNotes}개 더 보기`} style={styles.moreButton} onPress={() => setNotesExpanded((value) => !value)}><Text style={styles.moreButtonText}>{notesExpanded ? '접기' : `${extraNotes}개 더 보기`}</Text></Pressable> : null}
      </View> : null}

      {undoNote ? <View style={styles.undoBar}><Text style={styles.undoText}>메모를 브리핑에서 내렸습니다.</Text><Pressable accessibilityRole="button" disabled={Boolean(noteBusyId)} onPress={() => void undoAcknowledgedNote()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}



      {message ? <Text style={[styles.message, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}
      {message === NETWORK_CONNECTION_MESSAGE ? <Button title="연결 다시 확인" disabled={busy} onPress={() => { clearMessage(); void refreshBriefing(); }} /> : null}
    </> : null}

    {screen === 'journal' ? <View style={styles.journalScreen}>
      <PanelHead eyebrow="자동 기록" title="업무일지" onClose={() => setScreen('settings')} />
      <View style={styles.journalDateNav}>
        <Pressable accessibilityRole="button" accessibilityLabel="이전 날짜 업무일지" style={styles.journalNavButton} onPress={() => moveJournalDay(-1)}><Text style={styles.journalNavText}>‹ 이전</Text></Pressable>
        <View style={styles.journalDateTitleWrap}><Text style={styles.journalDateTitle}>{formatJournalDate(journalTarget)}</Text><Pressable accessibilityRole="button" disabled={journalTarget === journalToday} onPress={() => setJournalDate(seoulTodayKey())}><Text style={[styles.journalTodayLink, journalTarget === journalToday ? styles.journalTodayLinkDisabled : null]}>{journalTarget === journalToday ? '오늘' : '오늘로'}</Text></Pressable></View>
        <Pressable accessibilityRole="button" accessibilityLabel="다음 날짜 업무일지" style={styles.journalNavButton} onPress={() => moveJournalDay(1)}><Text style={styles.journalNavText}>다음 ›</Text></Pressable>
      </View>
      <Text style={styles.helpText}>{journalIsFuture ? '미래 날짜는 예정된 일정과 남은 업무를 미리 보여줍니다.' : '업무수첩에 기록된 내용을 날짜별로 자동 정리합니다.'}</Text>
      {journalBusy && !journal ? <View style={styles.loadingInline}><ActivityIndicator /><Text style={styles.statusText}>업무일지를 정리하는 중입니다.</Text></View> : null}
      {journalError ? <View style={styles.errorPanel}><Text style={styles.errorText}>{journalError}</Text><Button title="다시 시도" onPress={() => setJournalReloadKey((value) => value + 1)} /></View> : null}
      {journal ? <>
        <View style={styles.journalSection}><Text style={styles.journalSectionTitle}>📅 일정 · 미팅</Text><JournalScheduleRows schedules={journal.schedules} empty="이 날짜의 일정이 없습니다." /></View>
        <View style={styles.journalSection}><Text style={styles.journalSectionTitle}>✓ 한 일</Text><JournalRecordRows records={journal.completed} completed empty="완료된 업무 기록이 없습니다." /></View>
        <View style={styles.journalSection}><Text style={styles.journalSectionTitle}>📝 업무 중 확인사항</Text><JournalNoteRows notes={journal.notes} empty="기록된 메모·참고가 없습니다." /></View>
        <View style={styles.journalSection}><Text style={styles.journalSectionTitle}>{journalIsFuture ? '○ 예정' : '○ 남은 업무'}</Text><JournalRecordRows records={journal.openTasks} empty={journalIsFuture ? '이 날짜에 예정된 업무가 없습니다.' : '남아 있는 업무가 없습니다.'} /></View>
      </> : null}
    </View> : null}

    {screen === 'recordSearch' ? <View style={styles.card}><PanelHead eyebrow="업무" title="과거 기록 전체 검색" onClose={() => setScreen('home')} />{client ? <WorkRecordSearch client={client} accessToken={session.access_token} /> : <Text style={styles.errorText}>검색 세션을 확인하지 못했습니다. 다시 로그인해 주세요.</Text>}</View> : null}

    {screen === 'task' && selectedTask ? <View style={styles.card}><PanelHead eyebrow="업무 상세" title={selectedTask.task.title || '제목 없는 업무'} onClose={() => setScreen('home')} /><Text style={styles.taskMeta}>{taskNote(selectedTask.bucket, selectedTask.task)}{selectedTask.task.status ? ` · 현재 ${selectedTask.task.status}` : ''}</Text>{selectedTask.task.institution ? <Text style={styles.body}>{selectedTask.task.institution}</Text> : null}{selectedTask.task.followUp ? <Text style={styles.body}>다음 조치: {selectedTask.task.followUp}</Text> : null}<Text style={styles.detailTitle}>상태 변경</Text><View style={styles.statusActions}>{(['완료', '진행중', '대기', '확인필요'] as const).map((status) => <Pressable key={status} accessibilityRole="button" style={[styles.statusButton, selectedTask.task.status === status ? styles.statusButtonActive : null]} disabled={busy || selectedTask.task.status === status} onPress={() => void changeTaskStatus(status)}><Text style={styles.statusButtonText}>{status}</Text></Pressable>)}</View><Button title="알림 설정" onPress={() => setReminderTarget({ recordId: selectedTask.task.pageId, title: selectedTask.task.title || '업무' })} /><TaskReminderActions busy={reminderBusyId === selectedTask.task.pageId} hasAttention={Boolean(selectedTask.task.nextAttentionAt)} onPostpone={(date) => void postponeSelectedTask(date)} onAttention={(date) => void remindSelectedTask(date)} onClearAttention={() => void remindSelectedTask(null)} />{message ? <Text style={[styles.messageInline, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}</View> : null}

    {screen === 'input' ? <View style={styles.card}><PanelHead eyebrow="새 기록" title="직접 입력" onClose={() => setScreen('home')} /><ManualWorkInput value={manualInput} busy={busy} onChange={setManualInput} onSave={() => void persistDraft()} />{message ? <Text style={[styles.messageInline, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}</View> : null}
    {screen === 'meeting' ? <View style={styles.panel}><PanelHead eyebrow="장시간 녹음" title="회의 녹음" onClose={() => setScreen('home')} /><VoiceRecorderCard mode="meeting" /></View> : null}
    {screen === 'settings' ? <View style={styles.settingsPanel}>
      <PanelHead eyebrow="내 업무공간" title="설정" onClose={() => setScreen('home')} />
      <SettingsGroup title="기록">
        <SettingsMenuItem title="업무일지" accessibilityLabel="업무일지 열기" onPress={openJournal} />
        <SettingsMenuItem title="과거 업무 검색" onPress={() => setScreen('recordSearch')} />
      </SettingsGroup>
      <SettingsGroup title="알림">
        <SettingsMenuItem title="알림·리마인더" onPress={() => setScreen('reminderSettings')} />
      </SettingsGroup>
      <SettingsGroup title="외부 연결">
        <CalendarSettings />
      </SettingsGroup>
      <SettingsGroup title="앱 정보">
        <SettingsMenuItem title="업데이트·패치노트" onPress={() => { setPatchNotesExpanded(false); setScreen('patchNotes'); }} />
        <Text style={styles.settingsMeta}>{APP_BUILD_INFO.label}</Text>
        <SettingsMenuItem title="개인정보·계정 관리" expanded={policyExpanded} onPress={() => setPolicyExpanded(value => !value)} />
        {policyExpanded ? <View style={styles.settingsPolicyDetails}>
        <SettingsMenuItem title="개인정보처리방침" onPress={() => void Linking.openURL('https://worklog-voice-pwa.netlify.app/privacy.html').catch(() => Alert.alert('페이지 열기 실패', '잠시 후 다시 시도해주세요.'))} />
        <SettingsMenuItem title="계정 및 데이터 삭제 요청" onPress={() => void Linking.openURL('https://worklog-voice-pwa.netlify.app/account-deletion.html').catch(() => Alert.alert('페이지 열기 실패', '잠시 후 다시 시도해주세요.'))} />
        </View> : null}
      </SettingsGroup>
      <SettingsGroup title="계정">
        <View style={styles.settingsAccount}><Text selectable style={styles.body}>{session.user.email || '로그인 사용자'}</Text></View>
        <SettingsMenuItem title="로그아웃" destructive onPress={confirmSignOut} />
      </SettingsGroup>
    </View> : null}
    {screen === 'reminderSettings' ? <View style={styles.panel}><PanelHead eyebrow="설정" title="알림·리마인더" onClose={() => setScreen('settings')} /><ReminderSettings /></View> : null}
    {screen === 'patchNotes' ? <View style={styles.card}><PanelHead eyebrow="업데이트" title="패치노트" onClose={() => setScreen('settings')} /><Text style={styles.helpText}>{APP_BUILD_INFO.help}</Text><Text style={styles.body}>이 앱에 포함된 변경사항입니다. 최근 3건부터 확인할 수 있습니다.</Text>{MOBILE_PATCH_NOTES.slice(0, patchNotesExpanded ? undefined : 3).map((note) => <View key={`${note.date}-${note.title}`} style={styles.detailSection}><Text style={styles.meta}>{note.date}</Text><Text style={styles.detailTitle}>{note.title}</Text><Text style={styles.body}>{note.summary}</Text>{note.items.map((item) => <Text key={item} style={styles.patchNoteItem}>• {item}</Text>)}</View>)}{MOBILE_PATCH_NOTES.length > 3 ? <Pressable accessibilityRole="button" accessibilityLabel={patchNotesExpanded ? '이전 업데이트 접기' : `이전 업데이트 ${MOBILE_PATCH_NOTES.length - 3}건 더 보기`} style={styles.moreButton} onPress={() => setPatchNotesExpanded(value => !value)}><Text style={styles.moreButtonText}>{patchNotesExpanded ? '이전 업데이트 접기' : `이전 업데이트 ${MOBILE_PATCH_NOTES.length - 3}건 더 보기`}</Text></Pressable> : null}</View> : null}
  </ScrollView>
  {screen === 'home' ? <View pointerEvents="box-none" style={[styles.quickVoiceFooter, { paddingBottom: Math.max(insets.bottom, 8) }]}>
    <VoiceRecorderCard mode="quick" renderPhotoAction={disabled => <CaptureImportButton compact disabled={disabled} />} navigationGuard={quickVoiceNavigation} onOpenWorklogInput={(recognizedText) => {
      const recovered = recognizedText?.trim() || '';
      if (recovered) setManualInput((current) => current.transcript.trim() ? current : { ...current, transcript: recovered });
      setScreen('input');
    }} freezeQuickVoiceTimer={androidTouchSmoke} onQuickVoicePhaseChange={androidTouchSmoke ? (nextPhase) => console.info(`[android-touch-smoke] quick-voice-phase=${nextPhase}`) : undefined} quickVoice={{ ensureProvider: androidTouchSmoke ? async () => ANDROID_TOUCH_SMOKE_PROVIDER : prepareQuickVoiceWhisperProvider, speechRecognition: androidTouchSmoke || FORCE_WHISPER_FALLBACK_QA_MODE ? undefined : QUICK_VOICE_SPEECH_RECOGNITION, draftScope: session.user.id, saveWorklog: androidTouchSmoke ? async () => ({}) : async (transcript, options) => { if (!client) throw new Error('로그인 연결을 확인한 뒤 다시 시도해주세요.'); const reminderGuard = reminderSessionEpoch.capture(); const saved = await saveWorklog(await getFreshAccessToken(client), transcript, { ...options, sourceType: 'voice' }); let reminderMessage: string; try { const results = await synchronizeSavedScheduleReminders(saved, reminderGuard, client); reminderMessage = savedReminderMessage(results, saved.scheduleIds?.length || (saved.scheduleId ? 1 : 0)); } catch (nextError) { reminderMessage = reminderFailureMessage(nextError); } if (reminderGuard()) setSavedReminder({ target: { recordId: saved.dataCoreWorkRecordId || saved.pageId, scheduleId: saved.scheduleId, title: saved.cleanTranscript || transcript }, message: reminderMessage }); if (reminderGuard() && saved.scheduleId) { setNotificationScheduleId(saved.scheduleId); setScheduleFocusReason('created'); } return { reminderMessage, recordId: saved.dataCoreWorkRecordId || saved.pageId, scheduleDetected: Boolean(saved.scheduleDetected), scheduleCreated: Boolean(saved.scheduleCreated), scheduleId: saved.scheduleId || '', dueStart: saved.dueStart || '' }; }, refreshBriefing: refreshQuickVoiceBriefing }} />
  </View> : null}
    {client && reminderTarget ? <WorklogReminderSheet key={`${session.user.id}:${reminderTarget.scheduleId || reminderTarget.recordId}`} client={client} target={reminderTarget} onClose={() => setReminderTarget(null)} /> : null}
  <WorkRecordEditSheet
    allowTitleWhileLoading
    visible={Boolean(editTaskId)}
    title={editTitle}
    date={editDate}
    time={editTime}
    loading={editLoading}
    saving={editBusy}
    ready={editReady}
    actionKind={editActionKind}
    actionConversionAllowed={editActionConversionAllowed}
    statusText={editStatus}
    statusTone={editStatusTone}
    onTitle={(value) => { editDirty.current.title = true; setEditTitle(value); }}
    onDate={(value) => { editDirty.current.date = true; editDirty.current.time = true; setEditDate(value); }}
    onTime={(value) => { editDirty.current.time = true; editDirty.current.date = true; setEditTime(value); }}
    onActionKind={(value) => { editDirty.current.kind = true; setEditActionKind(value); }}
    onSave={() => void saveTaskEditor()}
    onCancel={closeTaskEditor}
    onRetry={() => void retryTaskEditor()}
  />
</View></KeyboardAvoidingView></View></HomeReminderStatus>;
}

function PanelHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <View style={styles.sectionHead}><View style={styles.sectionHeadText}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View><Pressable accessibilityRole="button" style={styles.closeButton} onPress={onClose}><Text style={styles.linkText}>닫기</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  summaryDate: { color: '#64748b', fontSize: 13, fontWeight: '600', letterSpacing: 1 },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  summaryTile: { flexGrow: 1, flexBasis: 80, borderRadius: 16, borderWidth: 1, padding: 12, gap: 10 },
  summaryNumber: { fontSize: 34, fontWeight: '800' },
  summaryUnit: { fontSize: 14, fontWeight: '600' },
  summaryLabel: { fontSize: 14, fontWeight: '700' },
  reminderHelp: { backgroundColor: '#f1f5f9', borderRadius: 12, padding: 12, gap: 6 },
  reminderHelpTitle: { fontSize: 15, color: '#334155', fontWeight: '700' },
  reminderHelpText: { fontSize: 14, color: '#475569' },
  homeFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  homeFilter: { minHeight: 44, justifyContent: 'center', padding: 10, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 12 },
  homeFilterActive: { backgroundColor: '#dbeafe', borderColor: '#2563eb' },
  page: { flex: 1, backgroundColor: mobileTheme.colors.background },
  flex: { flex: 1 },
  authenticatedShell: { flex: 1, position: 'relative' },
  contentScroll: { flex: 1 },
  quickVoiceFooter: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: mobileTheme.spacing.section, padding: 24, backgroundColor: mobileTheme.colors.background },
  scroll: { padding: mobileTheme.spacing.page, gap: mobileTheme.spacing.section, paddingBottom: 28 },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: mobileTheme.spacing.page, gap: mobileTheme.spacing.section },
  header: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 4 },
  headerTitleWrap: { flexGrow: 1, minWidth: 140 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#17191d', flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: { width: mobileTheme.size.touchTarget, height: mobileTheme.size.touchTarget, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 14, backgroundColor: mobileTheme.colors.surface },
  headerButtonIcon: { fontSize: 21 },
  loginHero: { gap: mobileTheme.spacing.compact, padding: mobileTheme.spacing.compact },
  welcomeCard: { gap: 8, padding: 18, borderRadius: mobileTheme.radius.card, backgroundColor: '#172b4d' },
  welcomeTitle: { fontSize: 21, fontWeight: '800', color: '#ffffff', lineHeight: 28 },
  welcomeBenefits: { gap: 7, paddingTop: 2 },
  welcomeBenefit: { color: '#e0e8f5', fontSize: 14, fontWeight: '700', lineHeight: 20 },
  card: { backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 14 },
  panel: { gap: 12 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1, color: '#5f6570' },
  title: { fontSize: 28, fontWeight: '800', color: mobileTheme.colors.text },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: mobileTheme.colors.text },
  body: { fontSize: 15, color: mobileTheme.colors.textSecondary, lineHeight: 22 },
  meta: { fontSize: 13, color: mobileTheme.colors.textMuted },
  statusText: { fontSize: 15, color: mobileTheme.colors.textSecondary },
  sectionHead: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  sectionHeadText: { flex: 1, minWidth: 0 },
  closeButton: { flexShrink: 0, minWidth: 48, alignItems: 'center' },
  linkText: { color: '#275daf', fontWeight: '800', padding: 8 },
  loadingInline: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 },
  errorPanel: { gap: 10 },
  saveFeedback: { gap: 8, padding: 14, borderRadius: mobileTheme.radius.control, backgroundColor: '#eef8f0', borderWidth: 1, borderColor: '#bbdfc2' },
  saveFeedbackHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  saveFeedbackEyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 0.7, color: mobileTheme.colors.textMuted },
  saveFeedbackTitle: { fontSize: 17, fontWeight: '800', color: mobileTheme.colors.success, marginTop: 2 },
  saveFeedbackClose: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link, padding: 6 },
  saveFeedbackText: { fontSize: 14, lineHeight: 20, color: mobileTheme.colors.text },
  saveFeedbackSchedule: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link, lineHeight: 19 },
  saveFeedbackMeta: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18 },
  saveFeedbackReminder: { gap: 6, borderTopWidth: 1, borderTopColor: '#bbdfc2', paddingTop: 8 },
  saveFeedbackReminderAction: { alignSelf: 'flex-start', minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#9fc6ae' },
  saveFeedbackReminderActionText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link },
  errorText: { color: mobileTheme.colors.danger, lineHeight: 20 },
  successText: { color: mobileTheme.colors.success, lineHeight: 20, backgroundColor: '#eaf4ea', padding: 10, borderRadius: mobileTheme.radius.compact },
  infoText: { color: mobileTheme.colors.textSecondary, lineHeight: 20, backgroundColor: mobileTheme.colors.neutralBackground, padding: 10, borderRadius: mobileTheme.radius.compact },
  emptyText: { color: mobileTheme.colors.textMuted, lineHeight: 20, paddingVertical: 4 },
  helpText: { fontSize: 12, color: mobileTheme.colors.textMuted, lineHeight: 18 },
  emptyAction: { gap: 10, paddingTop: 8 },
  actionGrid: { flexDirection: 'row', gap: 12 },
  actionCard: { flex: 1, minHeight: 132, borderRadius: 18, padding: 16, gap: 6, backgroundColor: '#fff' },
  actionIcon: { fontSize: 24 },
  actionTitle: { fontSize: 17, fontWeight: '800', color: '#17191d' },
  actionBody: { fontSize: 13, color: '#737985', lineHeight: 18 },
  journalScreen: { gap: 14 },
  journalDateNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 12, borderRadius: 16, backgroundColor: mobileTheme.colors.surface },
  journalNavButton: { minWidth: 68, minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: '#fff' },
  journalNavText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link },
  journalDateTitleWrap: { flex: 1, alignItems: 'center', gap: 3 },
  journalDateTitle: { fontSize: 17, fontWeight: '800', color: mobileTheme.colors.text, textAlign: 'center' },
  journalTodayLink: { fontSize: 12, fontWeight: '800', color: mobileTheme.colors.link, paddingHorizontal: 8, paddingVertical: 3 },
  journalTodayLinkDisabled: { color: mobileTheme.colors.textMuted },
  journalSection: { gap: 8, padding: 14, borderRadius: 18, backgroundColor: mobileTheme.colors.surface, borderWidth: 1, borderColor: mobileTheme.colors.border },
  journalSectionTitle: { fontSize: 17, fontWeight: '800', color: mobileTheme.colors.text },
  journalRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 9, borderTopWidth: 1, borderTopColor: 'rgba(107,114,128,0.12)' },
  journalBullet: { width: 22, fontSize: 16, fontWeight: '900', color: mobileTheme.colors.textSecondary, textAlign: 'center', paddingTop: 1 },
  journalTime: { width: 48, fontSize: 13, fontWeight: '800', color: mobileTheme.colors.link, paddingTop: 2 },
  detailSection: { gap: 8, borderTopWidth: 1, borderTopColor: '#eceef1', paddingTop: 16 },
  detailTitle: { fontSize: 16, fontWeight: '800', color: '#17191d' },
  briefingSection: { borderWidth: 1, borderRadius: 18, padding: 14, gap: 8 },
  sectionDanger: { backgroundColor: mobileTheme.colors.overdueBackground, borderColor: mobileTheme.colors.overdueBorder },
  sectionWarning: { backgroundColor: mobileTheme.colors.todayBackground, borderColor: mobileTheme.colors.todayBorder },
  sectionInfo: { backgroundColor: mobileTheme.colors.upcomingBackground, borderColor: mobileTheme.colors.upcomingBorder },
  sectionNeutral: { backgroundColor: mobileTheme.colors.neutralBackground, borderColor: mobileTheme.colors.neutralBorder },
  briefingSectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  briefingSectionTitle: { fontSize: 17, fontWeight: '800', color: '#1f2937' },
  moreButton: { minHeight: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: '#d1d5db', backgroundColor: '#fff' },
  moreButtonText: { fontSize: 12, fontWeight: '800', color: '#374151' },
  sectionCount: { minWidth: 26, height: 26, textAlign: 'center', textAlignVertical: 'center', borderRadius: 13, overflow: 'hidden', backgroundColor: '#e5e7eb', color: '#374151', fontSize: 12, fontWeight: '800' },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(107,114,128,0.15)' },
  focusTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(107,114,128,0.15)' },
  focusMetaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  focusReason: { fontSize: 13, fontWeight: '800', color: '#9a3412', lineHeight: 18 },
  focusStatus: { fontSize: 11, fontWeight: '800', color: '#374151', backgroundColor: '#e5e7eb', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  taskMain: { flex: 1, minWidth: 0, gap: 3 },
  taskActions: { flexShrink: 0, gap: 6, alignItems: 'stretch' },
  focusTaskActions: { flexShrink: 0, gap: 6, alignItems: 'stretch' },
  taskMinorActions: { flexDirection: 'row', gap: 6 },
  taskTitle: { fontSize: 15, fontWeight: '700', color: '#30343b', lineHeight: 21 },
  taskMeta: { fontSize: 13, color: '#737985', lineHeight: 18 },
  taskBadge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', color: '#374151', backgroundColor: '#e5e7eb', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  followUp: { fontSize: 13, color: '#4b515c', lineHeight: 18 },
  reminderShortcut: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 11, marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: '#93b5e6', backgroundColor: '#eaf3ff' },
  reminderShortcutText: { color: '#20599a', fontSize: 12, fontWeight: '900' },
  inlineEdit: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  inlineEditText: { fontSize: 18 },
  inlineDelete: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff7f7', borderWidth: 1, borderColor: '#fecaca' },
  inlineDeleteText: { color: mobileTheme.colors.danger, fontSize: 12, fontWeight: '900' },
  inlineComplete: { minHeight: 48, minWidth: 60, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#111827' },
  inlineCompleteBusy: { opacity: 0.55 },
  inlineCompleteText: { color: '#fff', fontSize: 12, fontWeight: '800' },
  undoBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12, borderRadius: 14, backgroundColor: '#111827' },
  undoText: { flex: 1, color: '#fff', fontSize: 13, fontWeight: '700' },
  undoAction: { color: '#fff', fontSize: 13, fontWeight: '900', textDecorationLine: 'underline' },
  notificationFocus: { gap: 8, padding: 10, borderRadius: 12, backgroundColor: '#eff6ff' },
  scheduleGroup: { gap: 8, paddingTop: 6 },
  statusActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  statusButton: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 1, borderColor: '#cfd5dd', borderRadius: 12, backgroundColor: '#fff' },
  statusButtonActive: { backgroundColor: '#e8f0fe', borderColor: '#275daf' },
  statusButtonText: { fontSize: 14, fontWeight: '700', color: '#30343b' },
  scheduleRow: { gap: 3, borderLeftWidth: 3, borderLeftColor: '#80a9e8', paddingLeft: 10, paddingVertical: 5 },
  scheduleDate: { fontSize: 13, fontWeight: '700', color: '#275daf' },
  input: { minHeight: mobileTheme.size.input, borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: mobileTheme.radius.control, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: mobileTheme.colors.surface },
  multiline: { minHeight: 150 },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  passwordInput: { flex: 1 },
  passwordToggle: { minWidth: 58, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d7dae0', borderRadius: 12, backgroundColor: '#fff' },
  passwordToggleText: { fontSize: 14, fontWeight: '700', color: '#30343b' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e1e4e8' },
  dividerText: { fontSize: 12, fontWeight: '700', color: '#8a9099' },
  signUpCard: { borderWidth: 2, borderColor: '#9cc3ff', backgroundColor: '#f8fbff' },
  authModeSelector: { flexDirection: 'row', gap: 8, padding: 4, borderRadius: 14, backgroundColor: '#eef1f5' },
  authModeChoice: { flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 10, borderRadius: 11 },
  authModeChoiceActive: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#9bb9e8' },
  authModeChoiceText: { color: '#667085', fontSize: 14, fontWeight: '800' },
  authModeChoiceTextActive: { color: '#1d4f91' },
  authModeIntro: { gap: 5, paddingVertical: 2 },
  authModeEyebrow: { color: '#5273a6', fontSize: 12, fontWeight: '900', letterSpacing: 0.7 },
  authAction: { width: '100%', minHeight: 52, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, borderRadius: mobileTheme.radius.control, borderWidth: 1 },
  authGoogleAction: { borderColor: '#747775', backgroundColor: '#ffffff' },
  authPrimaryAction: { minHeight: 56, borderColor: mobileTheme.colors.primary, backgroundColor: mobileTheme.colors.primary },
  authActionDisabled: { opacity: 0.5 },
  authActionText: { color: mobileTheme.colors.text, fontSize: 15, fontWeight: '800' },
  authPrimaryActionText: { color: mobileTheme.colors.primaryText, fontSize: 16 },
  authModeSwitch: { alignSelf: 'center', minHeight: 40, justifyContent: 'center', paddingHorizontal: 8 },
  authModeSwitchText: { color: mobileTheme.colors.link, fontSize: 14, fontWeight: '800', textAlign: 'center', textDecorationLine: 'underline' },
  authHint: { fontSize: 12, color: '#737985', lineHeight: 18 },
  settingsPanel: { gap: mobileTheme.spacing.section, paddingBottom: mobileTheme.spacing.page },
  settingsGroup: { gap: 8 },
  settingsGroupTitle: { color: mobileTheme.colors.textSecondary, fontSize: 13, fontWeight: '800', paddingHorizontal: 4 },
  settingsGroupCard: { backgroundColor: mobileTheme.colors.surface, borderRadius: 16, borderWidth: 1, borderColor: mobileTheme.colors.borderSubtle, overflow: 'hidden' },
  settingsAccount: { padding: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mobileTheme.colors.borderSubtle },
  settingsMenuItem: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mobileTheme.colors.borderSubtle },
  settingsMenuItemDestructive: { backgroundColor: '#fff7f7' },
  settingsMenuCopy: { flex: 1, minWidth: 0, gap: 3 },
  settingsMenuTitle: { color: mobileTheme.colors.text, fontSize: 16, fontWeight: '800' },
  settingsMenuTitleDestructive: { color: mobileTheme.colors.danger },
  settingsMenuDescription: { color: mobileTheme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  settingsMenuChevron: { color: mobileTheme.colors.link, fontSize: 26, fontWeight: '400' },
  settingsPolicyDetails: { backgroundColor: mobileTheme.colors.neutralBackground },
  settingsMeta: { color: mobileTheme.colors.textMuted, fontSize: 12, padding: 14, lineHeight: 18 },
  patchNoteItem: { fontSize: 14, color: '#4b515c', lineHeight: 21 },
  message: { padding: 14, borderRadius: 12, backgroundColor: '#eaf4ea', color: '#245c2a', lineHeight: 20 },
  messageInline: { padding: 12, borderRadius: 10, backgroundColor: '#eaf4ea', color: '#245c2a', lineHeight: 20 },
  messageError: { backgroundColor: '#fff0f0', color: mobileTheme.colors.danger },
  messageInfo: { backgroundColor: mobileTheme.colors.neutralBackground, color: mobileTheme.colors.textSecondary },
});

const sectionToneStyles = {
  danger: styles.sectionDanger,
  warning: styles.sectionWarning,
  info: styles.sectionInfo,
  neutral: styles.sectionNeutral,
};
