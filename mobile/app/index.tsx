import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { VoiceRecorderCard } from '@/src/features/voice/voice-recorder-card';
import { loadBriefing, saveWorklog } from '@/src/platform/worklog-api';
import { usePlatform } from '@/src/providers/platform-provider';

export default function HomeScreen() {
  const {
    phase,
    session,
    error,
    authError,
    rememberedEmail,
    reload,
    clearAuthError,
    signIn,
    signInWithGoogle,
    signOut,
    config,
  } = usePlatform();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [briefingMessage, setBriefingMessage] = useState('');
  const [briefingError, setBriefingError] = useState('');
  const [busy, setBusy] = useState(false);
  const [briefingBusy, setBriefingBusy] = useState(false);

  useEffect(() => {
    if (!email && rememberedEmail) setEmail(rememberedEmail);
  }, [email, rememberedEmail]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await action();
    } catch (nextError) {
      setMessage(nextError instanceof Error ? nextError.message : '처리 중 오류가 발생했습니다.');
    } finally {
      setBusy(false);
    }
  }

  async function runEmailSignIn() {
    const normalizedEmail = email.trim();
    if (!normalizedEmail || !password || busy) return;
    await run(() => signIn(normalizedEmail, password));
  }

  async function runBriefing() {
    if (!session || briefingBusy) return;

    setBriefingBusy(true);
    setBriefingMessage('');
    setBriefingError('');
    try {
      const result = await loadBriefing(session.access_token);
      setBriefingMessage(`브리핑 연결 성공\n${JSON.stringify(result.counts || {}, null, 2)}`);
    } catch (nextError) {
      setBriefingError(nextError instanceof Error ? nextError.message : '브리핑을 불러오지 못했습니다.');
    } finally {
      setBriefingBusy(false);
    }
  }

  if (phase === 'loading') {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator size="large" />
        <Text style={styles.statusText}>업무수첩을 연결하고 있습니다.</Text>
      </SafeAreaView>
    );
  }

  if (phase === 'error') {
    return (
      <SafeAreaView style={styles.center}>
        <Text style={styles.title}>연결을 확인해주세요</Text>
        <Text style={styles.errorText}>{error}</Text>
        <Button title="다시 시도" onPress={reload} />
      </SafeAreaView>
    );
  }

  if (!session) {
    return (
      <SafeAreaView style={styles.page}>
        <StatusBar style="auto" />
        <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.eyebrow}>MOBILE AUTH 0.2</Text>
            <Text style={styles.title}>업무수첩</Text>
            <Text style={styles.body}>가장 편한 방법으로 기존 업무공간에 로그인합니다.</Text>

            <Button
              title="Google로 시작"
              disabled={busy}
              onPress={() => run(signInWithGoogle)}
            />

            <View style={styles.dividerRow}>
              <View style={styles.dividerLine} />
              <Text style={styles.dividerText}>또는 이메일</Text>
              <View style={styles.dividerLine} />
            </View>

            <TextInput
              accessibilityLabel="이메일"
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              importantForAutofill="yes"
              keyboardType="email-address"
              placeholder="이메일"
              returnKeyType="next"
              style={styles.input}
              textContentType="username"
              value={email}
              onChangeText={(value) => {
                setEmail(value);
                clearAuthError();
              }}
            />

            <View style={styles.passwordRow}>
              <TextInput
                accessibilityLabel="비밀번호"
                autoCapitalize="none"
                autoComplete="current-password"
                autoCorrect={false}
                importantForAutofill="yes"
                placeholder="비밀번호"
                returnKeyType="done"
                secureTextEntry={!showPassword}
                style={[styles.input, styles.passwordInput]}
                textContentType="password"
                value={password}
                onChangeText={(value) => {
                  setPassword(value);
                  clearAuthError();
                }}
                onSubmitEditing={() => void runEmailSignIn()}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={showPassword ? '비밀번호 숨기기' : '비밀번호 보기'}
                hitSlop={8}
                style={styles.passwordToggle}
                onPress={() => setShowPassword((value) => !value)}
              >
                <Text style={styles.passwordToggleText}>{showPassword ? '숨기기' : '보기'}</Text>
              </Pressable>
            </View>

            <Button
              title={busy ? '로그인 중...' : '이메일로 로그인'}
              disabled={busy || !email.trim() || !password}
              onPress={() => void runEmailSignIn()}
            />
            <Text style={styles.authHint}>
              이메일은 마지막 사용 계정을 기억합니다. 비밀번호 원문은 앱에 저장하지 않고 휴대폰 비밀번호 관리자/자동완성을 사용합니다.
            </Text>
            {message || authError ? <Text style={styles.errorText}>{message || authError}</Text> : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <StatusBar style="auto" />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.eyebrow}>CONNECTED</Text>
          <Text style={styles.title}>업무수첩 모바일</Text>
          <Text style={styles.body}>{session.user.email || '로그인 사용자'}</Text>
          <Text style={styles.meta}>Data Core primary: {config?.dataCorePrimaryEnabled ? 'ON' : 'OFF'}</Text>
        </View>

        <VoiceRecorderCard />

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>업무 상황 읽기</Text>
          <Button
            title={briefingBusy ? '브리핑 불러오는 중...' : '브리핑 불러오기'}
            disabled={briefingBusy}
            onPress={runBriefing}
          />
          {briefingMessage ? <Text style={styles.messageInline}>{briefingMessage}</Text> : null}
          {briefingError ? <Text style={styles.errorText}>{briefingError}</Text> : null}
        </View>

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>업무 1건 저장</Text>
          <TextInput
            multiline
            placeholder="예: 내일 오후 3시 김과장에게 계약서 확인 전화"
            style={[styles.input, styles.multiline]}
            value={draft}
            onChangeText={setDraft}
          />
          <Button
            title={busy ? '저장 중...' : '저장 테스트'}
            disabled={busy || !draft.trim()}
            onPress={() =>
              run(async () => {
                const result = await saveWorklog(session.access_token, draft.trim());
                setDraft('');
                setMessage(`저장 성공: ${String(result.dataCoreWorkRecordId || 'OK')}`);
              })
            }
          />
        </View>

        {message ? <Text style={styles.message}>{message}</Text> : null}
        <Button title="로그아웃" disabled={busy} onPress={() => run(signOut)} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#f4f5f7' },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
    padding: 24,
    backgroundColor: '#f4f5f7',
  },
  loginScroll: { flexGrow: 1, justifyContent: 'center', padding: 20 },
  scroll: { padding: 20, gap: 16 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 20,
    padding: 20,
    gap: 14,
  },
  eyebrow: { fontSize: 12, fontWeight: '700', letterSpacing: 1.2, color: '#5f6570' },
  title: { fontSize: 28, fontWeight: '800', color: '#17191d' },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#17191d' },
  body: { fontSize: 16, color: '#4b515c' },
  meta: { fontSize: 13, color: '#737985' },
  statusText: { fontSize: 15, color: '#4b515c' },
  input: {
    borderWidth: 1,
    borderColor: '#d7dae0',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: '#ffffff',
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  passwordInput: { flex: 1 },
  passwordToggle: {
    minWidth: 58,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#d7dae0',
    borderRadius: 12,
    backgroundColor: '#ffffff',
  },
  passwordToggleText: { fontSize: 14, fontWeight: '700', color: '#30343b' },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e1e4e8' },
  dividerText: { fontSize: 12, fontWeight: '700', color: '#8a9099' },
  authHint: { fontSize: 12, color: '#737985', lineHeight: 18 },
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  errorText: { color: '#b42318', lineHeight: 20 },
  messageInline: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f4f5f7',
    color: '#30343b',
    lineHeight: 20,
  },
  message: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    color: '#30343b',
    lineHeight: 20,
  },
});
