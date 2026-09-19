import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { mobileTheme } from './theme';

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('AppErrorBoundary', error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return <View style={styles.root}>
      <Text style={styles.eyebrow}>APP ERROR</Text>
      <Text style={styles.title}>업무수첩 화면을 열지 못했습니다.</Text>
      <Text style={styles.body}>앱을 완전히 닫았다가 다시 열어주세요. 계속되면 아래 오류 문구를 캡처해 주세요.</Text>
      <View style={styles.errorBox}>
        <Text selectable style={styles.errorText}>{error.name}: {error.message || '알 수 없는 오류'}</Text>
      </View>
      <Pressable accessibilityRole="button" style={styles.button} onPress={this.retry}>
        <Text style={styles.buttonText}>화면 다시 시도</Text>
      </Pressable>
    </View>;
  }
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    justifyContent: 'center',
    gap: 14,
    padding: 24,
    backgroundColor: mobileTheme.colors.background,
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: mobileTheme.colors.danger,
  },
  title: {
    fontSize: 22,
    lineHeight: 30,
    fontWeight: '900',
    color: mobileTheme.colors.text,
  },
  body: {
    fontSize: 14,
    lineHeight: 21,
    color: mobileTheme.colors.textSecondary,
  },
  errorBox: {
    padding: 14,
    borderRadius: mobileTheme.radius.control,
    borderWidth: 1,
    borderColor: mobileTheme.colors.border,
    backgroundColor: mobileTheme.colors.surface,
  },
  errorText: {
    fontSize: 12,
    lineHeight: 18,
    color: mobileTheme.colors.danger,
  },
  button: {
    minHeight: 46,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: mobileTheme.radius.control,
    backgroundColor: mobileTheme.colors.primary,
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '800',
    color: mobileTheme.colors.primaryText,
  },
});
