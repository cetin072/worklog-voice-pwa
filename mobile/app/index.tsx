import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { loadBriefing, saveWorklog } from '@/src/platform/worklog-api';
import { usePlatform } from '@/src/providers/platform-provider';

export default function HomeScreen() {
  const { phase, session, error, reload, signIn, signOut, config } = usePlatform();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [draft, setDraft] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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
        <View style={styles.card}>
          <Text style={styles.eyebrow}>MOBILE FOUNDATION 0.1</Text>
          <Text style={styles.title}>업무수첩</Text>
          <Text style={styles.body}>기존 Platform 계정으로 로그인합니다.</Text>
          <TextInput
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="이메일"
            style={styles.input}
            value={email}
            onChangeText={setEmail}
          />
          <TextInput
            autoCapitalize="none"
            autoComplete="password"
            placeholder="비밀번호"
            secureTextEntry
            style={styles.input}
            value={password}
            onChangeText={setPassword}
          />
          <Button
            title={busy ? '로그인 중...' : '로그인'}
            disabled={busy || !email.trim() || !password}
            onPress={() => run(() => signIn(email.trim(), password))}
          />
          {message ? <Text style={styles.errorText}>{message}</Text> : null}
        </View>
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

        <View style={styles.card}>
          <Text style={styles.sectionTitle}>업무 상황 읽기</Text>
          <Button
            title="브리핑 불러오기"
            disabled={busy}
            onPress={() =>
              run(async () => {
                const result = await loadBriefing(session.access_token);
                setMessage(`브리핑 연결 성공\n${JSON.stringify(result.counts || {}, null, 2)}`);
              })
            }
          />
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
  multiline: { minHeight: 110, textAlignVertical: 'top' },
  errorText: { color: '#b42318', lineHeight: 20 },
  message: {
    padding: 16,
    borderRadius: 12,
    backgroundColor: '#ffffff',
    color: '#30343b',
    lineHeight: 20,
  },
});
