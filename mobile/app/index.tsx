import { HabitsScreen } from '@/src/features/habits/habits-screen';
import { MyManagementScreen } from '@/src/features/management/my-management-screen';
import { repeatHistory, repeatSummary } from '@/src/features/recurring/recurrence-model';
import { shiftDay } from '@/src/features/home/home-calendar-model';
import { recordRowStyles } from '@/src/ui/record-row-styles';
import { findWorklogReminderLinks } from '@/src/features/schedule/worklog-reminder-adapter';
import { RepeatFromRecord } from '@/src/features/recurring/repeat-from-record';
import { useRepeatingWork } from '@/src/features/recurring/use-repeating-work';
import { RepeatOptions } from '@/src/features/recurring/repeat-options';
import { RecurringDetail } from '@/src/features/recurring/recurring-detail';
import { recurringHomeProjection } from '@/src/features/recurring/recurrence-home';
import { newRepeatState, validDay, validateRule, type RepeatRule, type RepeatOccurrence } from '@/src/features/recurring/recurrence-model';
import type { ReactNode } from 'react';
import { HomeCalendar } from '@/src/features/home/home-calendar';
import { PersonalCalendarSheet } from '@/src/features/calendar/personal-calendar-sheet';
import { CalendarSettings } from '@/src/features/settings/calendar-settings';
import { CalendarExportPreview } from '@/src/features/calendar/calendar-export-preview';
import { CaptureImportButton } from '@/src/features/capture/capture-import-button';
import { captureChanges } from '@/src/features/capture/capture-runtime';
import { firstNonEmptyTaskBucket, homeOverview } from '@/src/features/home/home-overview';
import { HomeReminderStatus } from '@/src/features/home/home-reminder-status';
import { CompactReminderLabel, ScheduleReminderLabel } from '@/src/features/home/schedule-reminder-label';
import { SubscriptionsScreen } from '@/src/features/subscriptions/subscriptions-screen';
import { cancelAllSubscriptionReminders, reconcileSubscriptionReminderOwner } from '@/src/features/subscriptions/subscription-reminders';
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
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, BackHandler, Button, KeyboardAvoidingView, Modal, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { createManualWorkDraftStorage } from '@/src/features/work/manual-work-draft';
import { secureSessionStorage } from '@/src/platform/secure-storage';
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
type AppScreen = 'home' | 'journal' | 'recordSearch' | 'task' | 'input' | 'meeting' | 'settings' | 'reminderSettings' | 'patchNotes' | 'subscriptions';
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


function HomeTaskRow(props: Parameters<typeof TaskRow>[0]) {
  const [expanded, setExpanded] = useState(false);
  return <View style={styles.homeTaskEntry}>
    <View style={styles.homeTaskLine}>
      <View style={styles.taskMain}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${props.task.title || '업무'} 관리 펼치기`} accessibilityState={{ expanded }} style={styles.homeTaskOpen} onPress={() => setExpanded(value => !value)}>
          <Text style={styles.taskTitle}>{props.task.title || '제목 없는 업무'}</Text>
          <Text style={styles.taskMeta}>{taskNote(props.bucket, props.task)}{props.task.dueTime ? ` · ${props.task.dueTime}` : ''}</Text>
        </Pressable>
        {props.task.pageId ? <View style={styles.homeTaskUtilities}>
          <ReminderShortcut id={props.task.pageId} title={props.task.title || '업무'} onPress={props.onReminder} disabled={props.completing} />
          {!props.task.pageId.startsWith('repeat:') && props.task.dueKey ? <CalendarExportPreview compact recordId={props.task.pageId} title={props.task.title || '업무'} /> : null}
        </View> : null}
      </View>
      {props.task.pageId ? <View style={styles.taskActions}>
        <View style={styles.taskMinorActions}>
          {props.onEdit ? <Pressable accessibilityRole="button" accessibilityLabel={`${props.task.title || '업무'} 수정`} disabled={props.completing} style={styles.inlineEdit} onPress={props.onEdit}><Text style={styles.inlineEditText}>✏️</Text></Pressable> : null}
          {props.onDelete ? <Pressable accessibilityRole="button" accessibilityLabel={`${props.task.title || '업무'} 삭제`} disabled={props.completing} style={styles.inlineDelete} onPress={props.onDelete}><Text style={styles.inlineDeleteText}>삭제</Text></Pressable> : null}
        </View>
        {props.onComplete ? <Pressable accessibilityRole="button" accessibilityLabel={`${props.task.title || '업무'} 완료 처리`} disabled={props.completing} onPress={props.onComplete} style={[styles.inlineComplete, props.completing ? styles.inlineCompleteBusy : null]}><Text style={styles.inlineCompleteText}>{props.completing ? '처리 중' : '완료'}</Text></Pressable> : null}
      </View> : null}
    </View>
    {expanded ? <TaskRow {...props} onComplete={undefined} onEdit={undefined} onDelete={undefined} hideShortcuts /> : null}
  </View>;
}

function TaskRow({ bucket, task, onOpen, onReminder, onEdit, onDelete, onComplete, hideShortcuts = false, completing = false }: { bucket: BriefingBucket; task: BriefingTask; onOpen: () => void; onReminder: () => void; onEdit?: () => void; onDelete?: () => void; onComplete?: () => void; hideShortcuts?: boolean; completing?: boolean }) {
  return <View style={styles.taskRow}>
    <View style={styles.taskMain}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${task.title || '제목 없는 업무'} 상세 보기`} onPress={onOpen}>
      <Text style={styles.taskTitle}>{task.title || '제목 없는 업무'}</Text>
      <Text style={styles.taskMeta}>{taskNote(bucket, task)}{task.status ? ` · ${task.status}` : ''}</Text>
      {task.nextAttentionAt ? <Text style={styles.taskMeta}>다시 확인할 업무</Text> : null}
      {task.institution ? <Text style={styles.taskBadge}>{task.institution}</Text> : null}
      {task.followUp && task.followUp !== task.title ? <Text style={styles.followUp}>↳ {task.followUp}</Text> : null}
      </Pressable>
      {!hideShortcuts ? <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 12, rowGap: 12, marginTop: 6 }}>
      {task.pageId ? <ReminderShortcut id={task.pageId} title={task.title || '업무'} onPress={onReminder} disabled={completing} /> : null}
      {task.pageId ? <CalendarExportPreview recordId={task.pageId} title={task.title || '업무'} /> : null}
      </View> : null}
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
        <Text style={styles.inlineCompleteText}>{acknowledging ? '처리 중' : '완료'}</Text>
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
  structure: { waitingCount: 0, followUpCount: 0, totalOpen: 1, overdue: [], today: [{ pageId: '11111111-1111-4111-8111-111111111111', title: '검수용 업무: 일정과 알림 상태 확인', dueKey: seoulTodayKey(), dueTime: '10:00', status: '진행중' }], upcoming: [], undated: [] }, resurface: [], notes: [],
  schedules: { today: [{ scheduleId: '22222222-2222-4222-8222-222222222222', title: '검수용 일정: 긴 제목 줄바꿈과 알림 버튼 확인', startsAt: `${seoulTodayKey()}T10:00:00+09:00`, status: 'confirmed' }], upcoming: [], total: 1 },
};

function HomeHeader({ onOpenRecordSearch, onOpenSettings, onOpenManagement }: { onOpenRecordSearch: () => void; onOpenSettings: () => void; onOpenManagement: () => void }) {
  return <View style={styles.header}>
    <View style={styles.headerTitleWrap}><Text style={styles.headerTitle}>업무수첩</Text></View>
    <View style={styles.headerActions}>
      <Pressable accessibilityRole="button" accessibilityLabel="내 관리 열기" accessibilityHint="정기지출, 반복업무, 습관" style={styles.headerButton} onPress={onOpenManagement}><Text style={styles.headerManagementText}>관리</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="과거 업무 검색" style={styles.headerButton} onPress={onOpenRecordSearch}><Text style={styles.headerButtonIcon}>⌕</Text></Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel="설정 열기" style={styles.headerButton} onPress={onOpenSettings}><Text style={styles.headerButtonIcon}>⚙</Text></Pressable>
    </View>
  </View>;
}

export default function HomeScreen({ initialScreen = 'home', initialRepeatWorkId, initialRepeatDate }: { initialScreen?: 'home' | 'input'; initialRepeatWorkId?:string;initialRepeatDate?:string } = {}) {
  const { session } = usePlatform();
  return <HomeScreenApp androidTouchSmoke={ANDROID_TOUCH_SMOKE_MODE} initialScreen={initialScreen} initialRepeatWorkId={initialRepeatWorkId} initialRepeatDate={initialRepeatDate} key={session?.user.id || 'signed-out'} />;
}

function HomeScreenApp({ androidTouchSmoke = false, initialScreen = 'home', initialRepeatWorkId, initialRepeatDate }: { androidTouchSmoke?: boolean; initialScreen?: 'home' | 'input'; initialRepeatWorkId?:string;initialRepeatDate?:string }) {
  const platform = usePlatform();
  const { error, authError, rememberedEmail, reload, clearAuthError, signIn, signUp, signInWithGoogle, signOut } = platform;
  const phase = platform.phase;
  const session = platform.session;
  const client = platform.client;
  const config = platform.config;
  useEffect(()=>{if(phase!=='ready')return;if (!session) { void cancelAllSubscriptionReminders().catch(() => undefined); return; }let current=true;void reconcileSubscriptionReminderOwner(session.user.id,()=>current).catch(()=>undefined);return()=>{current=false;};},[phase,session?.user.id]);
  const recurring = useRepeatingWork(config?.dataSchema === 'worklog' ? client : null, session?.user.id, phase === 'ready');
  const [managementReturn,setManagementReturn]=useState<'home'|'settings'>('settings');
  const [repeatCreating,setRepeatCreating]=useState(false);
  const repeatCreateTarget=useRef<string|null>(null);
  const [repeatRule,setRepeatRule] = useState<RepeatRule|null>(null);
  const [repeatDetail,setRepeatDetail] = useState<{workId:string;row?:RepeatOccurrence;focusDate?:string}|null>(null);
  useEffect(()=>{if(initialRepeatWorkId&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(initialRepeatWorkId))setRepeatDetail({workId:initialRepeatWorkId,focusDate:initialRepeatDate&&validDay(initialRepeatDate)?initialRepeatDate:undefined});},[initialRepeatWorkId,initialRepeatDate]);
  const [repeatUndo,setRepeatUndo] = useState<RepeatOccurrence|null>(null);

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
  const manualDraftEdited = useRef(false);
  const manualDraftEpoch = useRef(0);
  const [manualDraftLoaded, setManualDraftLoaded] = useState(false);
  const [manualDraftNotice, setManualDraftNotice] = useState('');
  const manualVault = useMemo(() => session?.user.id
    ? createManualWorkDraftStorage(secureSessionStorage, session.user.id) : null, [session?.user.id]);

  // Read the encrypted, owner-scoped draft before enabling edits. Never replace
  // keystrokes with a slower recovery response or treat a corrupt blob as empty.
  useEffect(() => {
    let alive = true;
    if (!manualVault) { setManualDraftLoaded(true); return; }
    setManualDraftLoaded(false);
    void manualVault.load().then((saved) => {
      if (!alive || manualDraftEdited.current || !saved) return;
      manualSaveSession.current.restore(saved.attempt);
      if(saved.draft.repeatRule)validateRule(saved.draft.repeatRule);
      setRepeatRule(saved.draft.repeatRule||null);
      setManualInput(saved.draft);
      if (saved.draft.transcript.trim()) setManualDraftNotice('이전에 작성하던 직접 입력을 복구했습니다.');
    }).catch(() => {
      if (alive) setManualDraftNotice('기기 임시 초안을 읽지 못했습니다. 기존 초안은 보존했으며 새 저장 전 확인이 필요합니다.');
    }).finally(() => { if (alive) setManualDraftLoaded(true); });
    return () => { alive = false; };
  }, [manualVault]);

  // Debounced local-only draft backup; flush once on app backgrounding.
  // Durable storage serializes updates with the pre-POST request checkpoint.
  useEffect(() => {
    if (!manualDraftLoaded || !manualVault || manualSaveInFlight.current) return;
    const capturedEpoch = manualDraftEpoch.current;
    const keep = () => {
      if (capturedEpoch !== manualDraftEpoch.current || manualSaveInFlight.current) return Promise.resolve();
      return manualVault.saveDraft({...manualInput,...(repeatRule?{repeatRule}:{})}).catch(() => {
        setManualDraftNotice('기기 임시 초안을 저장하지 못했습니다. 내용은 현재 화면에 보존됩니다.');
      });
    };
    const timer = setTimeout(() => { void keep(); }, 350);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'background' && !manualSaveInFlight.current) void keep();
    });
    return () => { clearTimeout(timer); subscription.remove(); };
  }, [manualDraftLoaded, manualInput, manualVault, repeatRule]);
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
  const [personalCalendarOpen, setPersonalCalendarOpen] = useState(false);
  const [personalCalendarDate, setPersonalCalendarDate] = useState<string | undefined>();
  const [homeCalendarRevision, setHomeCalendarRevision] = useState(0);
  const [homeScheduleCount, setHomeScheduleCount] = useState<number | null>(null);
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
  repeatCreateTarget.current=repeatCreating?editTaskId:null;
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
  const [taskFiltersExpanded, setTaskFiltersExpanded] = useState(false);
  const [taskFilter, setTaskFilter] = useState<BriefingBucket | null>(null);

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
        setTaskFiltersExpanded(true);
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
      if (quickVoiceNavigation.current) { warnPendingVoice(); return true; }
      if (screen === 'home') return false;
      if (screen === 'subscriptions') { setScreen(managementReturn); return true; }
      setScreen(screen === 'journal' ? 'settings' : 'home');
      return true;
    });
    return () => subscription.remove();
  }, [screen, managementReturn]);
  useEffect(() => {
    if (!session || !client) return;
    let alive = true;
    const openSchedule = (data: unknown) => {
      const payload = data as { target?: unknown; scheduleId?: unknown; workRecordId?: unknown; userId?: unknown };
      if (payload?.target === 'repeating-work' && payload.userId === session?.user.id && typeof payload.workRecordId === 'string') { setScreen('home');setRepeatDetail({workId:payload.workRecordId});return true; }
      if (payload?.target === 'subscriptions') { setManagementReturn('home'); setScreen('subscriptions'); return true; }
      if (payload?.target !== 'schedule' || typeof payload.scheduleId !== 'string') return false;
      setNotificationScheduleId(payload.scheduleId);
      setScheduleFocusReason('notification');
      setScreen('home');
      showMessage('알림에서 연 일정을 홈의 일정 영역에 표시했습니다.', 'info');
      return true;
    };

    const handleNotificationResponse = notificationResponseHandler<Notifications.NotificationResponse>(
      () => alive,
      (response) => openSchedule(response.notification.request.content.data),
      () => Notifications.clearLastNotificationResponseAsync(),
    );

    void Notifications.getLastNotificationResponseAsync().then(handleNotificationResponse).catch(() => undefined);
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => { void handleNotificationResponse(response); });
    return () => { alive = false; subscription.remove(); };
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
    if (!session || !client) return false;
    const epoch = briefingRefreshEpoch.current;
    return briefingRefreshQueue.current.run(async () => {
      if (epoch !== briefingRefreshEpoch.current) return false;
      editDetailsCache.current = new Map();
      setBriefingBusy(true);
      setBriefingError('');
      setHomeCalendarRevision(value => value + 1);
      try {
        const accessToken = await freshHomeAccessToken(client);
        const next = await loadHomeBriefing(accessToken);
        if (epoch !== briefingRefreshEpoch.current) return false;
        setBriefing(next);
        if (!androidTouchSmoke) {
          await initialReminderRecovery.current;
          if (epoch !== briefingRefreshEpoch.current) return false;
          await synchronizeBriefingScheduleReminders(client, next.schedules).catch((nextError) => {
            console.warn('[schedule-reminder] canonical schedule sync pending', messageOf(nextError, 'unknown'));
          });
        }
        return epoch === briefingRefreshEpoch.current;
      } catch (nextError) {
        if (epoch === briefingRefreshEpoch.current) setBriefingError(messageOf(nextError, '브리핑을 불러오지 못했습니다.'));
        return false;
      } finally {
        if (epoch === briefingRefreshEpoch.current) setBriefingBusy(false);
      }
    });
  }

  async function refreshQuickVoiceBriefing() {
    // Background refreshes keep handling their own errors. Quick Voice needs
    // failure to reach its existing list-only retry UI, after a successful save.
    if (!await refreshBriefing()) throw new Error('기록은 저장됐지만 목록을 새로 불러오지 못했습니다. 목록만 다시 불러와주세요.');
  }

  function switchAuthMode(nextMode: AuthMode) {
    if (nextMode === authMode || busy) return;
    setAuthMode(nextMode);
    setPassword('');
    setShowPassword(false);
    clearMessage();
    clearAuthError();
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
      if (outcome === 'confirmationRequired') {
        showMessage('가입 확인 이메일을 보냈습니다. 업무수첩이 설치된 휴대폰에서 인증 버튼을 누르면 앱으로 돌아옵니다. 다른 기기에서 인증했다면 앱으로 돌아와 로그인해 주세요.', 'success');
      }
    });
  }

  async function persistDraft() {
    if (!session || !client || !manualDraftLoaded || !manualInput.transcript.trim() || busy || manualSaveInFlight.current) return;
    manualSaveInFlight.current = true;
    manualDraftEpoch.current += 1;
    const wasRepeating = !!repeatRule;
    const original = manualInput.transcript.trim();
    if (repeatRule) {
      try { newRepeatState(original,{...repeatRule,anchor:manualInput.dueDate},manualInput.dueTime); }
      catch { manualSaveInFlight.current=false; showMessage('반복 주기·요일·시작일을 확인해주세요.','error'); return; }
    }
    try { await run(async () => {
      const reminderGuard = reminderSessionEpoch.capture();
      const saved = await manualSaveSession.current.save(manualInput,
        async (text, options) => saveWorklog(await getFreshAccessToken(client), text, options),
        manualVault ? (checkpoint) => manualVault.prepareSave({...manualInput,...(repeatRule?{repeatRule}:{})}, checkpoint) : undefined);
      if (repeatRule) {
        const id = saved.dataCoreWorkRecordId;
        if (!id) throw new Error('업무는 저장됐지만 반복 연결을 확인하지 못했습니다. 다시 저장하면 같은 업무에 연결을 재시도합니다.');
        const initial = newRepeatState(original,{...repeatRule,anchor:manualInput.dueDate},manualInput.dueTime);
        if (!await recurring.mutate(id,{op:'create',revision:{...initial.revisions[0],sourceScheduleId:saved.scheduleId,sourceScheduleIds:saved.scheduleIds|| (saved.scheduleId?[saved.scheduleId]:[])}})) throw new Error('업무 저장됨 · 반복 저장 확인 필요. 입력을 유지했습니다. 같은 내용으로 다시 시도해주세요.');
        setRepeatRule(null);
      }
      const expectedDue = manualInput.dueDate && manualInput.dueTime
        ? `${manualInput.dueDate}T${manualInput.dueTime}:00+09:00` : manualInput.dueDate;
      const dueMatches = !expectedDue || (manualInput.dueTime
        ? Date.parse(saved.dueStart || '') === Date.parse(expectedDue) && Boolean(saved.scheduleCreated && saved.scheduleId?.trim())
        : saved.dueStart === expectedDue);
      const scheduleWarning = dueMatches ? ''
        : `업무만 저장되었습니다. 선택한 ${manualInput.dueDate}${manualInput.dueTime ? ` ${manualInput.dueTime}` : ''}의 ${manualInput.dueTime ? '일정' : '기한'} 저장을 확인하지 못했습니다. 다시 등록하지 말고 저장된 항목의 연필 버튼에서 날짜와 시간을 확인해주세요.`;
      const feedback = {
        recordId: saved.dataCoreWorkRecordId || saved.pageId || '',
        scheduleWarning,
        transcript: saved.cleanTranscript?.trim() || original,
        scheduleDetected: Boolean(saved.scheduleDetected),
        scheduleCreated: Boolean(saved.scheduleCreated),
        scheduleId: saved.scheduleId?.trim() || '',
        dueStart: saved.dueStart?.trim() || '',
      };
      let reminderWarning = '';
      let reminderMessage = '';
      try { const results = wasRepeating ? [] : await synchronizeSavedScheduleReminders(saved, reminderGuard, client); reminderMessage = savedReminderMessage(results, saved.scheduleIds?.length || (saved.scheduleId ? 1 : 0)); }
      catch (nextError) { reminderWarning = reminderFailureMessage(nextError); }
      if (!reminderGuard()) return;
      setSavedReminder({ target: { recordId: feedback.recordId, scheduleId: saved.scheduleId, title: feedback.transcript }, message: reminderWarning || reminderMessage });
      // Permission guidance is post-save UI; its failure cannot undo a saved record.
      try { await maybeGuideExactAlarmPermission(Boolean(saved.scheduleId)); }
      catch (nextError) {
        reminderWarning = reminderFailureMessage(nextError);
        setSavedReminder({ target: { recordId: feedback.recordId, scheduleId: saved.scheduleId, title: feedback.transcript }, message: reminderWarning });
      }
      if (!reminderGuard()) return;
      // Clearing the local checkpoint is separate from the committed server
      // write. Keep success truthful even if native cleanup needs a retry.
      let localCleanupWarning = '';
      try { await manualVault?.clear(); } catch {
        localCleanupWarning = '기기 임시 초안 정리는 확인되지 않았습니다.';
      }
      setManualInput(emptyManualWorkInput());
      manualSaveSession.current.reset();
      setManualDraftNotice(localCleanupWarning);
      setLastDirectSave(feedback);
      if (feedback.scheduleId) { setNotificationScheduleId(feedback.scheduleId); setScheduleFocusReason('created'); }
      const dueLabel = formatSavedDue(feedback.dueStart);
      showMessage(scheduleWarning || (feedback.scheduleCreated
        ? `업무 저장 완료 · 일정 생성됨${dueLabel ? ` · ${dueLabel}` : ''}${reminderWarning ? ` · ${reminderWarning}` : ''}`
        : '업무 저장 완료'), scheduleWarning ? 'error' : 'success');
      setScreen('home');
      await refreshBriefing();
    }); } finally { manualSaveInFlight.current = false; }
  }

  async function changeTaskStatus(status: '완료' | '진행중' | '대기' | '확인필요') {
    if (!session || !client || !selectedTask?.task.pageId || busy) return;
    await run(async () => {
      const accessToken = await getFreshAccessToken(client);
      await updateWorklogStatus(accessToken, selectedTask.task.pageId!, status);
      showMessage(`업무 상태를 ${status}(으)로 변경했습니다.`, 'success');
      setSelectedTask(null); setScreen('home');
      await refreshBriefing();
    });
  }

  async function completeTaskInline(task: BriefingTask) {
    if (!session || !client || !task.pageId || taskBusyId || taskStatusInFlight.current || recordMutationInFlight.current) return;
    taskStatusInFlight.current = true;
    const previousStatus: WorkStatus = task.status === '대기' || task.status === '확인필요' || task.status === '진행중' ? task.status : '진행중';
    setTaskBusyId(task.pageId);
    clearMessage();
    try {
      const accessToken = await getFreshAccessToken(client);
      await updateWorklogStatus(accessToken, task.pageId, '완료');
      setUndoTask({ pageId: task.pageId, status: previousStatus, title: task.title || '업무', previousAttentionAt: task.nextAttentionAt || null });
      // The server mutation is confirmed even if the separate list read fails.
      if (!await refreshBriefing()) showMessage(`${task.title || '업무'} 완료 처리는 저장됐습니다. 목록만 새로고침해주세요.`, 'info');
    } catch (nextError) {
      showMessage(messageOf(nextError, '업무 완료 처리에 실패했습니다.'), 'error');
    } finally {
      taskStatusInFlight.current = false;
      setTaskBusyId(null);
    }
  }

  function confirmDeleteRecord(recordId: string, title: string, kind: 'task' | 'note') {
    Alert.alert(
      kind === 'note' ? '메모 삭제' : '업무 삭제',
      `"${title || (kind === 'note' ? '메모' : '업무')}"을(를) 업무수첩에서 삭제할까요?\n완료 기록이나 업무일지에는 남기지 않습니다.`,
      [
        { text: '취소', style: 'cancel' },
        { text: '삭제', style: 'destructive', onPress: () => { void deleteBriefingRecord(recordId, title, kind); } },
      ],
    );
  }

  async function deleteBriefingRecord(recordId: string, title: string, kind: 'task' | 'note') {
    if (!session || !client || !recordId || taskBusyId || noteBusyId || taskStatusInFlight.current || recordMutationInFlight.current) return;
    recordMutationInFlight.current = true;
    if (kind === 'note') setNoteBusyId(recordId); else setTaskBusyId(recordId);
    clearMessage();
    let cleanupWarning = '';
    try {
      const reminderGuard = reminderSessionEpoch.capture();
      const result = await deleteWorklog(client, recordId);
      removeVisibleRecordForConversion(recordId);
      setSelectedTask((current) => current?.task.pageId === recordId ? null : current);
      try {
        await cancelSavedScheduleReminders(result.cancelledScheduleIds || [], reminderGuard);
      } catch (nextError) {
        cleanupWarning = messageOf(nextError, '취소된 일정의 휴대폰 알림 일부를 정리하지 못했습니다.');
      }
      showMessage(
        cleanupWarning
          ? `${title || (kind === 'note' ? '메모' : '업무')}을(를) 삭제했습니다. ${cleanupWarning}`
          : `${title || (kind === 'note' ? '메모' : '업무')}을(를) 삭제했습니다.`,
        cleanupWarning ? 'info' : 'success',
      );
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, kind === 'note' ? '메모를 삭제하지 못했습니다.' : '업무를 삭제하지 못했습니다.'), 'error');
    } finally {
      recordMutationInFlight.current = false;
      if (kind === 'note') setNoteBusyId(null); else setTaskBusyId(null);
    }
  }

  async function undoCompletedTask() {
    if (!session || !client || !undoTask || taskBusyId || taskStatusInFlight.current || recordMutationInFlight.current) return;
    taskStatusInFlight.current = true;
    const target = undoTask;
    setTaskBusyId(target.pageId);
    clearMessage();
    try {
      const accessToken = await getFreshAccessToken(client);
      await updateWorklogStatus(accessToken, target.pageId, target.status);
      let attentionError = '';
      if (target.previousAttentionAt) {
        try {
          await undoWorklogAttention(accessToken, target.pageId, null, target.previousAttentionAt);
        } catch (nextError) {
          attentionError = messageOf(nextError, '기존 다시 알림을 복원하지 못했습니다.');
        }
      }
      setUndoTask(null);
      showMessage(
        attentionError ? `${target.title} 완료는 되돌렸지만 다시 알림은 확인이 필요합니다. ${attentionError}` : `${target.title} 완료 처리를 되돌렸습니다.`,
        attentionError ? 'error' : 'success',
      );
      if (!await refreshBriefing()) showMessage(
        attentionError ? `${target.title} 완료는 되돌렸습니다. 다시 알림과 목록을 확인해주세요. ${attentionError}` : `${target.title} 완료는 되돌렸습니다. 목록만 새로고침해주세요.`,
        attentionError ? 'error' : 'info',
      );
    } catch (nextError) {
      showMessage(messageOf(nextError, '완료 처리를 되돌리지 못했습니다.'), 'error');
    } finally {
      taskStatusInFlight.current = false;
      setTaskBusyId(null);
    }
  }

  async function postponeSelectedTask(date: string) {
    const task = selectedTask?.task;
    if (!session || !client || !task?.pageId || reminderBusyId || reminderMutationInFlight.current) return;
    reminderMutationInFlight.current = true;
    setReminderBusyId(task.pageId);
    clearMessage();
    try {
      const accessToken = await getFreshAccessToken(client);
      const current = await readWorklogDetails(accessToken, task.pageId);
      await postponeWorklog(accessToken, { pageId: task.pageId, dueDate: date, dueTime: current.dueTime });
      setUndoPostpone({ pageId: task.pageId, title: task.title || '업무' });
      setSelectedTask(null);
      setScreen('home');
      showMessage(`${task.title || '업무'} 기한을 ${date}로 미뤘습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '업무를 미루지 못했습니다.'), 'error');
    } finally {
      reminderMutationInFlight.current = false;
      setReminderBusyId(null);
    }
  }

  async function remindSelectedTask(date: string | null) {
    const task = selectedTask?.task;
    if (!session || !client || !task?.pageId || reminderBusyId || reminderMutationInFlight.current) return;
    reminderMutationInFlight.current = true;
    setReminderBusyId(task.pageId);
    clearMessage();
    try {
      const accessToken = await getFreshAccessToken(client);
      const result = await setWorklogAttention(accessToken, task.pageId, date ? `${date}T09:00:00+09:00` : null);
      setUndoAttention({
        pageId: task.pageId,
        title: task.title || '업무',
        appliedAttentionAt: result.nextAttentionAt || null,
        previousAttentionAt: result.previousAttentionAt || null,
      });
      setSelectedTask(null);
      setScreen('home');
      showMessage(date ? `${task.title || '업무'}을(를) ${date}에 다시 확인합니다.` : `${task.title || '업무'}의 다시 확인을 취소했습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '다시 확인을 변경하지 못했습니다.'), 'error');
    } finally {
      reminderMutationInFlight.current = false;
      setReminderBusyId(null);
    }
  }

  async function undoPostponedTask() {
    if (!session || !client || !undoPostpone || reminderBusyId || reminderMutationInFlight.current) return;
    reminderMutationInFlight.current = true;
    const target = undoPostpone;
    setReminderBusyId(target.pageId);
    clearMessage();
    try {
      const accessToken = await getFreshAccessToken(client);
      await undoPostponeWorklog(accessToken, target.pageId);
      setUndoPostpone(null);
      showMessage(`${target.title} 미루기를 되돌렸습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '미루기를 되돌리지 못했습니다.'), 'error');
    } finally {
      reminderMutationInFlight.current = false;
      setReminderBusyId(null);
    }
  }

  async function undoTaskAttention() {
    if (!session || !client || !undoAttention || reminderBusyId || reminderMutationInFlight.current) return;
    reminderMutationInFlight.current = true;
    const target = undoAttention;
    setReminderBusyId(target.pageId);
    clearMessage();
    try {
      const accessToken = await getFreshAccessToken(client);
      await undoWorklogAttention(accessToken, target.pageId, target.appliedAttentionAt, target.previousAttentionAt);
      setUndoAttention(null);
      showMessage(`${target.title} 다시 확인을 되돌렸습니다.`, 'success');
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '다시 확인을 되돌리지 못했습니다.'), 'error');
    } finally {
      reminderMutationInFlight.current = false;
      setReminderBusyId(null);
    }
  }

  async function loadTaskEditorDetails(pageId: string, fallbackTitle = '', fallbackDate = '', seedTime?: string) {
    if (!session || !client || editBusy) return;
    const epoch = ++editReadEpoch.current;
    const cache = editDetailsCache.current;
    const cached = cache.get(pageId);
    const completeSeed = (cached || typeof seedTime === 'string') ? { title: fallbackTitle, dueDate: fallbackDate, dueTime: seedTime ?? cached?.dueTime ?? '' } : null;
    // Cached/list fields are only a visual seed; a fresh owner-scoped read must
    // succeed before the edit can be saved (otherwise stale dates can overwrite).
    setEditLoading(true);
    setEditReady(false);
    if (completeSeed) {
      if (!editDirty.current.title) setEditTitle(completeSeed.title);
      if (!editDirty.current.date) setEditDate(completeSeed.dueDate);
      if (!editDirty.current.time) setEditTime(completeSeed.dueTime);
    }
    setEditStatus('');
    setEditStatusTone('neutral');
    try {
      const details = await readWorklogDetails(await getFreshAccessToken(client), pageId);
      if (epoch !== editReadEpoch.current) return;
      if (cache === editDetailsCache.current) cache.set(pageId, details);
      if (!editDirty.current.title) setEditTitle(details.title || fallbackTitle);
      if (!editDirty.current.date) setEditDate(details.dueDate);
      if (!editDirty.current.time) setEditTime(details.dueTime || '');
      if (!editDirty.current.kind) setEditActionKind(details.actionKind);
      setEditOriginalActionKind(details.actionKind);
      setEditActionConversionAllowed(details.actionConversionAllowed === true);
      setEditReady(true);
    } catch (nextError) {
      if (epoch !== editReadEpoch.current) return;
      setEditStatus(messageOf(nextError, '현재 업무 정보를 불러오지 못했습니다.'));
      setEditStatusTone('error');
    } finally {
      if (epoch === editReadEpoch.current) setEditLoading(false);
    }
  }

  function removeVisibleNote(recordId: string) {
    setBriefing((current) => current
      ? { ...current, notes: (current.notes || []).filter((note) => note.pageId !== recordId) }
      : current);
  }

  async function acknowledgeNote(note: BriefingNote) {
    if (!session || !client || !note.pageId || noteBusyId) return;
    setNoteBusyId(note.pageId);
    clearMessage();
    try {
      await updateBriefingNoteState(await getFreshAccessToken(client), note.pageId, 'acknowledged');
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
    if (!session || !client || !undoNote || noteBusyId) return;
    const target = undoNote;
    setNoteBusyId(target.pageId);
    clearMessage();
    try {
      await updateBriefingNoteState(await getFreshAccessToken(client), target.pageId, 'active');
      setUndoNote(null);
      await refreshBriefing();
    } catch (nextError) {
      showMessage(messageOf(nextError, '메모 확인 처리를 되돌리지 못했습니다.'), 'error');
    } finally {
      setNoteBusyId(null);
    }
  }

  async function openTaskEditor(task: BriefingTask) {
    if (!session || !task.pageId || editBusy || recordMutationInFlight.current) return;
    editDirty.current = { title: false, date: false, time: false, kind: false };
    setEditTaskId(task.pageId);
    setEditTitle(task.title || '');
    setEditDate(task.dueKey || '');
    setEditTime(task.dueTime || '');
    setEditActionKind(undefined);
    setEditOriginalActionKind(undefined);
    setEditActionConversionAllowed(false);
    setEditReady(false);
    setEditStatus('');
    setEditStatusTone('neutral');
    await loadTaskEditorDetails(task.pageId, task.title || '', task.dueKey || '', task.dueTime);
  }

  async function openNoteEditor(note: BriefingNote) {
    if (!session || !note.pageId || editBusy || recordMutationInFlight.current) return;
    editDirty.current = { title: false, date: false, time: false, kind: false };
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
    if (!session || !client || !editTaskId || editBusy || editLoading || !editReady || recordMutationInFlight.current || taskStatusInFlight.current) return;
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
    editReadEpoch.current += 1; // A background read must not change fields once saving begins.
    recordMutationInFlight.current = true;
    setEditBusy(true);
    setEditStatus('');
    setEditStatusTone('neutral');
    try {
      const accessToken = await getFreshAccessToken(client);
      const reminderGuard = reminderSessionEpoch.capture();
      const result = await updateWorklogDetails(accessToken, {
        pageId: recordId,
        title: nextTitle,
        dueDate: editDate.trim(),
        dueTime: editTime.trim(),
        ...(editActionConversionAllowed && editActionKind && editOriginalActionKind && editActionKind !== editOriginalActionKind
          ? { actionKind: editActionKind }
          : {}),
      });
      editDetailsCache.current.delete(recordId);
      const visibleTitle = result.title?.trim() || nextTitle;
      let reminderWarning = '';
      let reminderResult: 'linked' | 'created' | 'no-time' = 'no-time';
      try {
        reminderResult = await synchronizeEditedWorklogReminder(client, {
          recordId,
          schedule: result.schedule,
          dueDate: editDate,
          dueTime: editTime,
        }, reminderGuard);
      } catch (nextError) {
        reminderWarning = reminderFailureMessage(nextError);
      }
      if (!reminderGuard()) return;
      const reminderFeedback = reminderWarning
        ? `기록은 수정됐지만 알림은 미확인 · ${reminderWarning}`
        : reminderResult === 'created' ? '새 일정 알림을 이 휴대폰에 예약했습니다.'
        : reminderResult === 'linked' ? '연결된 일정의 알림을 확인했습니다.'
        : '알림 없음 · 미래 날짜와 시작 시간을 지정하면 자동 등록됩니다.';
      if (editDate && editTime && result.mode === 'data_core') {
        setSavedReminder({ target: { recordId, scheduleId: result.schedule?.id, title: visibleTitle }, message: reminderFeedback });
      }
      if (result.actionKindChanged) removeVisibleRecordForConversion(recordId);
      else updateVisibleTaskTitle(recordId, visibleTitle);
      setEditReady(false);
      setEditStatus(result.actionKindChanged
        ? result.actionKind === 'note'
          ? '✓ 메모 · 참고로 변경했습니다.'
          : '✓ 할 일로 변경했습니다.'
        : result.unchanged
          ? '변경된 내용이 없습니다.'
          : result.scheduleUpdated
            ? `✓ 업무와 연결된 일정도 수정했습니다.${reminderWarning ? ` ${reminderWarning}` : ''}`
            : '✓ 업무를 수정했습니다.');
      setEditStatusTone(reminderWarning ? 'error' : result.unchanged && !result.actionKindChanged ? 'neutral' : 'success');
      // The editor closes quickly: keep device notification status visible on the home screen.
      showMessage(`업무 수정 저장 · ${reminderFeedback}`, reminderWarning ? 'info' : 'success');
      // Do not leave a committed edit pending behind a fixed delay: a
      // delayed close could dismiss another record's editor.
      setEditTaskId(null);
      setEditStatus('');
      setEditStatusTone('neutral');
      await refreshBriefing();
    } catch (nextError) {
      setEditStatus(messageOf(nextError, '업무 수정에 실패했습니다.'));
      setEditStatusTone('error');
    } finally {
      recordMutationInFlight.current = false;
      setEditBusy(false);
    }
  }

  function confirmSignOut() {
    Alert.alert(
      '로그아웃',
      '이 기기에서 현재 업무수첩 계정 세션을 종료할까요?\n기기에 예약된 업무수첩 일정 알림은 해제되지만, 저장된 일정 기록은 유지됩니다.',
      [
        { text: '취소', style: 'cancel' },
        { text: '로그아웃', style: 'destructive', onPress: () => { void run(signOut); } },
      ],
    );
  }

  function closeTaskEditor() {
    if (editBusy || recordMutationInFlight.current) return;
    editReadEpoch.current += 1;
    setEditLoading(false);
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

  if (phase === 'loading') return <StartupScreen stage="account" onRetry={reload} />;
  if (phase === 'error') return <View style={[styles.center, { paddingTop: 24 + insets.top, paddingBottom: 24 + insets.bottom }]}><Text style={styles.title}>연결을 확인해주세요</Text><Text style={styles.errorText}>{error}</Text><Button title="다시 시도" onPress={reload} /></View>;

  if (!session) return <View style={[styles.page, { paddingTop: insets.top, paddingBottom: insets.bottom }]}><StatusBar style="dark" /><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><ScrollView contentContainerStyle={[styles.loginScroll, { paddingBottom: 20 + insets.bottom }]} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled">
    <View style={styles.loginHero}><Text style={styles.eyebrow}>나의 개인 업무공간</Text><Text style={styles.title}>🎙 업무수첩</Text><Text style={styles.body}>말하면 기록되고, 일정까지 한눈에</Text></View>
    <View style={styles.welcomeCard}><Text style={styles.welcomeTitle}>업무를 놓치지 않는{`\n`}개인 업무수첩</Text><View style={styles.welcomeBenefits}><Text style={styles.welcomeBenefit}>🎙 말하거나 직접 입력</Text><Text style={styles.welcomeBenefit}>📅 오늘·다가오는 일정 확인</Text><Text style={styles.welcomeBenefit}>✓ 저장 후 브리핑에서 바로 확인</Text></View></View>
    <View style={[styles.card, authMode === 'signUp' ? styles.signUpCard : null]}>
      <AuthModeSelector mode={authMode} onChange={switchAuthMode} />
      <View style={styles.authModeIntro}>
        <Text style={styles.authModeEyebrow}>{authMode === 'signIn' ? '기존 사용자' : '처음 사용자'}</Text>
        <Text style={styles.sectionTitle}>{authMode === 'signIn' ? '업무수첩 로그인' : '새 계정 만들기'}</Text>
        <Text style={styles.body}>{authMode === 'signIn'
          ? '이미 만든 계정으로 내 업무공간에 들어갑니다.'
          : '새 계정을 만든 뒤 이메일 인증을 완료하면 업무수첩을 시작할 수 있습니다.'}</Text>
      </View>
      <AuthAction title={authMode === 'signIn' ? 'Google로 로그인' : 'Google로 회원가입'} variant="google" disabled={busy} onPress={() => void run(signInWithGoogle)} />
      <View style={styles.dividerRow}><View style={styles.dividerLine} /><Text style={styles.dividerText}>또는 이메일로</Text><View style={styles.dividerLine} /></View>
      <TextInput accessibilityLabel="이메일" autoCapitalize="none" autoComplete="email" autoCorrect={false} importantForAutofill="yes" keyboardType="email-address" placeholder="name@example.com" returnKeyType="next" style={styles.input} textContentType="username" value={email} onChangeText={(value) => { setEmail(value); clearAuthError(); }} />
      <View style={styles.passwordRow}><TextInput accessibilityLabel="비밀번호" autoCapitalize="none" autoComplete={authMode === 'signUp' ? 'new-password' : 'current-password'} autoCorrect={false} importantForAutofill="yes" placeholder={authMode === 'signUp' ? '새 비밀번호 8자 이상' : '비밀번호'} returnKeyType="done" secureTextEntry={!showPassword} style={[styles.input, styles.passwordInput]} textContentType={authMode === 'signUp' ? 'newPassword' : 'password'} value={password} onChangeText={(value) => { setPassword(value); clearAuthError(); }} onSubmitEditing={() => void runEmailSignIn()} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} hitSlop={8} style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}><Text style={styles.passwordToggleText}>{showPassword ? '숨기기' : '보기'}</Text></Pressable></View>
      <AuthAction title={busy ? '처리 중...' : authMode === 'signIn' ? '로그인' : '계정 만들기'} variant="primary" disabled={busy || !email.trim() || !password} onPress={() => void runEmailSignIn()} />
      <Pressable accessibilityRole="button" style={styles.authModeSwitch} disabled={busy} onPress={() => switchAuthMode(authMode === 'signIn' ? 'signUp' : 'signIn')}>
        <Text style={styles.authModeSwitchText}>{authMode === 'signIn' ? '처음이신가요?  무료 회원가입으로 전환 →' : '이미 계정이 있나요?  로그인으로 돌아가기 →'}</Text>
      </Pressable>
      <Text style={styles.authHint}>{authMode === 'signIn'
        ? '이메일은 마지막 사용 계정을 기억합니다. 비밀번호 원문은 앱에 저장하지 않고 휴대폰 비밀번호 관리자/자동완성을 사용합니다.'
        : '가입 확인 메일은 업무수첩이 설치된 휴대폰에서 여는 것을 권장합니다. 인증이 끝나면 앱으로 돌아오며, 다른 기기에서 인증한 경우에는 이 앱으로 돌아와 로그인하면 됩니다.'}</Text>
      {message || authError ? <Text style={authError || messageTone === 'error' ? styles.errorText : messageTone === 'success' ? styles.successText : styles.infoText}>{authError || message}</Text> : null}
    </View></ScrollView></KeyboardAvoidingView></View>;

  if (initialBriefingState(Boolean(briefing), briefingError) !== 'ready') return <StartupScreen error={briefingError} onRetry={() => { setBriefingError(''); reload(); }} onSignOut={() => void run(signOut)} />;

  const briefingInfo = briefing ? briefingMetadata(briefing, briefingNow) : null;
  const journalTarget = journal?.targetDate || journalDate;
  const journalToday = journal?.today || seoulTodayKey();
  const journalIsFuture = journalTarget > journalToday;
  const overview = homeOverview(briefing!);
  const repeatProjection = recurringHomeProjection(overview.structure,recurring.works,seoulTodayKey());
  const structure = repeatProjection.structure;
  const repeatRow = (task: BriefingTask) => task.pageId ? repeatProjection.occurrences.get(task.pageId) : undefined;
  const openRepeat = (task: BriefingTask) => { const row=repeatRow(task); if(row)setRepeatDetail({workId:row.workRecordId,row}); };
  async function completeRepeat(task: BriefingTask) { const row=repeatRow(task); if(row&&await recurring.mutate(row.workRecordId,{op:'complete',key:row.key,originalDate:row.originalDate})) setRepeatUndo(row); }

  const activeFilter = taskFilter || firstNonEmptyTaskBucket(structure);
  const notes = briefing?.notes || [];
  const visibleNotes = notesExpanded ? notes : notes.slice(0, 3);
  const extraNotes = Math.max(0, notes.length - 3);
  const allSchedules = [...(briefing?.schedules?.today || []), ...(briefing?.schedules?.upcoming || [])];
  // Match feedback by the saved record, not by whichever notice happens to be
  // latest: Quick Voice and edited tasks must never be hidden by an old draft.
  const matchingDirectReminder = lastDirectSave?.recordId &&
    savedReminder?.target.recordId === lastDirectSave.recordId ? savedReminder : null;

  return <HomeReminderStatus client={client} briefing={briefing} scope={session.user.id} refreshKey={`${screen}:${briefingNow}:${Boolean(reminderTarget)}`}><View style={[styles.page, { paddingTop: insets.top }]}><StatusBar style="dark" /><KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}><View style={styles.authenticatedShell}><ScrollView style={styles.contentScroll} contentContainerStyle={[styles.scroll, { paddingBottom: QUICK_VOICE_LAYOUT.dockReserveHeight + Math.max(insets.bottom, 8) }]} keyboardDismissMode="on-drag" keyboardShouldPersistTaps="handled"><HomeHeader onOpenRecordSearch={() => setScreen('recordSearch')} onOpenSettings={() => setScreen('settings')} onOpenManagement={()=>{setManagementReturn('home');setScreen('subscriptions');}} />
    {savedReminder && !(screen === 'home' && matchingDirectReminder) ? <View style={styles.card}><Text accessibilityLiveRegion="polite">{savedReminder.message}</Text><Button title="🔔 이 기록의 알림 추가·확인" onPress={() => setReminderTarget(savedReminder.target)} /></View> : null}
    {screen === 'home' ? <>
      <MeetingRecordingBanner onOpen={() => setScreen('meeting')} />
      {lastDirectSave ? <View style={styles.saveFeedback}>
        <View style={styles.saveFeedbackHead}><View><Text style={styles.saveFeedbackEyebrow}>직접 입력 저장 결과</Text><Text style={styles.saveFeedbackTitle}>{lastDirectSave.scheduleWarning ? '⚠️ 날짜·시간 확인 필요' : '✅ 업무 저장 완료'}</Text></View><Pressable accessibilityRole="button" accessibilityLabel="직접 입력 저장 결과 닫기" onPress={() => { if (matchingDirectReminder) setSavedReminder(null); setLastDirectSave(null); }}><Text style={styles.saveFeedbackClose}>닫기</Text></Pressable></View>
        <Text style={styles.saveFeedbackText}>{lastDirectSave.transcript}</Text>
        {lastDirectSave.scheduleWarning ? <Text style={styles.errorText}>{lastDirectSave.scheduleWarning}</Text> : lastDirectSave.scheduleCreated ? <Text style={styles.saveFeedbackSchedule}>📅 일정 생성 완료{formatSavedDue(lastDirectSave.dueStart) ? ` · ${formatSavedDue(lastDirectSave.dueStart)}` : ''}</Text> : <Text style={styles.saveFeedbackMeta}>일정으로 해석된 날짜·시간은 없습니다.</Text>}
        {matchingDirectReminder ? <View style={styles.saveFeedbackReminder}>
          <Text accessibilityLiveRegion="polite" style={styles.saveFeedbackMeta}>{matchingDirectReminder.message}</Text>
          <Pressable accessibilityRole="button" accessibilityLabel="방금 저장한 기록 알림 확인" style={styles.saveFeedbackReminderAction} onPress={() => setReminderTarget(matchingDirectReminder.target)}>
            <Text style={styles.saveFeedbackReminderActionText}>알림 확인</Text>
          </Pressable>
        </View> : null}
      </View> : null}

      <View style={styles.homeHeading}>
        <View style={styles.sectionHead}><Text style={styles.homeDate}>{formatJournalDate(briefing?.today || seoulTodayKey()).replace(/^\d{4}년\s*/, '')}</Text><Pressable accessibilityRole="button" accessibilityLabel="홈 새로고침" style={styles.homeRefresh} onPress={() => void refreshBriefing()}><Text style={styles.linkText}>{briefingBusy ? '갱신 중…' : '새로고침'}</Text></Pressable></View>
        {briefing ? <Text style={styles.homeSummary}>할 일 {structure.today.length} · 일정 {config?.dataSchema === 'worklog' ? homeScheduleCount ?? '—' : briefing.schedules?.today?.length || 0} · <Text style={structure.overdue.length ? styles.homeOverdue : undefined}>기한 지남 {structure.overdue.length}</Text></Text> : null}
        {briefingInfo ? <View accessibilityLiveRegion="polite">{briefingInfo.warnings.map(warning => <Text key={warning} style={styles.errorText}>{warning}</Text>)}</View> : null}
        {briefingBusy && !briefing ? <View style={styles.loadingInline}><ActivityIndicator /><Text style={styles.statusText}>오늘 업무를 불러오는 중입니다.</Text></View> : null}
        {briefingError ? <View style={styles.errorPanel}><Text style={styles.errorText}>{briefingError}</Text><Button title="다시 시도" onPress={() => void refreshBriefing()} /></View> : null}
      </View>
      <HomeCalendar repeatingWorks={recurring.works} onOpenRepeating={(id,date)=>{const parts=id.split(':');setRepeatDetail({workId:parts[1],focusDate:date});}} key={session.user.id} today={briefing?.today || seoulTodayKey()} revision={homeCalendarRevision} fallback={allSchedules} focusId={notificationScheduleId} focusDate={allSchedules.find(s => s.scheduleId === notificationScheduleId)?.startsAt || (lastDirectSave?.scheduleId === notificationScheduleId ? lastDirectSave?.dueStart : undefined)} onTodayCount={setHomeScheduleCount}
        onOpenCalendar={day => { if (quickVoiceNavigation.current) { warnPendingVoice(); return; } setPersonalCalendarDate(day); setPersonalCalendarOpen(true); }}
        renderSchedule={schedule => <View>
          {schedule.scheduleId === notificationScheduleId ? <Text style={styles.helpText}>{scheduleFocusReason === 'created' ? '방금 생성된 일정' : '알림에서 연 일정'}</Text> : null}
          <ScheduleRows key={`${briefingNow}:${Boolean(reminderTarget)}`} schedules={[schedule]} empty="일정을 확인해주세요." onReminder={item => setReminderTarget({ scheduleId: item.scheduleId, title: item.title || '일정' })} />
          <View style={styles.headerActions}><Pressable accessibilityRole="button" style={styles.homeRefresh} onPress={() => setScreen('reminderSettings')}><Text style={styles.linkText}>알림 설정</Text></Pressable><Pressable accessibilityRole="button" style={styles.homeRefresh} onPress={() => Alert.alert('이 기기의 알림', '종 ✓ 초록: 이 기기 예약 확인\n종 − 회색: 알림 없음\n종 ! 빨강: 권한 필요\n종 ? 파랑: 확인 필요\n종을 누르면 예약 시점과 상세 상태를 확인합니다. 예약 확인은 실제 전달을 보장하지 않습니다.')}><Text style={styles.helpText}>이 기기 기준 · 알림 표시 도움말 ⓘ</Text></Pressable></View>
        </View>} />

      {briefing ? briefingBuckets.filter(bucket => bucket.key === activeFilter).map((bucket) => {
        const tasks = structure[bucket.key] || [];
        const expanded = expandedBuckets[bucket.key] === true;
        const visibleTasks = expanded ? tasks : tasks.slice(0, 3);
        const extra = Math.max(0, tasks.length - 3);
        return <View key={bucket.key} style={styles.homeTaskCard}>
          <View style={styles.briefingSectionHead}><Text style={styles.briefingSectionTitle}>{bucket.key === 'today' ? '오늘 할 일' : bucket.label}</Text><Pressable accessibilityRole="button" accessibilityState={{ expanded: taskFiltersExpanded }} style={styles.homeRefresh} onPress={() => setTaskFiltersExpanded(value => !value)}><Text style={styles.linkText}>{taskFiltersExpanded ? '접기' : '전체 보기 ›'}</Text></Pressable></View>
          {taskFiltersExpanded ? <View style={styles.homeFilters}>{briefingBuckets.map(bucket => <Pressable key={bucket.key} accessibilityRole="button" accessibilityState={{ selected: activeFilter === bucket.key }} style={[styles.homeFilter, activeFilter === bucket.key ? styles.homeFilterActive : null]} onPress={() => setTaskFilter(bucket.key)}><Text>{bucket.label} {structure[bucket.key].length}</Text></Pressable>)}</View> : null}
          {tasks.length ? visibleTasks.map((task, index) => <View key={task.pageId || `${bucket.key}-${index}`}>
            <HomeTaskRow bucket={bucket.key} task={task} onOpen={() => { if(repeatRow(task)){openRepeat(task);return;} setSelectedTask({ bucket: bucket.key, task }); setScreen('task'); }} onReminder={() => repeatRow(task)?openRepeat(task):setReminderTarget({ recordId: task.pageId, title: task.title || '업무' })} onEdit={() => repeatRow(task)?openRepeat(task):void openTaskEditor(task)} onDelete={repeatRow(task)?undefined:() => task.pageId ? confirmDeleteRecord(task.pageId, task.title || '업무', 'task') : undefined} onComplete={() => repeatRow(task)?void completeRepeat(task):void completeTaskInline(task)} completing={taskBusyId === task.pageId || (recurring.busy && !!repeatRow(task))} />
          </View>) : <Text style={styles.emptyText}>{bucket.key === 'today' ? '오늘 기한인 업무가 없습니다. 다른 기한은 전체 보기에서 확인하세요.' : '이 기한의 업무가 없습니다.'}</Text>}
          {extra ? <Pressable accessibilityRole="button" accessibilityLabel={expanded ? `${bucket.label} 접기` : `${bucket.label} ${extra}개 더 보기`} style={styles.moreButton} onPress={() => setExpandedBuckets((value) => ({ ...value, [bucket.key]: !expanded }))}><Text style={styles.moreButtonText}>{expanded ? '접기' : `${extra}개 더 보기`}</Text></Pressable> : null}
          {bucket.key !== 'overdue' && structure.overdue.length ? <Pressable accessibilityRole="button" style={styles.homeRefresh} onPress={() => { setTaskFilter('overdue'); setTaskFiltersExpanded(true); }}><Text style={styles.helpText}>기한 지난 업무 {structure.overdue.length}건 ›</Text></Pressable> : null}
          {!tasks.length && (structure.upcoming.length || structure.undated.length) ? <Text style={styles.helpText}>다가오는 업무 {structure.upcoming.length}건 · 기한 없는 업무 {structure.undated.length}건</Text> : null}
        </View>;
      }) : null}

      {recurring.notificationError ? <Text style={styles.helpText}>{recurring.notificationError}</Text> : null}
      {recurring.error ? <View><Text style={styles.errorText}>{recurring.error}</Text><Button title="반복 업무 다시 확인" onPress={() => void recurring.retry()}/></View> : null}
      {repeatUndo ? <View style={styles.undoBar}><Text style={styles.undoText}>{repeatUndo.title} 완료 저장 확인됨</Text><Pressable accessibilityRole="button" disabled={recurring.busy} onPress={async()=>{if(await recurring.mutate(repeatUndo.workRecordId,{op:'undo',key:repeatUndo.key,originalDate:repeatUndo.originalDate}))setRepeatUndo(null);}}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoTask ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoTask.title} 완료 처리</Text><Pressable accessibilityRole="button" disabled={Boolean(taskBusyId)} onPress={() => void undoCompletedTask()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoPostpone ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoPostpone.title} 미루기</Text><Pressable accessibilityRole="button" disabled={Boolean(reminderBusyId)} onPress={() => void undoPostponedTask()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}
      {undoAttention ? <View style={styles.undoBar}><Text style={styles.undoText}>{undoAttention.title} 다시 알림</Text><Pressable accessibilityRole="button" disabled={Boolean(reminderBusyId)} onPress={() => void undoTaskAttention()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}

      {notes.length ? <View style={[styles.briefingSection, styles.sectionNeutral]}>
        <View style={styles.briefingSectionHead}><Text style={styles.briefingSectionTitle}>📝 메모 · 참고</Text><Text style={styles.sectionCount}>{notes.length}</Text></View>
        {visibleNotes.map((note, index) => <NoteRow key={note.pageId || `note-${index}`} note={note} onReminder={() => setReminderTarget({ recordId: note.pageId, title: note.title || '메모' })} onEdit={() => void openNoteEditor(note)} onDelete={() => note.pageId ? confirmDeleteRecord(note.pageId, note.title || '메모', 'note') : undefined} onAcknowledge={() => void acknowledgeNote(note)} acknowledging={noteBusyId === note.pageId} />)}
        {extraNotes ? <Pressable accessibilityRole="button" accessibilityLabel={notesExpanded ? '메모 · 참고 접기' : `메모 · 참고 ${extraNotes}개 더 보기`} style={styles.moreButton} onPress={() => setNotesExpanded((value) => !value)}><Text style={styles.moreButtonText}>{notesExpanded ? '접기' : `${extraNotes}개 더 보기`}</Text></Pressable> : null}
      </View> : null}

      {undoNote ? <View style={styles.undoBar}><Text style={styles.undoText}>메모를 브리핑에서 내렸습니다.</Text><Pressable accessibilityRole="button" disabled={Boolean(noteBusyId)} onPress={() => void undoAcknowledgedNote()}><Text style={styles.undoAction}>실행 취소</Text></Pressable></View> : null}



      <View style={styles.homeInputTools}>
        <Pressable accessibilityRole="button" style={styles.homeInputTool} accessibilityHint="업무 · 메모 · 일정" onPress={() => setScreen('input')}><Text style={styles.homeInputLabel}>직접 입력</Text></Pressable>
        <View style={styles.homeInputTool}><CaptureImportButton compact disabled={quickVoiceNavigation.current} label="캡처 등록" /></View>
        <Pressable accessibilityRole="button" style={styles.homeInputTool} onPress={() => setScreen('meeting')}><Text style={styles.homeInputLabel}>회의 녹음</Text></Pressable>
      </View>
      {config?.dataSchema === 'worklog' ? <Pressable accessibilityRole="button" style={styles.homeRefresh} onPress={() => { if (quickVoiceNavigation.current) { warnPendingVoice(); return; } setPersonalCalendarDate(undefined); setPersonalCalendarOpen(true); }}><Text style={styles.linkText}>내 캘린더 · 일정 등록 ›</Text></Pressable> : null}


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

    {screen === 'input' ? <View style={styles.card}><PanelHead eyebrow="새 기록" title="직접 입력" onClose={() => setScreen('home')} /><ManualWorkInput value={manualInput} busy={busy || !manualDraftLoaded} onChange={(value) => { manualDraftEdited.current = true; manualDraftEpoch.current += 1; setManualInput(value); setManualDraftNotice(''); }} onSave={() => void persistDraft()}><RepeatOptions value={repeatRule} anchor={manualInput.dueDate} disabled={busy || !manualDraftLoaded} onChange={rule=>{manualDraftEdited.current=true;manualDraftEpoch.current++;setRepeatRule(rule);}}/></ManualWorkInput>{!manualDraftLoaded ? <Text style={styles.meta}>작성 중이던 기기 초안을 확인하는 중입니다.</Text> : null}{manualDraftNotice ? <Text style={styles.meta}>{manualDraftNotice}</Text> : null}{message ? <Text style={[styles.messageInline, messageTone === 'error' ? styles.messageError : messageTone === 'info' ? styles.messageInfo : null]}>{message}</Text> : null}</View> : null}
    {screen === 'meeting' ? <View style={styles.panel}><PanelHead eyebrow="장시간 녹음" title="회의 녹음" onClose={() => setScreen('home')} /><VoiceRecorderCard mode="meeting" /></View> : null}
    {screen === 'settings' ? <View style={styles.settingsPanel}>
      <PanelHead eyebrow="내 업무공간" title="설정" onClose={() => setScreen('home')} />
      <SettingsGroup title="기록">
        <SettingsMenuItem title="업무일지" accessibilityLabel="업무일지 열기" onPress={openJournal} />
        <SettingsMenuItem title="과거 업무 검색" onPress={() => setScreen('recordSearch')} />
      </SettingsGroup>
      <SettingsGroup title="내 관리">
        <SettingsMenuItem title="내 관리" description="정기지출 · 반복업무 · 습관" onPress={() => {setManagementReturn('settings');setScreen('subscriptions');}} />
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
    {screen === 'subscriptions' ? <View style={styles.panel}><PanelHead eyebrow="내 업무공간" title="내 관리" onClose={() => setScreen(managementReturn)} />{client ? <MyManagementScreen expenses={<SubscriptionsScreen key={session.user.id} client={client} ownerId={session.user.id}/>} habits={<HabitsScreen client={client}/>} recurring={<View style={{gap:12}}>
      {recurring.error?<View><Text accessibilityLiveRegion="polite" style={styles.errorText}>{recurring.error}</Text><Button title="반복 업무 다시 확인" disabled={recurring.busy} onPress={()=>void recurring.retry()}/></View>:null}
      {recurring.notificationError?<Text style={styles.helpText}>{recurring.notificationError}</Text>:null}
      {recurring.works.map(work=>{const revision=work.state.revisions.at(-1)!;const summary=repeatSummary(repeatHistory(work,shiftDay(seoulTodayKey(),90)),seoulTodayKey());return <Pressable key={work.workRecordId} accessibilityRole="button" accessibilityLabel={`${revision.title} 반복 상세`} style={[styles.card,{minHeight:48}]} onPress={()=>setRepeatDetail({workId:work.workRecordId})}><Text style={styles.taskTitle}>{revision.title}</Text><Text style={styles.taskMeta}>{work.state.endedOn?'종료됨 · 이력 보존':work.state.pauses.some(p=>!p.to)?'일시중지':`다음 예정 ${summary.nextDate||'기존 회차 처리 후 계산'}`}</Text><Text style={styles.taskMeta}>마지막 완료 {summary.lastCompleted||'없음'} · 지난 미완료 {summary.missed}건</Text></Pressable>;})}
      {!recurring.loaded&&!recurring.error?<Text style={styles.helpText}>반복 업무를 불러오는 중…</Text>:null}
      {recurring.loaded&&!recurring.error&&!recurring.works.length?<Text style={styles.helpText}>기존 업무나 직접 입력에서 반복을 한 번 설정하세요. 오늘 회차는 홈에서 완료할 수 있습니다.</Text>:null}
      <Button title="반복업무 등록" onPress={()=>{setRepeatRule(r=>r||{kind:'weekly',anchor:manualInput.dueDate||seoulTodayKey(),interval:1,weekdays:[5],unit:'day'});setScreen('input');}}/>
    </View>} /> : <Text style={styles.errorText}>로그인 상태를 확인하지 못했습니다. 다시 로그인해 주세요.</Text>}</View> : null}
    {screen === 'reminderSettings' ? <View style={styles.panel}><PanelHead eyebrow="설정" title="알림·리마인더" onClose={() => setScreen('settings')} /><ReminderSettings /></View> : null}
    {screen === 'patchNotes' ? <View style={styles.card}><PanelHead eyebrow="업데이트" title="패치노트" onClose={() => setScreen('settings')} /><Text style={styles.helpText}>{APP_BUILD_INFO.help}</Text><Text style={styles.body}>이 앱에 포함된 변경사항입니다. 최근 3건부터 확인할 수 있습니다.</Text>{MOBILE_PATCH_NOTES.slice(0, patchNotesExpanded ? undefined : 3).map((note) => <View key={`${note.date}-${note.title}`} style={styles.detailSection}><Text style={styles.meta}>{note.date}</Text><Text style={styles.detailTitle}>{note.title}</Text><Text style={styles.body}>{note.summary}</Text>{note.items.map((item) => <Text key={item} style={styles.patchNoteItem}>• {item}</Text>)}</View>)}{MOBILE_PATCH_NOTES.length > 3 ? <Pressable accessibilityRole="button" accessibilityLabel={patchNotesExpanded ? '이전 업데이트 접기' : `이전 업데이트 ${MOBILE_PATCH_NOTES.length - 3}건 더 보기`} style={styles.moreButton} onPress={() => setPatchNotesExpanded(value => !value)}><Text style={styles.moreButtonText}>{patchNotesExpanded ? '이전 업데이트 접기' : `이전 업데이트 ${MOBILE_PATCH_NOTES.length - 3}건 더 보기`}</Text></Pressable> : null}</View> : null}
  </ScrollView>
  {screen === 'home' ? <View pointerEvents="box-none" style={[styles.quickVoiceFooter, { paddingBottom: Math.max(insets.bottom, 8) }]}>
    <VoiceRecorderCard mode="quick" onOpenMeetingRecording={() => setScreen('meeting')} renderPhotoAction={disabled => <CaptureImportButton compact disabled={disabled} />} navigationGuard={quickVoiceNavigation} onOpenWorklogInput={(recognizedText) => {
      const recovered = recognizedText?.trim() || '';
      if (recovered) setManualInput((current) => current.transcript.trim() ? current : { ...current, transcript: recovered });
      setScreen('input');
    }} freezeQuickVoiceTimer={androidTouchSmoke} onQuickVoicePhaseChange={androidTouchSmoke ? (nextPhase) => console.info(`[android-touch-smoke] quick-voice-phase=${nextPhase}`) : undefined} quickVoice={{ ensureProvider: androidTouchSmoke ? async () => ANDROID_TOUCH_SMOKE_PROVIDER : prepareQuickVoiceWhisperProvider, speechRecognition: androidTouchSmoke || FORCE_WHISPER_FALLBACK_QA_MODE ? undefined : QUICK_VOICE_SPEECH_RECOGNITION, draftScope: session.user.id, saveWorklog: androidTouchSmoke ? async () => ({}) : async (transcript, options) => { if (!client) throw new Error('로그인 연결을 확인한 뒤 다시 시도해주세요.'); const reminderGuard = reminderSessionEpoch.capture(); const saved = await saveWorklog(await getFreshAccessToken(client), transcript, { ...options, sourceType: 'voice' }); let reminderMessage: string; try { const results = await synchronizeSavedScheduleReminders(saved, reminderGuard, client); reminderMessage = savedReminderMessage(results, saved.scheduleIds?.length || (saved.scheduleId ? 1 : 0)); } catch (nextError) { reminderMessage = reminderFailureMessage(nextError); } if (reminderGuard()) setSavedReminder({ target: { recordId: saved.dataCoreWorkRecordId || saved.pageId, scheduleId: saved.scheduleId, title: saved.cleanTranscript || transcript }, message: reminderMessage }); if (reminderGuard() && saved.scheduleId) { setNotificationScheduleId(saved.scheduleId); setScheduleFocusReason('created'); } return { reminderMessage, recordId: saved.dataCoreWorkRecordId || saved.pageId, scheduleDetected: Boolean(saved.scheduleDetected), scheduleCreated: Boolean(saved.scheduleCreated), scheduleId: saved.scheduleId || '', dueStart: saved.dueStart || '' }; }, refreshBriefing: refreshQuickVoiceBriefing }} />
  </View> : null}
    {client && reminderTarget ? <WorklogReminderSheet key={`${session.user.id}:${reminderTarget.scheduleId || reminderTarget.recordId}`} client={client} target={reminderTarget} onClose={() => setReminderTarget(null)} /> : null}
  {repeatCreating && editTaskId ? <Modal visible animationType="slide" onRequestClose={()=>setRepeatCreating(false)}><ScrollView contentContainerStyle={[styles.scroll,{paddingTop:insets.top+16,paddingBottom:insets.bottom+24}]}><PanelHead eyebrow="기존 업무" title="반복 설정" onClose={()=>setRepeatCreating(false)}/><RepeatFromRecord initial={{transcript:editTitle,dueDate:editDate||seoulTodayKey(),dueTime:editTime}} busy={recurring.busy} onSave={async revision=>{try{const guard=reminderSessionEpoch.capture();const links=await findWorklogReminderLinks(client!,[editTaskId],guard);if(!guard()||repeatCreateTarget.current!==editTaskId)return false;if(await recurring.mutate(editTaskId,{op:'create',revision:{...revision,sourceScheduleIds:[...new Set(links[editTaskId]||[])].sort()}})){setRepeatCreating(false);setEditTaskId(null);return true;}}catch{showMessage('연결된 일정 확인 필요 · 입력을 유지했습니다. 다시 시도해주세요.','error');}return false;}}/>{recurring.error?<Text style={styles.errorText}>{recurring.error}</Text>:null}</ScrollView></Modal> : null}
  {repeatDetail && recurring.loaded && !recurring.works.some(w=>w.workRecordId===repeatDetail.workId)?<Modal visible onRequestClose={()=>setRepeatDetail(null)}><View style={[styles.scroll,{paddingTop:insets.top+24}]}><Text style={styles.body}>반복 업무를 찾지 못했거나 접근할 수 없습니다.</Text><Button title="닫기" onPress={()=>setRepeatDetail(null)}/></View></Modal>:null}
  {repeatDetail && recurring.works.some(w=>w.workRecordId===repeatDetail.workId) ? <Modal visible animationType="slide" onRequestClose={()=>setRepeatDetail(null)}><ScrollView contentContainerStyle={[styles.scroll,{paddingTop:insets.top+16,paddingBottom:insets.bottom+24}]}><RecurringDetail key={repeatDetail.workId} work={recurring.works.find(w=>w.workRecordId===repeatDetail.workId)!} today={seoulTodayKey()} busy={recurring.busy} selected={repeatDetail.row} focusDate={repeatDetail.focusDate} onClose={()=>setRepeatDetail(null)} onMutate={command=>recurring.mutate(repeatDetail.workId,command)}/>{recurring.error?<Text style={styles.errorText}>{recurring.error}</Text>:null}</ScrollView></Modal> : null}
  {personalCalendarOpen && config?.dataSchema === 'worklog' ? <PersonalCalendarSheet repeatingWorks={recurring.works} onOpenRepeating={(id,date)=>{setPersonalCalendarOpen(false);setRepeatDetail({workId:id.split(':')[1],focusDate:date});}} key={session.user.id} initialDate={personalCalendarDate} onClose={() => setPersonalCalendarOpen(false)} onSaved={() => { void refreshBriefing(); }} /> : null}
  <WorkRecordEditSheet
    allowTitleWhileLoading
    allowFieldsWhileLoading
    visible={Boolean(editTaskId) && !repeatCreating}
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
    onDate={(value) => { editDirty.current.date = true; setEditDate(value); }}
    onTime={(value) => { editDirty.current.time = true; setEditTime(value); }}
    onActionKind={(value) => { editDirty.current.kind = true; setEditActionKind(value); }}
    onSave={() => void saveTaskEditor()}
    onCancel={closeTaskEditor}
    onRetry={() => void retryTaskEditor()}
    onRepeat={config?.dataSchema === 'worklog' ? ()=>setRepeatCreating(true) : undefined}
  />
</View></KeyboardAvoidingView></View></HomeReminderStatus>;
}

function PanelHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <View style={styles.sectionHead}><View style={styles.sectionHeadText}><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View><Pressable accessibilityRole="button" style={styles.closeButton} onPress={onClose}><Text style={styles.linkText}>닫기</Text></Pressable></View>;
}

const styles = StyleSheet.create({
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
  headerTitleWrap: { flex: 1, minWidth: 0 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: '#17191d', flexShrink: 1 },
  headerActions: { flexDirection: 'row', gap: 8 },
  headerButton: { width: mobileTheme.size.touchTarget, height: mobileTheme.size.touchTarget, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: mobileTheme.colors.border, borderRadius: 14, backgroundColor: mobileTheme.colors.surface },
  headerButtonIcon: { fontSize: 21 },
  headerManagementText: { fontSize: 13, fontWeight: '800', color: mobileTheme.colors.text },
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
  taskRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(107,114,128,0.15)' },
  focusTaskRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderTopWidth: 1, borderTopColor: 'rgba(107,114,128,0.15)' },
  focusMetaLine: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 },
  focusReason: { fontSize: 13, fontWeight: '800', color: '#9a3412', lineHeight: 18 },
  focusStatus: { fontSize: 11, fontWeight: '800', color: '#374151', backgroundColor: '#e5e7eb', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  taskMain: { flex: 1, minWidth: 0, gap: 3 },
  taskActions: { flexShrink: 0, gap: 6, alignItems: 'stretch' },
  focusTaskActions: { flexShrink: 0, gap: 6, alignItems: 'stretch' },
  taskMinorActions: { flexDirection: 'row', gap: 6 },
  taskTitle: recordRowStyles.taskTitle,
  taskMeta: recordRowStyles.taskMeta,
  taskBadge: { alignSelf: 'flex-start', fontSize: 11, fontWeight: '700', color: '#374151', backgroundColor: '#e5e7eb', paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999 },
  followUp: { fontSize: 13, color: '#4b515c', lineHeight: 18 },
  reminderShortcut: { alignSelf: 'flex-start', minHeight: 40, justifyContent: 'center', paddingHorizontal: 11, marginTop: 8, borderRadius: 10, borderWidth: 1, borderColor: '#93b5e6', backgroundColor: '#eaf3ff' },
  reminderShortcutText: { color: '#20599a', fontSize: 12, fontWeight: '900' },
  inlineEdit: recordRowStyles.inlineEdit,
  inlineEditText: recordRowStyles.inlineEditText,
  inlineDelete: recordRowStyles.inlineDelete,
  inlineDeleteText: recordRowStyles.inlineDeleteText,
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
  homeHeading: { gap: 6 },
  homeDate: { flex: 1, fontSize: 22, fontWeight: '800', color: mobileTheme.colors.text },
  homeSummary: { fontSize: 15, lineHeight: 23, color: mobileTheme.colors.textSecondary },
  homeOverdue: { color: mobileTheme.colors.danger },
  homeRefresh: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  homeTaskCard: { padding: 14, gap: 6, borderRadius: 20, borderWidth: 1, borderColor: mobileTheme.colors.border, backgroundColor: mobileTheme.colors.surface },
  homeTaskEntry: { paddingVertical: 8, gap: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: mobileTheme.colors.borderSubtle },
  homeTaskLine: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  homeTaskUtilities: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  homeTaskOpen: { minHeight: 44, justifyContent: 'center', gap: 3 },
  homeTaskTitle: { fontSize: 16, color: mobileTheme.colors.text },
  homeInputTools: { flexDirection: 'row', gap: 8 },
  homeInputTool: { flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 1, borderColor: mobileTheme.colors.border, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  homeInputLabel: { fontSize: 14, color: mobileTheme.colors.text, fontWeight: '600' },
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
