import { useEffect, useRef, useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { usePlatform } from '@/src/providers/platform-provider';
import { importCaptureFromGallery } from './capture-gallery';

export function CaptureImportButton({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { session } = usePlatform(); const router = useRouter();
  const owner = session?.user.id || null;
  const account = useRef(owner); account.current = owner;
  const mounted = useRef(false), pending = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  async function choose() {
    if (!owner || pending.current || disabled) return;
    pending.current = true;setBusy(true);setError('');
    const current = () => mounted.current && account.current === owner;
    try { await importCaptureFromGallery(owner, current, hash => router.push({ pathname: '/capture', params: { hash } })); }
    catch { if (current()) { const message = '이미지를 가져오지 못했습니다. 다시 선택하거나 갤러리에서 공유해주세요.'; if (compact) Alert.alert('사진 가져오기', message); else setError(message); } }
    finally { pending.current = false;if (mounted.current) setBusy(false); }
  }
  if (Platform.OS !== 'android') return null;
  if (compact) return <Pressable accessibilityRole="button" accessibilityLabel="캡처 가져오기" accessibilityHint="사진: 갤러리에서 캡처 한 장 선택" disabled={busy || !owner || disabled} onPress={() => void choose()} style={[styles.quickButton, busy || disabled ? styles.disabled : null]}><Text style={styles.quickIcon}>🖼️</Text><Text style={styles.quickLabel}>{busy ? '가져오는 중' : '사진'}</Text></Pressable>;
  return <View style={styles.group}><Pressable accessibilityRole="button" accessibilityLabel="캡처 가져오기" accessibilityHint="갤러리에서 이미지 한 장을 선택하면 자동으로 기록합니다" disabled={busy || !owner} onPress={() => void choose()} style={styles.button}>
    <Text style={styles.title}>{busy ? '이미지 가져오는 중…' : '캡처 가져오기'}</Text><Text style={styles.help}>갤러리에서 한 장 선택 · 자동 기록</Text>
  </Pressable>{error ? <Text accessibilityLiveRegion="polite" style={styles.error}>{error}</Text> : null}</View>;
}
const styles = StyleSheet.create({ group: { gap: 8 }, button: { minHeight: 64, padding: 16, borderRadius: 16, backgroundColor: '#dcebf3', gap: 4 }, title: { fontSize: 18, fontWeight: '700', color: '#103244' }, help: { fontSize: 14, color: '#334155' }, error: { color: '#b91c1c', fontSize: 15 }, quickButton: { width: '100%', height: '100%', minHeight: 44, alignItems: 'center', justifyContent: 'center', gap: 1 }, quickIcon: { fontSize: 18 }, quickLabel: { fontSize: 10, fontWeight: '800', color: '#374151' }, disabled: { opacity: 0.4 } });
