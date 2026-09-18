import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { PlatformProvider } from '@/src/providers/platform-provider';
import { MeetingRecordingProvider } from '@/src/features/voice/meeting-recording-provider';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <PlatformProvider>
        <MeetingRecordingProvider>
          <Stack screenOptions={{ headerShown: false }} />
        </MeetingRecordingProvider>
      </PlatformProvider>
    </SafeAreaProvider>
  );
}
