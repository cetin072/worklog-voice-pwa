import { useEffect, useState } from 'react';
import { AppState, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { mobileTheme } from '@/src/ui/theme';
import { openUpdateStore } from './app-update-policy';
import { updateSession } from './play-update-adapter';

export function AppUpdatePrompt() {
  const [available, setAvailable] = useState(false);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true;
    const check = () => { void updateSession.check().then(value => {
      if (alive) setAvailable(value && !updateSession.isDismissed());
    }); };
    if (AppState.currentState === 'active') check();
    const subscription = AppState.addEventListener('change', state => {
      setForeground(state === 'active');
      if (state === 'active') check();
    });
    return () => { alive = false; subscription.remove(); };
  }, []);
  function dismiss() { updateSession.dismiss(); setAvailable(false); }
  async function openStore() {
    if (opening) return;
    setOpening(true); setError('');
    try { await openUpdateStore(Linking.openURL); dismiss(); }
    catch { setError('Play 스토어를 열지 못했습니다. 연결을 확인하고 다시 시도하거나 나중에 업데이트해주세요.'); }
    finally { setOpening(false); }
  }
  return <Modal transparent animationType="fade" visible={available && foreground} onRequestClose={dismiss}>
    <View style={styles.backdrop}><View accessibilityViewIsModal style={styles.card}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.title}>새로운 업데이트가 있습니다</Text>
        <Text style={styles.message}>업무수첩의 새 버전을 Play 스토어에서 업데이트할 수 있습니다.</Text>
        {error ? <Text accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.message}>{error}</Text> : null}
        <Pressable accessibilityRole="button" onPress={dismiss} style={styles.later}><Text style={styles.message}>나중에</Text></Pressable>
        <Pressable accessibilityRole="button" accessibilityState={{ disabled: opening, busy: opening }} disabled={opening} onPress={() => void openStore()} style={styles.primary}>
          <Text style={styles.primaryText}>{opening ? 'Play 스토어 여는 중…' : '업데이트하기'}</Text>
        </Pressable>
      </ScrollView>
    </View></View>
  </Modal>;
}
const styles = StyleSheet.create({
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: 'rgba(17,24,39,0.5)' },
  card: { width: '100%', maxWidth: 480, maxHeight: '90%', borderRadius: mobileTheme.radius.card, backgroundColor: mobileTheme.colors.surface, overflow: 'hidden' },
  content: { padding: 24, gap: 16 },
  title: { fontSize: 24, fontWeight: '700', color: mobileTheme.colors.text },
  message: { fontSize: 16, lineHeight: 24, color: mobileTheme.colors.textSecondary },
  later: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  primary: { minHeight: 56, padding: 12, borderRadius: mobileTheme.radius.control, backgroundColor: mobileTheme.colors.primary, alignItems: 'center', justifyContent: 'center' },
  primaryText: { fontSize: 17, fontWeight: '700', color: mobileTheme.colors.primaryText },
});
