import { briefingMetadata } from '@/src/platform/briefing-metadata';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Button, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { VoiceRecorderCard } from '@/src/features/voice/voice-recorder-card';
import { MeetingRecordingBanner } from '@/src/features/voice/meeting-recording-banner';
import { prepareQuickVoiceWhisperProvider } from '@/src/features/voice/providers/whisper-rn-quick-voice-runtime';
import { WorkRecordSearch } from '@/src/features/search/work-record-search';
import { ManualWorkInput, type ManualWorkInputValue } from '@/src/features/work/manual-work-input';
import { WorkRecordEditSheet } from '@/src/features/work/work-record-edit-sheet';
import { TaskReminderActions } from '@/src/features/work/task-reminder-actions';
import { ScheduleDeviceActions } from '@/src/features/schedule/schedule-device-actions';
import { CalendarConnectionSummary } from '@/src/features/schedule/calendar-connection-summary';
import { CalendarConnectionManager } from '@/src/features/schedule/calendar-connection-manager';
import { reconcileCanceledScheduleArtifacts } from '@/src/features/schedule/schedule-cancellation';
import { reconcileCalendarEventCleanup } from '@/src/features/schedule/device-calendar';
import { reconcileScheduleReminders } from '@/src/features/schedule/local-notifications';
import { MOBILE_PATCH_NOTES } from '@/src/features/settings/patch-notes';
import { createSerialTaskQueue } from '@/src/platform/serial-task-queue';
import { type BriefingNote, type BriefingSchedule, type BriefingTask, type MobileBriefing, type WorkJournalDay, type WorkJournalNote, type WorkJournalRecord, loadBriefing, loadWorkJournalDay, postponeWorklog, readWorklogDetails, saveWorklog, setWorklogAttention, undoPostponeWorklog, updateBriefingNoteState, updateWorklogDetails, updateWorklogStatus } from '@/src/platform/worklog-api';
import { usePlatform } from '@/src/providers/platform-provider';
import { mobileTheme } from '@/src/ui/theme';

type AppScreen = 'home' | 'journal' | 'recordSearch' | 'task' | 'input' | 'meeting' | 'settings' | 'scheduleSettings' | 'patchNotes';
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
    institution: '기타',
    status: '진행중',
    type: '기타',
    amount: '',
    assignee: '',
    dueDate: '',
    followUp: '',
  };
}

const briefingBuckets: Array<{ key: BriefingBucket; label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }> = [
  { key: 'overdue', label: '지난 것', tone: 'danger' },
  { key: 'today', label: '오늘 할 일', tone: 'warning' },
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

function focusBucket(task: BriefingTask, today: string): BriefingBucket {
  if (task.dueKey && task.dueKey < today) return 'overdue';
  if (task.dueKey === today) return 'today';
  if (task.dueKey && task.dueKey > today) return 'upcoming';
  return 'undated';
}

function focusReason(task: BriefingTask, today: string) {
  if (task.reason === 'attention') return '다시 확인할 시간';
  if (task.reason === 'today' || task.dueKey === today) return '오늘까지';
  if (task.reason === 'overdue' || (task.dueKey && task.dueKey < today)) {
    const days = task.daysOverdue || Math.max(1, Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${task.dueKey}T00:00:00Z`)) / 86_400_000));
    return `${days}일 지남`;
  }
  return '확인이 필요한 업무';
}

function FocusTaskRow({ task, today, onOpen, onComplete, completing = false }: { task: BriefingTask; today: string; onOpen: () => void; onComplete: () => void; completing?: boolean }) {
  return <View style={styles.focusTaskRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '제목 없는 업무'} 상세 보기`} style={styles.taskMain} onPress={onOpen}>
      <Text style={styles.taskTitle}>{task.title || '제목 없는 업무'}</Text>
      <View style={styles.focusMetaLine}><Text style={styles.focusReason}>{focusReason(task, today)}</Text>{task.status ? <Text style={styles.focusStatus}>{task.status}</Text> : null}</View>
      {task.institution ? <Text style={styles.taskBadge}>{task.institution}</Text> : null}
    </Pressable>
    {task.pageId ? <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '업무'} 완료 처리`} disabled={completing} style={[styles.inlineComplete, completing ? styles.inlineCompleteBusy : null]} onPress={onComplete}><Text style={styles.inlineCompleteText}>{completing ? '처리 중' : '완료'}</Text></Pressable> : null}
  </View>;
}

function TaskRow({ bucket, task, onOpen, onEdit, onComplete, completing = false }: { bucket: BriefingBucket; task: BriefingTask; onOpen: () => void; onEdit?: () => void; onComplete?: () => void; completing?: boolean }) {
  return <View style={styles.taskRow}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '제목 없는 업무'} 상세 보기`} style={styles.taskMain} onPress={onOpen}>
      <Text style={styles.taskTitle}>{task.title || '제목 없는 업무'}</Text>
      <Text style={styles.taskMeta}>{taskNote(bucket, task)}{task.status ? ` · ${task.status}` : ''}</Text>
      {task.institution ? <Text style={styles.taskBadge}>{task.institution}</Text> : null}
      {task.followUp ? <Text style={styles.followUp}>↳ {task.followUp}</Text> : null}
    </Pressable>
    {task.pageId ? <View style={styles.taskActions}>
      {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '업무'} 수정`} disabled={completing} style={styles.inlineEdit} onPress={onEdit}><Text style={styles.inlineEditText}>✏️</Text></Pressable> : null}
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

function NoteRow({ note, onEdit, onAcknowledge, acknowledging = false }: { note: BriefingNote; onEdit?: () => void; onAcknowledge: () => void; acknowledging?: boolean }) {
  return <View style={styles.taskRow}>
    <View style={styles.taskMain}>
      <Text style={styles.taskTitle}>{note.title || '제목 없는 메모'}</Text>
      {formatNoteJournalDate(note.journalDate) ? <Text style={styles.taskMeta}>{formatNoteJournalDate(note.journalDate)}</Text> : null}
      {note.institution ? <Text style={styles.taskBadge}>{note.institution}</Text> : null}
    </View>
    {note.pageId ? <View style={styles.taskActions}>
      {onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${note.title || '메모'} 수정`} disabled={acknowledging} style={styles.inlineEdit} onPress={onEdit}><Text style={styles.inlineEditText}>✏️</Text></Pressable> : null}
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

function ScheduleRows({ schedules, empty, showDeviceActions = false, showDeviceStatus = false }: { schedules?: BriefingSchedule[]; empty: string; showDeviceActions?: boolean; showDeviceStatus?: boolean }) {
  if (!schedules?.length) return <Text style={styles.emptyText}>{empty}</Text>;
  return schedules.map((schedule, index) => <View key={schedule.scheduleId || `${schedule.title}-${index}`} style={styles.scheduleRow}><Text style={styles.scheduleDate}>{formatSchedule(schedule)}</Text><Text style={styles.taskTitle}>{schedule.title || '제목 없는 일정'}</Text>{schedule.location ? <Text style={styles.taskMeta}>{schedule.location}</Text> : null}{showDeviceActions ? <ScheduleDeviceActions schedule={schedule} /> : showDeviceStatus ? <ScheduleDeviceActions schedule={schedule} compactOnly /> : null}</View>);
}

function AuthAction({ title, variant, disabled = false, onPress }: { title: string; variant: 'google' | 'primary' | 'secondary'; disabled?: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" disabled={disabled} style={[styles.authAction, variant === 'google' ? styles.authGoogleAction : variant === 'primary' ? styles.authPrimaryAction : styles.authSecondaryAction, disabled ? styles.authActionDisabled : null]} onPress={onPress}>
    <Text style={[styles.authActionText, variant === 'primary' ? styles.authPrimaryActionText : null]}>{title}</Text>
  </Pressable>;
}

function SettingsMenuItem({ eyebrow, title, description, onPress, destructive = false }: { eyebrow: string; title: string; description: string; onPress: () => void; destructive?: boolean }) {
  return <Pressable accessibilityRole="button" style={[styles.settingsMenuItem, destructive ? styles.settingsMenuItemDestructive : null]} onPress={onPress}>
    <View style={styles.settingsMenuCopy}><Text style={styles.settingsMenuEyebrow}>{eyebrow}</Text><Text style={[styles.settingsMenuTitle, destructive ? styles.settingsMenuTitleDestructive : null]}>{title}</Text><Text style={styles.settingsMenuDescription}>{description}</Text></View>
    <Text style={[styles.settingsMenuChevron, destructive ? styles.settingsMenuTitleDestructive : null]}>›</Text>
  </Pressable>;
}

export default function HomeScreen() {
  const { phase, session, error, authError, rememberedEmail, reload, clearAuthError, signIn, signUp, signInWithGoogle, signOut, config, client } = usePlatform();
  const insets = useSafeAreaInsets();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('signIn');
  const [manualInput, setManualInput] = useState<ManualWorkInputValue>(() => emptyManualWorkInput());
  const [briefingNow, setBriefingNow] = useState(Date.now());
  useEffect(() => {
    const updateClock = () => setBriefingNow(Date.now());
    const timer = setInterval(updateClock, 60_000);
    const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') updateClock(); });
    return () => { clearInterval(timer); subscription.remove(); };
  }, []);
  const [screen, applyScreen] = useState<AppScreen>('home');
  const quickVoiceNavigation = useRef(false);
  function warnPendingVoice() {
    Alert.alert('음성 기록을 먼저 확인해주세요', '녹음을 마치고 전사문을 저장하거나 버리면 다른 화면으로 이동할 수 있습니다.');
  }
  function setScreen(next: AppScreen) {
    if (next !== 'home' && quickVoiceNavigation.current) { warnPendingVoice(); return; }
    applyScreen(next);
  }
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
  const [busy, setBusy] = useState(false);
  const [taskBusyId, setTaskBusyId] = useState<string | null>(null);
  const [undoTask, setUndoTask] = useState<{ pageId: string; status: WorkStatus; title: string } | null>(null);
  const [reminderBusyId, setReminderBusyId] = useState<string | null>(null);
  const [undoPostpone, setUndoPostpone] = useState<{ pageId: string; title: string } | null>(null);
  const [undoAttention, setUndoAttention] = useState<{ pageId: string; title: string; previousAttentionAt: string | null } | null>(null);
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
  const [editReady, setEditReady] = useState(false);
  const [editStatus, setEditStatus] = useState('');
  const [editStatusTone, setEditStatusTone] = useState<'neutral' | 'success' | 'error'>('neutral');
  const [expandedBuckets, setExpandedBuckets] = useState<Partial<Record<BriefingBucket, boolean>>>({});
  const [focusExpanded, setFocusExpanded] = useState(false);
  const [notesExpanded, setNotesExpanded] = useState(false);
  const [lastDirectSave, setLastDirectSave] = useState<DirectSaveFeedback | null>(null);
  const [calendarConnectionVersion, setCalendarConnectionVersion] = useState(0);
  const [quickDockHeight, setQuickDockHeight] = useState(220);

  useEffect(() => { if (!email && rememberedEmail) setEmail(rememberedEmail); }, [email, rememberedEmail]);
  useEffect(() => {
    briefingRefreshEpoch.current += 1;
    briefingRefreshQueue.current.reset();
    if (!session) { quickVoiceNavigation.current = false; setBriefing(null); setJournal(null); setJournalDate(seoulTodayKey()); setScreen('home'); return; }
    void refreshBriefing();
  }, [session?.access_token]);
  useEffect(() => {
    if (!session || screen !== 'journal') return;
    const token = session.access_token;
    let alive = true;
    setJournal(null);
    setJournalBusy(true);
    setJournalError('');
    void loadWorkJournalDay(token, journalDate)
      .then((next) => { if (alive) setJournal(next); })
      .catch((nextError) => { if (alive) setJournalError(messageOf(nextError, '업무일지를 불러오지 못했습니다.')); })
      .finally(() => { if (alive) setJournalBusy(false); });
    return () => { alive = false; };
  }, [screen, journalDate, journalReloadKey, session?.access_token]);

  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (quickVoiceNavigation.current) { warnPendingVoice(); return true; }
      if (screen === 'home') return false;
      setScreen('home');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);
  useEffect(() => {
    const openSchedule = (data: unknown) => {
      const payload = data as { target?: unknown; scheduleId?: unknown };
      if (payload?.target !== 'schedule' || typeof payload.scheduleId !== 'string') return false;
      setNotificationScheduleId(payload.scheduleId);
      setScheduleFocusReason('notification');
      setScreen('home');
      showMessage('알림에서 연 일정을 홈의 일정 영역에 표시했습니다.', 'info');
      return true;
    };

    const handleNotificationResponse = async (response: Notifications.NotificationResponse | null) => {
      if (!response) return;
      openSchedule(response.notification.request.content.data);
      // Expo retains this response across a cold start unless the app consumes it.
      await Notifications.clearLastNotificationResponseAsync();
    };

    // All three reconcilers read and rewrite device mappings. Keep this order
    // deterministic: server-confirmed schedule cancellation first, then
    // Calendar rollback artifacts, then reminder restoration/cleanup.
    if (client && session) {
      void (async () => {
        await reconcileCanceledScheduleArtifacts(client);
        const calendarRecovery = await reconcileCalendarEventCleanup();
        const reminderRecovery = await reconcileScheduleReminders();
        if (calendarRecovery.remaining || reminderRecovery.failed || reminderRecovery.pending || reminderRecovery.untracked) {
          showMessage('일부 캘린더·알림은 복구 또는 확인이 필요합니다. 일정별 상태와 다시 확인 버튼을 확인해주세요.', 'error');
        }
      })().catch((error) => showMessage(messageOf(error, '기기 일정 복구를 완료하지 못했습니다.'), 'error'));
    }
    void Notifications.getLastNotificationResponseAsync().then(handleNotificationResponse).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => { void handleNotificationResponse(response); });
    return () => subscription.remove();
  }, [client, session?.access_token]);

  function showMessage(text: string, tone: 'success' | 'error' | 'info' = 'info') {
    setMessage(text);
    setMessageTone(tone);
  }

  function clearMessage() {
    setMessage('');
    setMessageTone('info');
  }

  async function run(action: () => Promise<void>) {
    setBusy(true); clearMessage();
    try { await action(); } catch (nextError) { showMessage(messageOf(nextError, '처리 중 오류가 발생했습니다.'), 'error'); } finally { setBusy(false); }
  }

  function openJournal() {
    setJournalDate(seoulTodayKey());
    setScreen('journal');
  }

  function moveJournalDay(days: number) {
    setJournalDate((current) => shiftDateKey(current, days));
  }

  async function refreshBriefing() {
    if (!session) return;
    const accessToken = session.access_token;
    const epoch = briefingRefreshEpoch.current;
    await briefingRefreshQueue.current.run(async () => {
      if (epoch !== briefingRefreshEpoch.current) return;
      setBriefingBusy(true);
      setBriefingError('');
      try {
        const next = await loadBriefing(accessToken);
        if (epoch === briefingRefreshEpoch.current) setBriefing(next);
      } catch (nextError) {
        if (epoch === briefingRefreshEpoch.current) setBriefingError(messageOf(nextError, '브리핑을 불러오지 못했습니다.'));
      } finally {
        if (epoch === briefingRefreshEpoch.current) setBriefingBusy(false);
      }
    });
  }

  async function runEmailSignIn() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password || busy) return;
    if (authMode === 'signUp' && password.length < 8) {
      showMessage('가입용 비밀번호는 8자 이상 입력해주세요.', 'error');
      return;
    }
    await run(async () => {
      if (authMode === 'signIn') {
        await signIn(normalizedEmail, password);
        return;
      }
      const outcome = await signUp(normalizedEmail, password);
      if (outcome === 'confirmationRequired') showMessage('가입 확인 이메일을 보냈습니다. 이메일을 확인한 뒤 로그인해 주세요.', 'success');
    });
  }

  async function persistDraft() {
    if (!session || !manualInput.transcript.trim() || busy) return;
    const original = manualInput.transcript.trim();
    const amountText = manualInput.amount.trim().replaceAll(',', '');
    const amount = amountText ? Number(amountText) : null;
    if (amountText && (!Number.isFinite(amount) || Number(amount) < 0)) {
      showMessage('금액은 0 이상의 숫자로 입력해주세요.', 'error');
      return;
    }
    await run(async () => {
      const saved = await saveWorklog(session.access_token, original, {
        institution: manualInput.institution,
        institutionSource: 'user_selected',
        status: manualInput.status,
        type: manualInput.type,
        amount,
        assignee: manualInput.assignee,
        dueDate: manualInput.dueDate,
        followUp: manualInput.followUp,
      });
      const feedback = {
        transcript: saved.cleanTranscript?.trim() || original,
        scheduleDetected: Boolean(saved.scheduleDetected),
        scheduleCreated: Boolean(saved.scheduleCreated),
        scheduleId: saved.scheduleId?.trim() || '',
        dueStart: saved.dueStart?.trim() || '',
      };
      setManualInput(emptyManualWorkInput());
      setLastDirectSave(feedback);
      if (feedback.scheduleId) { setNotificationScheduleId(feedback.scheduleId); setScheduleFocusReason('created'); }
      const dueLabel = formatSavedDue(feedback.dueStart);
      showMessage(feedback.scheduleCreated
        ? `업무 저장 완료 · 일정 생성됨${dueLabel ? ` · ${dueLabel}` : ''}`
        : '업무 저장 완료 · 브리핑에 반영했습니다.', 'success');
      setScreen('home');
      await refreshBriefing();
    });
  }

  async function changeTaskStatus(status: '완료' | '진행중' | '대기' | '확인필요') {
    if (!session || !selectedTask?.task.pageId || busy) return;
    await run(async () => {
      await updateWorklogStatus(session.access_token, selectedTask.task.pageId!, status);
      showMessage(`업무 상태를 ${status}(으)로 변경했습니다.`, 'success');
      setSelectedTask(null); setScreen('home');
      await refreshBriefing();
    });
  }

  async function completeTaskInline(task: BriefingTask) {
    if (!session || !task.pageId || taskBusyId) return;
    const previousStatus: WorkStatus = task.status === '대기' || task.status === '확인필요' || task.status === '진행중' ? task.status : '진행중';
    setTaskBusyId(task.pageId);
    clearMessage();
    try {
      await updateWorklogStatus(session.access_token, task.pageId, '완료');
      setUndoTask({ pageId: task.pageId, status: previousStatus, title: task.title || '업무' });
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '업무 완료 처리에 실패했습니다.'), 'error');
    } finally {
      setTaskBusyId(null);
    }
  }

  async function undoCompletedTask() {
    if (!session || !undoTask || taskBusyId) return;
    setTaskBusyId(undoTask.pageId);
    clearMessage();
    try {
      await updateWorklogStatus(session.access_token, undoTask.pageId, undoTask.status);
      showMessage(`${undoTask.title} 완료 처리를 되돌렸습니다.`, 'success');
      setUndoTask(null);
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '완료 처리를 되돌리지 못했습니다.'), 'error');
    } finally {
      setTaskBusyId(null);
    }
  }

  async function postponeSelectedTask(date: string) {
    const task = selectedTask?.task;
    if (!session || !task?.pageId || reminderBusyId) return;
    setReminderBusyId(task.pageId);
    clearMessage();
    try {
      const current = await readWorklogDetails(session.access_token, task.pageId);
      await postponeWorklog(session.access_token, { pageId: task.pageId, dueDate: date, dueTime: current.dueTime });
      setUndoPostpone({ pageId: task.pageId, title: task.title || '업무' });
      setSelectedTask(null);
      setScreen('home');
      showMessage(`${task.title || '업무'} 기한을 ${date}로 미뤘습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '업무를 미루지 못했습니다.'), 'error');
    } finally {
      setReminderBusyId(null);
    }
  }

  async function remindSelectedTask(date: string | null) {
    const task = selectedTask?.task;
    if (!session || !task?.pageId || reminderBusyId) return;
    setReminderBusyId(task.pageId);
    clearMessage();
    try {
      const result = await setWorklogAttention(session.access_token, task.pageId, date ? `${date}T09:00:00+09:00` : null);
      setUndoAttention({ pageId: task.pageId, title: task.title || '업무', previousAttentionAt: result.previousAttentionAt || null });
      setSelectedTask(null);
      setScreen('home');
      showMessage(date ? `${task.title || '업무'}을(를) ${date}에 다시 확인합니다.` : `${task.title || '업무'}의 다시 알림을 취소했습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '다시 알림을 변경하지 못했습니다.'), 'error');
    } finally {
      setReminderBusyId(null);
    }
  }

  async function undoPostponedTask() {
    if (!session || !undoPostpone || reminderBusyId) return;
    const target = undoPostpone;
    setReminderBusyId(target.pageId);
    clearMessage();
    try {
      await undoPostponeWorklog(session.access_token, target.pageId);
      setUndoPostpone(null);
      showMessage(`${target.title} 미루기를 되돌렸습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '미루기를 되돌리지 못했습니다.'), 'error');
    } finally {
      setReminderBusyId(null);
    }
  }

  async function undoTaskAttention() {
    if (!session || !undoAttention || reminderBusyId) return;
    const target = undoAttention;
    setReminderBusyId(target.pageId);
    clearMessage();
    try {
      await setWorklogAttention(session.access_token, target.pageId, target.previousAttentionAt);
      setUndoAttention(null);
      showMessage(`${target.title} 다시 알림을 되돌렸습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '다시 알림을 되돌리지 못했습니다.'), 'error');
    } finally {
      setReminderBusyId(null);
    }
  }

  async function loadTaskEditorDetails(pageId: string, fallbackTitle = '', fallbackDate = '') {
    if (!session || editBusy || editLoading) return;
    setEditLoading(true);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
    try {
      const details = await readWorklogDetails(session.access_token, pageId);
      setEditTitle(details.title || fallbackTitle);
      setEditDate(details.dueDate || fallbackDate);
      setEditTime(details.dueTime || '');
      setEditActionKind(details.actionKind);
      setEditOriginalActionKind(details.actionKind);
      setEditActionConversionAllowed(details.actionConversionAllowed === true);
      setEditReady(true);
    } catch (nextError) {
      setEditStatus(messageOf(nextError, '현재 업무 정보를 불러오지 못했습니다.'));
      setEditStatusTone('error');
    } finally {
      setEditLoading(false);
    }
  }

  function removeVisibleNote(recordId: string) {
    setBriefing((current) => current
      ? { ...current, notes: (current.notes || []).filter((note) => note.pageId !== recordId) }
      : current);
  }

  async function acknowledgeNote(note: BriefingNote) {
    if (!session || !note.pageId || noteBusyId) return;
    setNoteBusyId(note.pageId);
    clearMessage();
    try {
      await updateBriefingNoteState(session.access_token, note.pageId, 'acknowledged');
      removeVisibleNote(note.pageId);
      setUndoNote({ pageId: note.pageId, title: note.title || '메모' });
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '메모 확인 처리에 실패했습니다.'), 'error');
    } finally {
      setNoteBusyId(null);
    }
  }

  async function undoAcknowledgedNote() {
    if (!session || !undoNote || noteBusyId) return;
    const target = undoNote;
    setNoteBusyId(target.pageId);
    clearMessage();
    try {
      await updateBriefingNoteState(session.access_token, target.pageId, 'active');
      setUndoNote(null);
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '메모 확인 처리를 되돌리지 못했습니다.'), 'error');
    } finally {
      setNoteBusyId(null);
    }
  }

  async function openTaskEditor(task: BriefingTask) {
    if (!session || !task.pageId || editBusy || editLoading) return;
    setEditTaskId(task.pageId);
    setEditTitle(task.title || '');
    setEditDate(task.dueKey || '');
    setEditTime('');
    setEditActionKind(undefined);
    setEditOriginalActionKind(undefined);
    setEditActionConversionAllowed(false);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
    await loadTaskEditorDetails(task.pageId, task.title || '', task.dueKey || '');
  }

  async function openNoteEditor(note: BriefingNote) {
    if (!session || !note.pageId || editBusy || editLoading) return;
    setEditTaskId(note.pageId);
    setEditTitle(note.title || '');
    setEditDate('');
    setEditTime('');
    setEditActionKind('note');
    setEditOriginalActionKind(undefined);
    setEditActionConversionAllowed(false);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
    await loadTaskEditorDetails(note.pageId, note.title || '', '');
  }

  async function retryTaskEditor() {
    if (!editTaskId) return;
    await loadTaskEditorDetails(editTaskId, editTitle, editDate);
  }

  function updateVisibleTaskTitle(recordId: string, nextTitle: string) {
    setBriefing((current) => {
      if (!current?.structure) return current;
      const structure = { ...current.structure };
      for (const bucket of briefingBuckets) {
        const tasks = structure[bucket.key];
        if (Array.isArray(tasks)) {
          structure[bucket.key] = tasks.map((task) => task.pageId === recordId ? { ...task, title: nextTitle } : task);
        }
      }
      const notes = (current.notes || []).map((note) => note.pageId === recordId ? { ...note, title: nextTitle } : note);
      return { ...current, structure, notes };
    });
    setSelectedTask((current) => current?.task.pageId === recordId
      ? { ...current, task: { ...current.task, title: nextTitle } }
      : current);
  }

  function removeVisibleRecordForConversion(recordId: string) {
    setBriefing((current) => {
      if (!current) return current;
      const structure = { ...(current.structure || {}) };
      for (const bucket of briefingBuckets) {
        const tasks = structure[bucket.key];
        if (Array.isArray(tasks)) {
          structure[bucket.key] = tasks.filter((task) => task.pageId !== recordId);
        }
      }
      return {
        ...current,
        structure,
        notes: (current.notes || []).filter((note) => note.pageId !== recordId),
      };
    });
  }

  async function saveTaskEditor() {
    if (!session || !editTaskId || editBusy || editLoading || !editReady) return;
    const recordId = editTaskId;
    const nextTitle = editTitle.replace(/\s+/g, ' ').trim();
    if (!nextTitle) {
      setEditStatus('업무명을 입력해주세요.');
      setEditStatusTone('error');
      return;
    }
    if (nextTitle.length > 160) {
      setEditStatus('업무명은 160자 이하로 입력해주세요.');
      setEditStatusTone('error');
      return;
    }
    if (editTime.trim() && !editDate.trim()) {
      setEditStatus('시간을 설정하려면 날짜도 입력해주세요.');
      setEditStatusTone('error');
      return;
    }
    setEditBusy(true);
    setEditStatus('');
    setEditStatusTone('neutral');
    try {
      const result = await updateWorklogDetails(session.access_token, {
        pageId: recordId,
        title: nextTitle,
        dueDate: editDate.trim(),
        dueTime: editTime.trim(),
        ...(editActionConversionAllowed && editActionKind && editOriginalActionKind && editActionKind !== editOriginalActionKind
          ? { actionKind: editActionKind }
          : {}),
      });
      const visibleTitle = result.title?.trim() || nextTitle;
      if (result.actionKindChanged) removeVisibleRecordForConversion(recordId);
      else updateVisibleTaskTitle(recordId, visibleTitle);
      setEditBusy(false);
      setEditReady(false);
      setEditStatus(result.actionKindChanged
        ? result.actionKind === 'note'
          ? '✓ 메모 · 참고로 변경했습니다.'
          : '✓ 할 일로 변경했습니다.'
        : result.unchanged
          ? '변경된 내용이 없습니다.'
          : result.scheduleUpdated
            ? '✓ 업무와 연결된 일정도 수정했습니다.'
            : '✓ 업무를 수정했습니다.');
      setEditStatusTone(result.unchanged && !result.actionKindChanged ? 'neutral' : 'success');
      await new Promise((resolve) => setTimeout(resolve, 420));
      setEditTaskId(null);
      setEditStatus('');
      setEditStatusTone('neutral');
      await refreshBriefing();
    } catch (nextError) {
      setEditStatus(messageOf(nextError, '업무 수정에 실패했습니다.'));
      setEditStatusTone('error');
    } finally {
      setEditBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(
      '로그아웃',
      '이 기기에서 현재 업무수첩 계정 세션을 종료할까요?',
      [
        { text: '취소', style: 'cancel' },
        { text: '로그아웃', style: 'destructive', onPress: () => { void run(signOut); } },
      ],
    );
  }

  function closeTaskEditor() {
    if (editBusy) return;
    setEditTaskId(null);
    setEditTitle('');
    setEditDate('');
    setEditTime('');
    setEditActionKind(undefined);
    setEditOriginalActionKind(undefined);
    setEditActionConversionAllowed(false);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
  }

  if (phase === 'loading') return <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}><ActivityIndicator size="large" /><Text style={styles.statusText}>업무수첩을 연결하고 있습니다.</Text></View>;
  if (phase === 'error') return <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}><Text style={styles.title}>연결을 확인해주세요</Text><Text style={styles.errorText}>{error}</Text><Button title="다시 시도" onPress={reload} /></View>;

  if (!session) return <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><StatusBar style="dark" /><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView contentContainerStyle={[styles.loginScroll, { paddingBottom: 20 + insets.bottom }]} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
    <View style={styles.loginHero}><Text style={styles.eyebrow}>나의 개인 업무공간</Text><Text style={styles.title}>🎙 업무수첩</Text><Text style={styles.body}>말하면 기록되고, 일정까지 한눈에</Text></View>
    <View style={styles.welcomeCard}><Text style={styles.welcomeTitle}>업무를 놓치지 않는{`\n`}개인 업무수첩</Text><Text style={styles.body}>복잡한 설정 없이 계정만 만들면 바로 시작할 수 있습니다.</Text><View style={styles.welcomeBenefits}><Text style={styles.welcomeBenefit}>🎙 말하거나 직접 입력</Text><Text style={styles.welcomeBenefit}>📅 오늘·다가오는 일정 확인</Text><Text style={styles.welcomeBenefit}>✓ 저장 후 브리핑에서 바로 확인</Text></View></View>
    <View style={styles.card}><Text style={styles.sectionTitle}>{authMode === 'signIn' ? '내 업무공간' : '무료로 시작하기'}</Text><Text style={styles.body}>Google 계정으로 가장 빠르게 시작할 수 있습니다.</Text><AuthAction title="Google로 시작" variant="google" disabled={busy} onPress={() => void run(signInWithGoogle)} /><View style={styles.dividerRow}><View style={styles.dividerLine} /><Text style={styles.dividerText}>또는 이메일로</Text><View style={styles.dividerLine} /></View><TextInput accessibilityLabel="이메일" autoCapitalize="none" autoComplete="email" autoCorrect={false} importantForAutofill="yes" keyboardType="email-address" placeholder="name@example.com" returnKeyType="next" style={styles.input} textContentType="username" value={email} onChangeText={(value) => { setEmail(value); clearAuthError(); }} /><View style={styles.passwordRow}><TextInput accessibilityLabel="비밀번호" autoCapitalize="none" autoComplete={authMode === 'signUp' ? 'new-password' : 'current-password'} autoCorrect={false} importantForAutofill="yes" placeholder={authMode === 'signUp' ? '8자 이상' : '비밀번호'} returnKeyType="done" secureTextEntry={!showPassword} style={[styles.input, styles.passwordInput]} textContentType={authMode === 'signUp' ? 'newPassword' : 'password'} value={password} onChangeText={(value) => { setPassword(value); clearAuthError(); }} onSubmitEditing={() => void runEmailSignIn()} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} hitSlop={8} style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}><Text style={styles.passwordToggleText}>{showPassword ? '숨기기' : '보기'}</Text></Pressable></View><View style={styles.authActions}><AuthAction title={busy ? '처리 중...' : authMode === 'signIn' ? '로그인' : '무료로 시작'} variant="primary" disabled={busy || !email.trim() || !password} onPress={() => void runEmailSignIn()} /><AuthAction title={authMode === 'signIn' ? '무료로 시작' : '로그인'} variant="secondary" disabled={busy} onPress={() => { setAuthMode((value) => value === 'signIn' ? 'signUp' : 'signIn'); clearMessage(); clearAuthError(); }} /></View><Text style={styles.authHint}>{authMode === 'signIn' ? '이메일은 마지막 사용 계정을 기억합니다. 비밀번호 원문은 앱에 저장하지 않고 휴대폰 비밀번호 관리자/자동완성을 사용합니다.' : '가입하면 개인 업무공간이 자동으로 만들어집니다. 이메일 확인이 필요할 수 있습니다.'}</Text>{message || authError ? <Text style={authError || messageTone === 'error' ? styles.errorText : messageTone === 'success' ? styles.successText : styles.infoText}>{authError || message}</Text> : null}</View></ScrollView></KeyboardAvoidingView></View>;

  const briefingInfo = briefing ? briefingMetadata(briefing, briefingNow) : null;
  const journalTarget = journal?.targetDate || journalDate;
  const journalToday = journal?.today || seoulTodayKey();
  const journalIsFuture = journalTarget > journalToday;
  const structure = briefing?.structure || {};
  const focusTasks = briefing?.resurface || [];
  const visibleFocusTasks = focusExpanded ? focusTasks : focusTasks.slice(0, 3);
  const extraFocusTasks = Math.max(0, focusTasks.length - 3);
  const notes = briefing?.notes || [];
  const visibleNotes = notesExpanded ? notes : notes.slice(0, 3);
  const extraNotes = Math.max(0, notes.length - 3);
  const allSchedules = [...(briefing?.schedules?.today || []), ...(briefing?.schedules?.upcoming || [])];

  return <View style={[styles.page, { paddingTop: insets.top }]}><StatusBar style="dark" /><View style={styles.authenticatedShell}><ScrollView style={styles.contentScroll} contentContainerStyle={[styles.scroll, { paddingBottom: screen === 'home' ? quickDockHeight + 32 : 28 }]} keyboardShouldPersistTaps="handled"><View style={styles.header}><View style={styles.headerTitleWrap}><Text style={styles.eyebrow}>나의 개인 업무공간</Text><Text style={styles.headerTitle}>🎙 업무수첩</Text></View><View style={styles.headerActions}><Pressable accessibilityRole="button" accessibilityLabel="업무일지 열기" style={styles.headerButton} onPress={openJournal}><Text style={styles.headerButtonIcon}>📒</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="과거 업무 검색" style={styles.headerButton} onPress={() => setScreen('recordSearch')}><Text style={styles.headerButtonIcon}>⌕</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="설정 열기" style={styles.headerButton} onPress={() => setScreen('settings')}><Text style={styles.headerButtonIcon}>⚙</Text></Pressable></View></View>
    {screen === 'home' ? <>
      <MeetingRecordingBanner onOpen={() => setScreen('meeting')} />
      {lastDirectSave ? <View style={styles.saveFeedback}>
        <View style={styles.saveFeedbackHead}><View><Text style={styles.saveFeedbackEyebrow}>직접 입력 저장 결과</Text><Text style={styles.saveFeedbackTitle}>✅ 업무 저장 완료</Text></View><Pressable accessibilityRole="button" onPress={() => setLastDirectSave(null)}><Text style={styles.saveFeedbackClose}>닫기</Text></Pressable></View>
        <Text style={styles.saveFeedbackText}>{lastDirectSave.transcript}</Text>
        {lastDirectSave.scheduleCreated ? <Text style={styles.saveFeedbackSchedule}>📅 일정 생성 완료{formatSavedDue(lastDirectSave.dueStart) ? ` · ${formatSavedDue(lastDirectSave.dueStart)}` : ''}</Text> : <Text style={styles.saveFeedbackMeta}>일정으로 해석된 날짜·시간은 없습니다.</Text>}
      </View> : null}

      <View style={styles.card}>
        <View style={styles.sectionHead}><View style={styles.sectionHeadText}><Text style={styles.eyebrow}>{briefingInfo?.heading || '오늘의 브리핑'}</Text><Text style={styles.sectionTitle}>지금 확인할 것</Text></View><Pressable accessibilityRole="button" onPress={() => void refreshBriefing()}><Text style={styles.linkText}>{briefingBusy ? '정리 중…' : '새로고침'}</Text></Pressable></View>
        {briefingInfo ? <View accessibilityLiveRegion="polite"><Text style={styles.helpText}>{briefingInfo.meta}</Text>{briefingInfo.warnings.map((warning) => <Text key={warning} style={styles.errorText}>{warning}</Text>)}</View> : null}
        {briefingBusy && !briefing ? <View style={styles.loadingInline}><ActivityIndicator /><Text style={styles.statusText}>오늘 업무를 불러오는 중입니다.</Text></View> : null}
        {briefingError ? <View style={styles.errorPanel}><Text style={styles.errorText}>{briefingError}</Text><Button title="다시 시도" onPress={() => void refreshBriefing()} /></View> : null}
        {briefing ? focusTasks.length ? visibleFocusTasks.map((task, index) => <FocusTaskRow key={task.pageId || `focus-${index}`} task={task} today={briefing.today || seoulTodayKey()} onOpen={() => { setSelectedTask({ bucket: focusBucket(task, briefing.today || seoulTodayKey()), task }); setScreen('task'); }} onComplete={() => void completeTaskInline(task)} completing={taskBusyId === task.pageId} />) : <Text style={styles.emptyText}>지금 확인할 업무가 없습니다.</Text> : null}
        {briefing && extraFocusTasks ? <Pressable accessibilityRole="button" accessibilityLabel={focusExpanded ? '지금 확인할 것 접기' : `지금 확인할 것 ${extraFocusTasks}개 더 보기`} style={styles.moreButton} onPress={() => setFocusExpanded((value) => !value)}><Text style={styles.moreButtonText}>{focusExpanded ? '접기' : `${extraFocusTasks}개 더 보기`}</Text></Pressable> : null}
      </View>

      {briefing ? briefingBuckets.map((bucket) => {
        const tasks = structure[bucket.key] || [];
        const expanded = expandedBuckets[bucket.key] === true;
        const visibleTasks = expanded ? tasks : tasks.slice(0, 3);
        const extra = Math.max(0, tasks.length - 3);
        return <View key={bucket.key} style={[styles.briefingSection, sectionToneStyles[bucket.tone]]}>
          <View style={styles.briefingSectionHead}><Text style={styles.briefingSectionTitle}>{bucket.key === 'overdue' ? '🔴' : bucket.key === 'today' ? '🟠' : bucket.key === 'upcoming' ? '🔵' : '⚪'} {bucket.label}</Text><Text style={styles.sectionCount}>{tasks.length}</Text></View>
          {tasks.length ? visibleTasks.map((task, index) => <View key={task.pageId || `${bucket.key}-${index}`}>
            <TaskRow bucket={bucket.key} task={task} onOpen={() => { setSelectedTask({ bucket: bucket.key, task }); setScreen('task'); }} onEdit={() => void openTaskEditor(task)} onComplete={() => void completeTaskInline(task)} completing={taskBusyId === task.pageId} />
          </View>) : <Text style={styles.emptyText}>해당 업무가 없습니다.</Text>}
          {extra ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? `${bucket.label} 접기` : `${bucket.label} ${extra}개 더 보기`} style={styles.moreButton} onPress={() => setExpandedBuckets((value) => ({ ...value, [bucket.key]: !expanded }))}><Text style={styles.moreButtonText}>{expanded ? '접기' : `${extra}개 더 보기`}</Text></Pressable> : null}
        </View>;
      }) : null}

      {undoTask ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoTask.title} 완료 처리</Text><Pressable accessibilityRole="button" disabled={Boolean(taskBusyId)} onPress={() => void undoCompletedTask()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoPostpone ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoPostpone.title} 미루기</Text><Pressable accessibilityRole="button" disabled={Boolean(reminderBusyId)} onPress={() => void undoPostponedTask()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoAttention ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoAttention.title} 다시 알림</Text><Pressable accessibilityRole="button" disabled={Boolean(reminderBusyId)} onPress={() => void undoTaskAttention()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}

      {notes.length ? <View style={[styles.briefingSection, styles.sectionNeutral]}>
        <View style={styles.briefingSectionHead}><Text style={styles.briefingSectionTitle}>📝 메모 · 참고</Text><Text style={styles.sectionCount}>{notes.length}</Text></View>
        {visibleNotes.map((note, index) => <NoteRow key={note.pageId || `note-${index}`} note={note} onEdit={() => void openNoteEditor(note)} onAcknowledge={() => void acknowledgeNote(note)} acknowledging={noteBusyId === note.pageId} />)}
        {extraNotes ? <Pressable accessibilityRole="button" accessibilityLabel={notesExpanded ? '메모 · 참고 접기' : `메모 · 참고 ${extraNotes}개 더 보기`} style={styles.moreButton} onPress={() => setNotesExpanded((value) => !value)}><Text style={styles.moreButtonText}>{notesExpanded ? '접기' : `${extraNotes}개 더 보기`}</Text></Pressable> : null}
      </View> : null}

      {undoNote ? <View style={styles.undoBar}><Text style={styles.undoText}>메모를 브리핑에서 내렸습니다.</Text><Pressable accessibilityRole="button" disabled={Boolean(noteBusyId)} onPress={() => void undoAcknowledgedNote()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}

      {briefing?.scheduleEnabled ? <View style={styles.card}>
        <View style={styles.sectionHead}><View style={styles.sectionHeadText}><Text style={styles.eyebrow}>📅 일정</Text><Text style={styles.sectionTitle}>오늘과 다가오는 일정</Text></View><View style={styles.headerActions}><Pressable accessibilityRole="button" onPress={() => setScreen('scheduleSettings')}><Text style={styles.linkText}>알림·캘린더 설정</Text></Pressable><Pressable accessibilityRole="button" onPress={() => setScreen('input')}><Text style={styles.linkText}>+ 새 일정</Text></Pressable></View></View>
        <CalendarConnectionSummary compact refreshKey={calendarConnectionVersion} onPressManage={() => setScreen('scheduleSettings')} />
        {notificationScheduleId ? <View style={styles.notificationFocus}><Text style={styles.detailTitle}>{scheduleFocusReason === 'created' ? '✅ 방금 생성된 일정' : '🔔 알림에서 연 일정'}</Text><ScheduleRows schedules={allSchedules.filter((schedule) => schedule.scheduleId === notificationScheduleId)} empty="연결된 일정을 찾지 못했습니다." showDeviceStatus /></View> : null}
        <View style={styles.scheduleGroup}><Text style={styles.detailTitle}>오늘</Text><ScheduleRows schedules={briefing.schedules?.today} empty="오늘 확정 일정이 없습니다." showDeviceStatus /></View>
        <View style={styles.scheduleGroup}><Text style={styles.detailTitle}>14일 이내</Text><ScheduleRows schedules={briefing.schedules?.upcoming} empty="다가오는 일정이 없습니다." showDeviceStatus /></View>
      </View> : null}

      <View style={styles.actionGrid}><Pressable accessibilityRole="button" style={styles.actionCard} onPress={() => setScreen('meeting')}><Text style={styles.actionIcon}>⏺</Text><Text style={styles.actionTitle}>회의 녹음</Text><Text style={styles.actionBody}>긴 회의 · 일시정지 · 화면 잠금</Text></Pressable><Pressable accessibilityRole="button" style={styles.actionCard} onPress={() => setScreen('input')}><Text style={styles.actionIcon}>⌨</Text><Text style={styles.actionTitle}>직접 입력</Text><Text style={styles.actionBody}>업무를 바로 저장</Text></Pressable></View>
      {message ? <Text style={[styles.message, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}
    </> : null}

    {screen === 'journal' ? <View style={styles.journalScreen}>
      <PanelHead eyebrow="자동 기록" title="업무일지" onClose={() => setScreen('home')} />
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

    {screen === 'task' && selectedTask ? <View style={styles.card}><PanelHead eyebrow="업무 상세" title={selectedTask.task.title || '제목 없는 업무'} onClose={() => setScreen('home')} /><Text style={styles.taskMeta}>{taskNote(selectedTask.bucket, selectedTask.task)}{selectedTask.task.status ? ` · 현재 ${selectedTask.task.status}` : ''}</Text>{selectedTask.task.institution ? <Text style={styles.body}>{selectedTask.task.institution}</Text> : null}{selectedTask.task.followUp ? <Text style={styles.body}>다음 조치: {selectedTask.task.followUp}</Text> : null}<Text style={styles.detailTitle}>상태 변경</Text><View style={styles.statusActions}>{(['완료', '진행중', '대기', '확인필요'] as const).map((status) => <Pressable key={status} accessibilityRole="button" style={[styles.statusButton, selectedTask.task.status === status ? styles.statusButtonActive : null]} disabled={busy || selectedTask.task.status === status} onPress={() => void changeTaskStatus(status)}><Text style={styles.statusButtonText}>{status}</Text></Pressable>)}</View><TaskReminderActions busy={reminderBusyId === selectedTask.task.pageId} hasAttention={Boolean(selectedTask.task.nextAttentionAt)} onPostpone={(date) => void postponeSelectedTask(date)} onAttention={(date) => void remindSelectedTask(date)} onClearAttention={() => void remindSelectedTask(null)} />{message ? <Text style={[styles.messageInline, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}</View> : null}

    {screen === 'input' ? <View style={styles.card}><PanelHead eyebrow="새 기록" title="직접 입력" onClose={() => setScreen('home')} /><Text style={styles.body}>웹 업무수첩처럼 업무 내용과 필요한 세부값을 한 화면에서 저장합니다.</Text><ManualWorkInput value={manualInput} busy={busy} onChange={setManualInput} onSave={() => void persistDraft()} />{message ? <Text style={[styles.messageInline, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}</View> : null}
    {screen === 'meeting' ? <View style={styles.panel}><PanelHead eyebrow="장시간 녹음" title="회의 녹음" onClose={() => setScreen('home')} /><VoiceRecorderCard mode="meeting" /></View> : null}
    {screen === 'settings' ? <View style={styles.settingsPanel}><PanelHead eyebrow="설정" title="내 업무공간" onClose={() => setScreen('home')} /><View style={styles.settingsGroup}><Text style={styles.settingsGroupTitle}>계정</Text><View style={styles.settingsAccount}><Text style={styles.body}>{session.user.email || '로그인 사용자'}</Text><Text style={styles.meta}>개인 업무공간에 안전하게 연결됨</Text></View></View><View style={styles.settingsGroup}><Text style={styles.settingsGroupTitle}>일정·알림</Text><CalendarConnectionSummary compact refreshKey={calendarConnectionVersion} onPressManage={() => setScreen('scheduleSettings')} /><SettingsMenuItem eyebrow="CALENDAR · REMINDER" title="일정·알림 관리" description="Google/휴대폰 Calendar 연결과 일정별 알림을 관리합니다." onPress={() => setScreen('scheduleSettings')} /></View><View style={styles.settingsGroup}><Text style={styles.settingsGroupTitle}>앱 정보</Text><SettingsMenuItem eyebrow="RELEASE NOTES" title="업데이트·패치노트" description="업무수첩에 반영된 변경사항을 확인합니다." onPress={() => setScreen('patchNotes')} /><Text style={styles.settingsMeta}>Data Core primary: {config?.dataCorePrimaryEnabled ? 'ON' : 'OFF'}</Text></View><View style={styles.settingsGroup}><Text style={styles.settingsGroupTitle}>계정 작업</Text><SettingsMenuItem eyebrow="ACCOUNT" title="로그아웃" description="이 기기에서 현재 계정 세션을 종료합니다." destructive onPress={confirmSignOut} /></View></View> : null}
    {screen === 'scheduleSettings' ? <View style={styles.card}><PanelHead eyebrow="설정" title="일정·알림 관리" onClose={() => setScreen('settings')} /><Text style={styles.body}>휴대폰/Google Calendar 연결과 일정별 알림을 여기에서 관리합니다.</Text><CalendarConnectionSummary refreshKey={calendarConnectionVersion} /><CalendarConnectionManager onChanged={() => setCalendarConnectionVersion((value) => value + 1)} />{briefing?.scheduleEnabled ? <><View style={styles.scheduleGroup}><Text style={styles.detailTitle}>오늘 일정</Text><ScheduleRows schedules={briefing.schedules?.today} empty="오늘 확정 일정이 없습니다." showDeviceActions /></View><View style={styles.scheduleGroup}><Text style={styles.detailTitle}>14일 이내 일정</Text><ScheduleRows schedules={briefing.schedules?.upcoming} empty="다가오는 일정이 없습니다." showDeviceActions /></View></> : <Text style={styles.emptyText}>현재 계정의 일정 기능이 활성화되지 않았습니다.</Text>}</View> : null}
    {screen === 'patchNotes' ? <View style={styles.card}><PanelHead eyebrow="업데이트" title="패치노트" onClose={() => setScreen('settings')} /><Text style={styles.body}>업무수첩에 반영된 최근 변경사항입니다.</Text>{MOBILE_PATCH_NOTES.map((note) => <View key={`${note.date}-${note.title}`} style={styles.detailSection}><Text style={styles.meta}>{note.date}</Text><Text style={styles.detailTitle}>{note.title}</Text><Text style={styles.body}>{note.summary}</Text>{note.items.map((item) => <Text key={item} style={styles.patchNoteItem}>• {item}</Text>)}</View>)}</View> : null}
  </ScrollView>
  <WorkRecordEditSheet
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
    onTitle={setEditTitle}
    onDate={setEditDate}
    onTime={setEditTime}
    onActionKind={setEditActionKind}
    onSave={() => void saveTaskEditor()}
    onCancel={closeTaskEditor}
    onRetry={() => void retryTaskEditor()}
  />
  {screen === 'home' ? <View onLayout={(event) => setQuickDockHeight(Math.max(220, Math.ceil(event.nativeEvent.layout.height)))} style={[styles.quickDockShell, { paddingBottom: Math.max(insets.bottom, 8) }]}><VoiceRecorderCard mode="quick" navigationGuard={quickVoiceNavigation} onOpenWorklogInput={() => setScreen('input')} quickVoice={{ ensureProvider: prepareQuickVoiceWhisperProvider, draftScope: session.user.id, saveWorklog: async (transcript, options) => { const saved = await saveWorklog(session.access_token, transcript, { ...options, sourceType: 'voice' }); if (saved.scheduleId) { setNotificationScheduleId(saved.scheduleId); setScheduleFocusReason('created'); } return { recordId: saved.dataCoreWorkRecordId || saved.pageId, scheduleDetected: Boolean(saved.scheduleDetected), scheduleCreated: Boolean(saved.scheduleCreated), scheduleId: saved.scheduleId || '', dueStart: saved.dueStart || '' }; }, refreshBriefing }} /></View> : null}</View></View>;
}

function PanelHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <View style={styles.sectionHead}><View style={styles.sectionHeadText}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View><Pressable accessibilityRole="button" style={styles.closeButton} onPress={onClose}><Text style={styles.linkText}>닫기</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: mobileTheme.colors.background },
  flex: { flex: 1 },
  authenticatedShell: { flex: 1 },
  contentScroll: { flex: 1 },
  quickDockShell: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'transparent' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: mobileTheme.spacing.section, padding: 24, backgroundColor: mobileTheme.colors.background },
  scroll: { padding: mobileTheme.spacing.page, gap: mobileTheme.spacing.section, paddingBottom: 28 },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: mobileTheme.spacing.page, gap: mobileTheme.spacing.section },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, paddingVertical: 4 },
  headerTitleWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#17191d', flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: { width: mobileTheme.size.touchTarget, height: mobileTheme.size.touchTarget, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 14, backgroundColor: mobileTheme.colors.surface },
  headerButtonIcon: { fontSize: 21 },
  loginHero: { gap: mobileTheme.spacing.compact, padding: mobileTheme.spacing.compact },
  welcomeCard: { gap: 12, padding: mobileTheme.spacing.card, borderRadius: mobileTheme.radius.card, backgroundColor: mobileTheme.colors.neutralBackground, borderWidth: 1, borderColor: mobileTheme.colors.neutralBorder },
  welcomeTitle: { fontSize: 23, fontWeight: '800', color: mobileTheme.colors.text, lineHeight: 31 },
  welcomeBenefits: { gap: 7, paddingTop: 2 },
  welcomeBenefit: { color: mobileTheme.colors.textSecondary, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  card: { backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.card, padding: mobileTheme.spacing.card, gap: 14 },
  panel: { gap: 12 },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1, color: '#5f6570' },
  title: { fontSize: 28, fontWeight: '800', color: mobileTheme.colors.text },
  sectionTitle: { fontSize: 20, fontWeight: '800', color: mobileTheme.colors.text },
  body: { fontSize: 15, color: mobileTheme.colors.textSecondary, lineHeight: 22 },
  meta: { fontSize: 13, color: mobileTheme.colors.textMuted },
  statusText: { fontSize: 15, color: mobileTheme.colors.textSecondary },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
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
  taskTitle: { fontSize: 15, fontWeight: '700', color: '#30343b', lineHeight: 21 },
  taskMeta: { fontSize: 13, color: '#737985', lineHeight: 18 },
  taskBadge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', color: '#374151', backgroundColor: '#e5e7eb', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  followUp: { fontSize: 13, color: '#4b515c', lineHeight: 18 },
  inlineEdit: { minHeight: 48, minWidth: 48, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#fff', borderWidth: 1, borderColor: '#d1d5db' },
  inlineEditText: { fontSize: 18 },
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
  authActions: { flexDirection: 'row', gap: 8 },
  authAction: { flex: 1, minHeight: mobileTheme.size.touchTarget, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: mobileTheme.radius.control, borderWidth: 1 },
  authGoogleAction: { borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  authPrimaryAction: { borderColor: mobileTheme.colors.primary, backgroundColor: mobileTheme.colors.primary },
  authSecondaryAction: { borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  authActionDisabled: { opacity: 0.5 },
  authActionText: { color: mobileTheme.colors.text, fontSize: 14, fontWeight: '800' },
  authPrimaryActionText: { color: mobileTheme.colors.primaryText },
  authHint: { fontSize: 12, color: '#737985', lineHeight: 18 },
  settingsPanel: { gap: mobileTheme.spacing.section, paddingBottom: mobileTheme.spacing.page },
  settingsGroup: { gap: 8 },
  settingsGroupTitle: { color: mobileTheme.colors.textMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0.9, paddingHorizontal: 4 },
  settingsAccount: { gap: 5, backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.control, padding: mobileTheme.spacing.control },
  settingsMenuItem: { minHeight: 86, flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: mobileTheme.colors.surface, borderRadius: mobileTheme.radius.control, padding: mobileTheme.spacing.control },
  settingsMenuItemDestructive: { backgroundColor: '#fff7f7', borderWidth: 1, borderColor: '#fecaca' },
  settingsMenuCopy: { flex: 1, minWidth: 0, gap: 3 },
  settingsMenuEyebrow: { color: mobileTheme.colors.textMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.7 },
  settingsMenuTitle: { color: mobileTheme.colors.text, fontSize: 16, fontWeight: '800' },
  settingsMenuTitleDestructive: { color: mobileTheme.colors.danger },
  settingsMenuDescription: { color: mobileTheme.colors.textSecondary, fontSize: 12, lineHeight: 18 },
  settingsMenuChevron: { color: mobileTheme.colors.link, fontSize: 26, fontWeight: '400' },
  settingsMeta: { color: mobileTheme.colors.textMuted, fontSize: 11, paddingHorizontal: 4 },
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
