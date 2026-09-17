import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, BackHandler, Button, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { VoiceRecorderCard } from '@/src/features/voice/voice-recorder-card';
import { ScheduleDeviceActions } from '@/src/features/schedule/schedule-device-actions';
import { type BriefingSchedule, type BriefingTask, type MobileBriefing, loadBriefing, saveWorklog } from '@/src/platform/worklog-api';
import { usePlatform } from '@/src/providers/platform-provider';

type AppScreen = 'home' | 'briefing' | 'input' | 'meeting' | 'settings';
type BriefingBucket = 'overdue' | 'today' | 'upcoming' | 'undated';

const briefingBuckets: Array<{ key: BriefingBucket; label: string; tone: 'danger' | 'warning' | 'info' | 'neutral' }> = [
  { key: 'overdue', label: '지난 것', tone: 'danger' },
  { key: 'today', label: '오늘 할 일', tone: 'warning' },
  { key: 'upcoming', label: '다가오는 업무', tone: 'info' },
  { key: 'undated', label: '기한 없는 업무', tone: 'neutral' },
];

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function formatSchedule(schedule: BriefingSchedule) {
  if (schedule.allDay) return `${schedule.dateKey || '날짜 미정'} · 종일`;
  if (!schedule.startsAt) return schedule.dateKey || '시간 미정';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(schedule.startsAt));
}

function taskNote(bucket: BriefingBucket, task: BriefingTask) {
  if (bucket === 'overdue') return `${task.dueKey || '기한'}${task.daysOverdue ? ` · ${task.daysOverdue}일 지남` : ''}`;
  if (bucket === 'today') return '오늘 기한';
  if (bucket === 'upcoming') return `${task.dueKey || '기한'}${task.daysUntil ? ` · ${task.daysUntil}일 후` : ''}`;
  return '기한 없음';
}

function TaskRow({ bucket, task }: { bucket: BriefingBucket; task: BriefingTask }) {
  return <View style={styles.taskRow}><Text style={styles.taskTitle}>{task.title || '제목 없는 업무'}</Text><Text style={styles.taskMeta}>{taskNote(bucket, task)}{task.status ? ` · ${task.status}` : ''}</Text>{task.followUp ? <Text style={styles.followUp}>다음: {task.followUp}</Text> : null}</View>;
}

function ScheduleRows({ schedules, empty }: { schedules?: BriefingSchedule[]; empty: string }) {
  if (!schedules?.length) return <Text style={styles.emptyText}>{empty}</Text>;
  return schedules.map((schedule, index) => <View key={schedule.scheduleId || `${schedule.title}-${index}`} style={styles.scheduleRow}><Text style={styles.scheduleDate}>{formatSchedule(schedule)}</Text><Text style={styles.taskTitle}>{schedule.title || '제목 없는 일정'}</Text>{schedule.location ? <Text style={styles.taskMeta}>{schedule.location}</Text> : null}<ScheduleDeviceActions schedule={schedule} /></View>);
}

export default function HomeScreen() {
  const { phase, session, error, authError, rememberedEmail, reload, clearAuthError, signIn, signInWithGoogle, signOut, config } = usePlatform();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [draft, setDraft] = useState('');
  const [screen, setScreen] = useState<AppScreen>('home');
  const [message, setMessage] = useState('');
  const [briefing, setBriefing] = useState<MobileBriefing | null>(null);
  const [briefingError, setBriefingError] = useState('');
  const [briefingBusy, setBriefingBusy] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!email && rememberedEmail) setEmail(rememberedEmail); }, [email, rememberedEmail]);
  useEffect(() => {
    if (!session) { setBriefing(null); setScreen('home'); return; }
    void refreshBriefing();
  }, [session?.access_token]);
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'home') return false;
      setScreen('home');
      return true;
    });
    return () => subscription.remove();
  }, [screen]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage('');
    try { await action(); } catch (nextError) { setMessage(messageOf(nextError, '처리 중 오류가 발생했습니다.')); } finally { setBusy(false); }
  }
  async function refreshBriefing() {
    if (!session || briefingBusy) return;
    setBriefingBusy(true); setBriefingError('');
    try { setBriefing(await loadBriefing(session.access_token)); } catch (nextError) { setBriefingError(messageOf(nextError, '브리핑을 불러오지 못했습니다.')); } finally { setBriefingBusy(false); }
  }
  async function runEmailSignIn() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password || busy) return;
    await run(() => signIn(normalizedEmail, password));
  }
  async function persistDraft() {
    if (!session || !draft.trim() || busy) return;
    await run(async () => {
      await saveWorklog(session.access_token, draft.trim());
      setDraft(''); setMessage('업무를 저장했습니다. 브리핑을 최신 상태로 불러옵니다.'); setScreen('home');
      await refreshBriefing();
    });
  }

  if (phase === 'loading') return <SafeAreaView style={styles.center}><ActivityIndicator size="large" /><Text style={styles.statusText}>업무수첩을 연결하고 있습니다.</Text></SafeAreaView>;
  if (phase === 'error') return <SafeAreaView style={styles.center}><Text style={styles.title}>연결을 확인해주세요</Text><Text style={styles.errorText}>{error}</Text><Button title="다시 시도" onPress={reload} /></SafeAreaView>;

  if (!session) return <SafeAreaView style={styles.page}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled"><View style={styles.loginHero}><Text style={styles.eyebrow}>나의 개인 업무공간</Text><Text style={styles.title}>🎙 업무수첩</Text><Text style={styles.body}>말하면 기록되고, 일정까지 한눈에</Text></View><View style={styles.card}><Text style={styles.sectionTitle}>바로 시작하기</Text><Text style={styles.body}>Google 계정으로 가장 빠르게 시작할 수 있습니다.</Text><Button title="Google로 시작" disabled={busy} onPress={() => void run(signInWithGoogle)} /><View style={styles.dividerRow}><View style={styles.dividerLine} /><Text style={styles.dividerText}>또는 이메일로</Text><View style={styles.dividerLine} /></View><TextInput accessibilityLabel="이메일" autoCapitalize="none" autoComplete="email" autoCorrect={false} importantForAutofill="yes" keyboardType="email-address" placeholder="이메일" returnKeyType="next" style={styles.input} textContentType="username" value={email} onChangeText={(value) => { setEmail(value); clearAuthError(); }} /><View style={styles.passwordRow}><TextInput accessibilityLabel="비밀번호" autoCapitalize="none" autoComplete="current-password" autoCorrect={false} importantForAutofill="yes" placeholder="비밀번호" returnKeyType="done" secureTextEntry={!showPassword} style={[styles.input, styles.passwordInput]} textContentType="password" value={password} onChangeText={(value) => { setPassword(value); clearAuthError(); }} onSubmitEditing={() => void runEmailSignIn()} /><Pressable accessibilityRole="button" accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'} hitSlop={8} style={styles.passwordToggle} onPress={() => setShowPassword((value) => !value)}><Text style={styles.passwordToggleText}>{showPassword ? '숨기기' : '보기'}</Text></Pressable></View><Button title={busy ? '로그인 중...' : '이메일로 로그인'} disabled={busy || !email.trim() || !password} onPress={() => void runEmailSignIn()} /><Text style={styles.authHint}>이메일은 마지막 사용 계정을 기억합니다. 비밀번호 원문은 앱에 저장하지 않고 휴대폰 비밀번호 관리자/자동완성을 사용합니다.</Text>{message || authError ? <Text style={styles.errorText}>{message || authError}</Text> : null}</View></ScrollView></SafeAreaView>;

  const counts = briefing?.counts || {};
  const structure = briefing?.structure || {};
  return <SafeAreaView style={styles.page}><StatusBar style="dark" /><ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled"><View style={styles.header}><View><Text style={styles.eyebrow}>나의 개인 업무공간</Text><Text style={styles.headerTitle}>🎙 업무수첩</Text></View><Pressable accessibilityRole="button" accessibilityLabel="설정 열기" style={styles.settingsButton} onPress={() => setScreen('settings')}><Text style={styles.settingsIcon}>⚙</Text></Pressable></View>
    {screen === 'home' ? <><View style={styles.card}><View style={styles.sectionHead}><View><Text style={styles.eyebrow}>오늘의 브리핑</Text><Text style={styles.sectionTitle}>지금 확인할 것</Text></View><Pressable accessibilityRole="button" onPress={() => setScreen('briefing')}><Text style={styles.linkText}>전체 보기</Text></Pressable></View>{briefingBusy && !briefing ? <View style={styles.loadingInline}><ActivityIndicator /><Text style={styles.statusText}>오늘 업무를 불러오는 중입니다.</Text></View> : null}{briefingError ? <View style={styles.errorPanel}><Text style={styles.errorText}>{briefingError}</Text><Button title="다시 시도" onPress={() => void refreshBriefing()} /></View> : null}{briefing ? <View style={styles.countGrid}>{briefingBuckets.map((bucket) => <Pressable key={bucket.key} accessibilityRole="button" accessibilityLabel={`${bucket.label} ${Number(counts[bucket.key] || 0)}건, 전체 브리핑 열기`} style={[styles.countTile, countToneStyles[bucket.tone]]} onPress={() => setScreen('briefing')}><Text style={styles.countLabel}>{bucket.label}</Text><Text style={styles.countValue}>{Number(counts[bucket.key] || 0)}</Text></Pressable>)}</View> : null}{briefing && Number(counts.total || 0) === 0 ? <Text style={styles.emptyText}>현재 미완료 업무가 없습니다.</Text> : null}</View><VoiceRecorderCard mode="quick" /><View style={styles.actionGrid}><Pressable accessibilityRole="button" style={styles.actionCard} onPress={() => setScreen('meeting')}><Text style={styles.actionIcon}>⏺</Text><Text style={styles.actionTitle}>회의 녹음</Text><Text style={styles.actionBody}>긴 회의 · 일시정지 · 화면 잠금</Text></Pressable><Pressable accessibilityRole="button" style={styles.actionCard} onPress={() => setScreen('input')}><Text style={styles.actionIcon}>⌨</Text><Text style={styles.actionTitle}>직접 입력</Text><Text style={styles.actionBody}>업무를 바로 저장</Text></Pressable></View>{message ? <Text style={styles.message}>{message}</Text> : null}</> : null}
    {screen === 'briefing' ? <View style={styles.card}><PanelHead eyebrow="전체 브리핑" title="오늘 업무 상황" onClose={() => setScreen('home')} /><Button title={briefingBusy ? '브리핑 정리 중...' : '브리핑 다시 정리'} disabled={briefingBusy} onPress={() => void refreshBriefing()} />{briefingError ? <Text style={styles.errorText}>{briefingError}</Text> : null}{briefingBuckets.map((bucket) => <View key={bucket.key} style={styles.detailSection}><Text style={styles.detailTitle}>{bucket.label} · {Number(counts[bucket.key] || 0)}건</Text>{structure[bucket.key]?.length ? structure[bucket.key]?.map((task, index) => <TaskRow key={task.pageId || `${bucket.key}-${index}`} bucket={bucket.key} task={task} />) : <Text style={styles.emptyText}>해당 업무가 없습니다.</Text>}</View>)}{briefing?.scheduleEnabled ? <View style={styles.detailSection}><Text style={styles.detailTitle}>📅 오늘 일정</Text><ScheduleRows schedules={briefing.schedules?.today} empty="오늘 확정 일정이 없습니다." /><Text style={styles.detailTitle}>14일 이내 일정</Text><ScheduleRows schedules={briefing.schedules?.upcoming} empty="다가오는 일정이 없습니다." /></View> : null}</View> : null}
    {screen === 'input' ? <View style={styles.card}><PanelHead eyebrow="새 기록" title="직접 입력" onClose={() => setScreen('home')} /><Text style={styles.body}>입력한 원문을 기존 업무수첩에 저장합니다.</Text><TextInput accessibilityLabel="업무 내용" multiline placeholder="예: 내일 오후 3시 김과장에게 계약서 확인 전화" style={[styles.input, styles.multiline]} value={draft} onChangeText={setDraft} textAlignVertical="top" /><Button title={busy ? '저장 중...' : '저장'} disabled={busy || !draft.trim()} onPress={() => void persistDraft()} />{message ? <Text style={styles.messageInline}>{message}</Text> : null}</View> : null}
    {screen === 'meeting' ? <View style={styles.panel}><PanelHead eyebrow="장시간 녹음" title="회의 녹음" onClose={() => setScreen('home')} /><VoiceRecorderCard mode="meeting" /></View> : null}
    {screen === 'settings' ? <View style={styles.card}><PanelHead eyebrow="설정" title="내 업무공간" onClose={() => setScreen('home')} /><Text style={styles.body}>{session.user.email || '로그인 사용자'}</Text><Text style={styles.meta}>Data Core primary: {config?.dataCorePrimaryEnabled ? 'ON' : 'OFF'}</Text><Button title="로그아웃" disabled={busy} onPress={() => void run(signOut)} /></View> : null}
  </ScrollView></SafeAreaView>;
}

function PanelHead({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) {
  return <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View><Pressable accessibilityRole="button" onPress={onClose}><Text style={styles.linkText}>닫기</Text></Pressable></View>;
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f5f7' }, center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, backgroundColor: '#f4f5f7' }, scroll: { padding: 20, gap: 16, paddingBottom: 36 }, loginScroll: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 16 }, header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 }, headerTitle: { fontSize: 28, fontWeight: '800', color: '#17191d' }, loginHero: { gap: 8, padding: 8 }, card: { backgroundColor: '#ffffff', borderRadius: 20, padding: 20, gap: 14 }, panel: { gap: 12 }, eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.1, color: '#5f6570' }, title: { fontSize: 28, fontWeight: '800', color: '#17191d' }, sectionTitle: { fontSize: 20, fontWeight: '800', color: '#17191d' }, body: { fontSize: 15, color: '#4b515c', lineHeight: 22 }, meta: { fontSize: 13, color: '#737985' }, statusText: { fontSize: 15, color: '#4b515c' }, settingsButton: { minWidth: 46, minHeight: 46, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d7dae0', borderRadius: 14, backgroundColor: '#fff' }, settingsIcon: { fontSize: 21 }, sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 }, linkText: { color: '#275daf', fontWeight: '800', padding: 8 }, countGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, countTile: { width: '47%', minHeight: 92, padding: 14, borderRadius: 14, justifyContent: 'space-between' }, countDanger: { backgroundColor: '#fff0f0' }, countWarning: { backgroundColor: '#fff5e7' }, countInfo: { backgroundColor: '#edf4ff' }, countNeutral: { backgroundColor: '#f1f3f5' }, countLabel: { fontSize: 13, fontWeight: '700', color: '#4b515c' }, countValue: { fontSize: 30, fontWeight: '800', color: '#17191d' }, loadingInline: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 16 }, errorPanel: { gap: 10 }, errorText: { color: '#b42318', lineHeight: 20 }, emptyText: { color: '#737985', lineHeight: 20, paddingVertical: 4 }, actionGrid: { flexDirection: 'row', gap: 12 }, actionCard: { flex: 1, minHeight: 132, borderRadius: 18, padding: 16, gap: 6, backgroundColor: '#fff' }, actionIcon: { fontSize: 24 }, actionTitle: { fontSize: 17, fontWeight: '800', color: '#17191d' }, actionBody: { fontSize: 13, color: '#737985', lineHeight: 18 }, detailSection: { gap: 8, borderTopWidth: 1, borderTopColor: '#eceef1', paddingTop: 16 }, detailTitle: { fontSize: 16, fontWeight: '800', color: '#17191d' }, taskRow: { paddingVertical: 8, gap: 3 }, taskTitle: { fontSize: 15, fontWeight: '700', color: '#30343b', lineHeight: 21 }, taskMeta: { fontSize: 13, color: '#737985', lineHeight: 18 }, followUp: { fontSize: 13, color: '#4b515c', lineHeight: 18 }, scheduleRow: { gap: 3, borderLeftWidth: 3, borderLeftColor: '#80a9e8', paddingLeft: 10, paddingVertical: 5 }, scheduleDate: { fontSize: 13, fontWeight: '700', color: '#275daf' }, input: { borderWidth: 1, borderColor: '#d7dae0', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, backgroundColor: '#fff' }, multiline: { minHeight: 150 }, passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, passwordInput: { flex: 1 }, passwordToggle: { minWidth: 58, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#d7dae0', borderRadius: 12, backgroundColor: '#fff' }, passwordToggleText: { fontSize: 14, fontWeight: '700', color: '#30343b' }, dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 }, dividerLine: { flex: 1, height: 1, backgroundColor: '#e1e4e8' }, dividerText: { fontSize: 12, fontWeight: '700', color: '#8a9099' }, authHint: { fontSize: 12, color: '#737985', lineHeight: 18 }, message: { padding: 14, borderRadius: 12, backgroundColor: '#eaf4ea', color: '#245c2a', lineHeight: 20 }, messageInline: { padding: 12, borderRadius: 10, backgroundColor: '#eaf4ea', color: '#245c2a', lineHeight: 20 },
});

const countToneStyles = {
  danger: styles.countDanger,
  warning: styles.countWarning,
  info: styles.countInfo,
  neutral: styles.countNeutral,
};
