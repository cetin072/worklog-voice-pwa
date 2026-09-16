import { Stack } from 'expo-router';

import { PlatformProvider } from '@/src/providers/platform-provider';

export default function RootLayout() {
  return (
    <PlatformProvider>
      <Stack screenOptions={{ headerShown: false }} />
    </PlatformProvider>
  );
}
