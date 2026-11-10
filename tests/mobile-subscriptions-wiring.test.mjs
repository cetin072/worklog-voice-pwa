import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const home = fs.readFileSync('mobile/app/index.tsx', 'utf8');
const dir = 'mobile/src/features/subscriptions';
const files = fs.readdirSync(dir).filter((f) => /\.tsx?$/.test(f));

test('설정 메뉴 → 구독 화면으로 연결되고 뒤로가기는 설정으로 돌아간다', () => {
  assert.match(home, /'subscriptions'\s*;?/);
  assert.match(home, /<SettingsMenuItem title="구독·정기결제"[^\n]*setScreen\('subscriptions'\)/);
  assert.match(home, /screen === 'subscriptions' \? <View style=\{styles\.panel\}>/);
  assert.match(home, /if \(screen === 'subscriptions'\) \{ setScreen\('settings'\); return true; \}/);
});

test('구독 알림을 탭하면 구독 화면이 열리고, 로그아웃하면 이 기기의 구독 알림이 정리된다', () => {
  assert.match(home, /payload\?\.target === 'subscriptions'\) \{ setScreen\('subscriptions'\); return true; \}/);
  assert.match(home, /if \(!session\) \{[^}]*cancelAllSubscriptionReminders\(\)/);
});

test('구독 기능은 일정(Schedule) 알림 모듈과 섞이지 않는다 — 독립 Branch 경계', () => {
  assert.ok(files.length >= 6);
  for (const file of files) {
    const source = fs.readFileSync(`${dir}/${file}`, 'utf8');
    assert.doesNotMatch(source, /features\/schedule\//, `${file} must not import the schedule reminder service`);
    assert.doesNotMatch(source, /work_records|\.from\('schedules'\)/, `${file} must not touch WorkRecord/Schedule tables`);
  }
});

test('순수 로직 모듈은 네이티브/네트워크에 의존하지 않는다', () => {
  for (const file of ['subscription-model.ts', 'subscription-reminder-plan.ts', 'subscription-utterance.ts']) {
    const source = fs.readFileSync(`${dir}/${file}`, 'utf8');
    assert.doesNotMatch(source, /from 'react-native'|from 'expo-|@supabase|fetch\(/, file);
  }
});

test('홈 화면 레이아웃(버튼·카드)은 이번 변경에서 건드리지 않았다', () => {
  assert.doesNotMatch(home, /accessibilityLabel="구독/, '홈 직접 진입 버튼은 사용자 승인 후 별도 변경');
});

test('한 줄 입력은 곧바로 저장하지 않고 항상 확인 화면을 거친다', () => {
  const screen = fs.readFileSync(`${dir}/subscriptions-screen.tsx`, 'utf8');
  const start = screen.indexOf('function openFromQuickText');
  const open = screen.slice(start, screen.indexOf('\n  }\n', start));
  assert.match(open, /setEditing\(\{ kind: 'new', parse:/);
  assert.doesNotMatch(open, /createSubscription/);
  assert.match(screen, /sourceText: editing\.parse\?\.rawText \|\| null/);
});

test('구독 추가는 목록 하단 입력칸이 아니라 별도 추가 페이지(compose)에서 한다', () => {
  const screen = fs.readFileSync(`${dir}/subscriptions-screen.tsx`, 'utf8');
  const listStart = screen.indexOf('return <View style={styles.root}>\n    <View style={styles.summaryCard}');
  assert.ok(listStart > 0, 'list render block exists');
  const list = screen.slice(listStart, screen.indexOf('\nfunction Row'));
  assert.doesNotMatch(list, /TextInput/, '목록 화면에는 입력칸이 없다');
  assert.match(list, /accessibilityLabel="구독 추가"[^\n]*onPress=\{openCompose\}/);
  const compose = screen.slice(screen.indexOf("if (editing?.kind === 'compose')"), listStart);
  assert.match(compose, /autoFocus/);
  assert.match(compose, /직접 입력하기/);
  assert.match(compose, /onPress=\{openFromQuickText\}/);
});
