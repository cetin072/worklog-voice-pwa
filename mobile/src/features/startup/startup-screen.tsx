import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
export function StartupScreen({ error = '', onRetry, onSignOut }: { error?: string; onRetry?(): void; onSignOut?(): void }) {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setSlow(false); const timer = setTimeout(() => setSlow(true), 20000); return () => clearTimeout(timer); }, [attempt, error]);
  const displayedError = error || (slow ? '연결이 지연되고 있어요. 네트워크를 확인하고 다시 시도해주세요.' : '');
  return <View style={styles.page}><View style={styles.card}>
    <Text style={styles.brand}>🎙 업무수첩</Text>
    <Text style={styles.title}>말하면 기록되고,{`\n`}일정까지 한눈에</Text>
    {displayedError ? <><Text accessibilityLiveRegion="polite" style={styles.copy}>{displayedError}</Text><Button title="다시 시도" onPress={() => { setSlow(false); setAttempt(value => value + 1); onRetry?.(); }} />{onSignOut ? <Button title="로그아웃" onPress={onSignOut} /> : null}</> : <><ActivityIndicator color="#ffffff" size="large" /><Text accessibilityLiveRegion="polite" style={styles.copy}>오늘의 일정을 준비하고 있어요</Text></>}
  </View></View>;
}
const styles = StyleSheet.create({page:{flex:1,backgroundColor:'#f6f7f9',justifyContent:'center',padding:24},card:{backgroundColor:'#172b4d',borderRadius:24,padding:28,gap:24},brand:{color:'#ffffff',fontSize:22,fontWeight:'800'},title:{color:'#ffffff',fontSize:25,lineHeight:35,fontWeight:'700'},copy:{color:'#e0e8f5',fontSize:16,lineHeight:24}});
