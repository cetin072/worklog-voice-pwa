import { useEffect } from 'react';
import { ActivityIndicator, SafeAreaView, StyleSheet, Text } from 'react-native';
import { router } from 'expo-router';

import { usePlatform } from '@/src/providers/platform-provider';

export default function GoogleAuthCallbackScreen() {
  const { phase, session, authError, error } = usePlatform();

  useEffect(() => {
    if (session || authError || phase === 'error') router.replace('/');
  }, [session, authError, phase]);

  return (
    <SafeAreaView style={styles.page}>
      <ActivityIndicator size="large" />
      <Text style={styles.title}>계정 인증 완료 중</Text>
      <Text style={styles.body}>
        인증 결과를 확인한 뒤 업무수첩을 계속 시작합니다.
      </Text>
      {phase === 'error' && error ? <Text style={styles.error}>{error}</Text> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    padding: 24,
    backgroundColor: '#f4f5f7',
  },
  title: { fontSize: 22, fontWeight: '800', color: '#17191d' },
  body: { fontSize: 15, lineHeight: 22, color: '#4b515c', textAlign: 'center' },
  error: { fontSize: 14, lineHeight: 20, color: '#b3261e', textAlign: 'center' },
});
