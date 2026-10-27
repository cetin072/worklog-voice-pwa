import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import { createUpdateSession } from './app-update-policy';

export const updateSession = createUpdateSession(async () => {
  if (Platform.OS !== 'android') return false;
  const native = requireOptionalNativeModule<{ isUpdateAvailable(): Promise<boolean> }>('WorklogPlayUpdate');
  return native ? native.isUpdateAvailable() : false;
});
