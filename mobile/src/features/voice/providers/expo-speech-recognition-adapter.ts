import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

import type { QuickVoiceRecognitionPort } from '../speech-recognition-session';

/** Native composition adapter. UI and Data Core only receive the neutral port. */
export function createExpoSpeechRecognitionAdapter(): QuickVoiceRecognitionPort {
  return Object.freeze({
    isRecognitionAvailable: () => ExpoSpeechRecognitionModule.isRecognitionAvailable(),
    supportsOnDeviceRecognition: () => ExpoSpeechRecognitionModule.supportsOnDeviceRecognition(),
    async getSupportedLocales() {
      const result = await ExpoSpeechRecognitionModule.getSupportedLocales({});
      return Object.freeze({ locales: result.locales, installedLocales: result.installedLocales });
    },
    async requestPermissions() {
      const result = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      return Object.freeze({ granted: result.granted });
    },
    start(options) {
      ExpoSpeechRecognitionModule.start({
        lang: options.locale,
        interimResults: true,
        continuous: true,
        maxAlternatives: 1,
        requiresOnDeviceRecognition: options.requiresOnDeviceRecognition,
        addsPunctuation: options.requiresOnDeviceRecognition,
      });
    },
    stop: () => ExpoSpeechRecognitionModule.stop(),
    abort: () => ExpoSpeechRecognitionModule.abort(),
    subscribe(events) {
      const result = ExpoSpeechRecognitionModule.addListener('result', (event) => events.result({
        isFinal: event.isFinal,
        transcripts: event.results.map((item) => item.transcript),
      }));
      const error = ExpoSpeechRecognitionModule.addListener('error', (event) => events.error({ code: event.error, message: event.message }));
      const end = ExpoSpeechRecognitionModule.addListener('end', () => events.end());
      return () => { result.remove(); error.remove(); end.remove(); };
    },
  });
}
