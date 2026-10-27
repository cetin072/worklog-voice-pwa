import { useEffect, useState } from 'react';
import { ActivityIndicator, Button, StyleSheet, Text, View } from 'react-native';
export function StartupScreen({ error = '', stage = 'briefing', onRetry, onSignOut }: { error?: string; stage?: 'account' | 'briefing'; onRetry?(): void; onSignOut?(): void }) {
  const [slow, setSlow] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { setSlow(false); const timer = setTimeout(() => setSlow(true), 20000); return () => clearTimeout(timer); }, [attempt, error]);
  const displayedError = error || (slow ? '연결이 지연되고 있어요. 네트워크를 확인하고 다시 시도해주세요.' : '');
  return <View style={styles.page}><View style={styles.card}>
    <View style={styles.mark}><Text style={styles.markText}>🎙</Text></View>
    <Text style={styles.brand}>업무수첩</Text>
    <Text style={styles.eyebrow}>나의 개인 업무공간</Text>
    <Text style={styles.title}>말하면 기록되고,{`\n`}일정까지 한눈에</Text>
    <Text style={styles.tagline}>기록 · 업무 · 일정</Text>
    {displayedError ? <><Text accessibilityLiveRegion="polite" style={styles.copy}>{displayedError}</Text><Button title="다시 시도" onPress={() => { setSlow(false); setAttempt(value => value + 1); onRetry?.(); }} />{onSignOut ? <Button title="로그아웃" onPress={onSignOut} /> : null}</> : <View style={styles.progress}><ActivityIndicator color="#93c5fd" /><Text accessibilityLiveRegion="polite" style={styles.copy}>{stage === 'account' ? '내 업무공간에 연결하고 있어요' : '오늘의 업무와 일정을 준비하고 있어요'}</Text></View>}
  </View><Text style={styles.footer}>당신의 하루를 놓치지 않도록.</Text></View>;
}
const styles = StyleSheet.create({page:{flex:1,backgroundColor:'#101d35',justifyContent:'center',padding:28},card:{gap:18,alignItems:'flex-start'},mark:{width:76,height:76,borderRadius:24,backgroundColor:'#263957',borderWidth:1,borderColor:'#475c7c',alignItems:'center',justifyContent:'center'},markText:{fontSize:40},brand:{color:'#ffffff',fontSize:38,fontWeight:'800'},eyebrow:{color:'#93c5fd',fontSize:15,fontWeight:'700'},title:{color:'#ffffff',fontSize:28,lineHeight:40,fontWeight:'700'},tagline:{color:'#cbd5e1',fontSize:16},progress:{flexDirection:'row',alignItems:'center',gap:12,marginTop:20,flexWrap:'wrap'},copy:{color:'#e0e8f5',fontSize:15,lineHeight:24,flexShrink:1},footer:{color:'#94a3b8',fontSize:14,marginTop:48}});
