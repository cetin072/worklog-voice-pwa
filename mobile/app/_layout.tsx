import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlatformProvider } from '@/src/providers/platform-provider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PlatformProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </PlatformProvider>
    </SafeAreaProvider>
  );
}
