import { File, Paths } from 'expo-file-system';

import {
  transcribeMeetingRecording,
  type MeetingTranscriptionResult,
} from './meeting-transcription-flow';
import type { MeetingRecordingEntry } from './meeting-recordings';
import type { MobileAudioPreprocessor } from './audio-preprocessor';
import type { MobileTranscriptionProvider } from './transcription-provider';
import {
  loadMeetingTranscript,
  saveMeetingTranscript,
  type MeetingTranscriptCheckpointV1,
} from './meeting-transcript-checkpoint';

/**
 * Delete only our derived cache WAV after the raw transcript is durably saved.
 * Never delete an M4A, arbitrary file URI, or user-authored meeting minutes.
 */
function removeSavedMeetingWav(preparedUri: string, originalUri: string): void {
  const prefix = Paths.cache.uri.replace(/\/+$/, '') + '/';
  if (!preparedUri.startsWith(prefix) || preparedUri === originalUri ||
      !/^meeting-stt-[0-9a-f-]{36}\.wav$/i.test(preparedUri.slice(prefix.length))) return;
  try {
    const derived = new File(preparedUri);
    if (derived.exists) derived.delete();
  } catch {
    // Failed cache cleanup cannot invalidate successfully saved STT evidence.
  }
}

/**
 * Reuses existing provider-neutral STT. If a successful transcript is saved,
 * next requests avoid repeating an expensive 60-minute transcription.
 */
export async function ensureMeetingTranscript(input: {
  recording: MeetingRecordingEntry;
  preprocessor: MobileAudioPreprocessor;
  provider: MobileTranscriptionProvider;
}): Promise<Readonly<{
  checkpoint: MeetingTranscriptCheckpointV1;
  reused: boolean;
  timings?: MeetingTranscriptionResult['timings'];
}>> {
  const existing = loadMeetingTranscript(input.recording);
  if (existing) return Object.freeze({ checkpoint: existing, reused: true });

  const converted = await transcribeMeetingRecording(input);
  const saved = saveMeetingTranscript(input.recording, converted.transcript);
  removeSavedMeetingWav(converted.checkpoint.preparedUri, input.recording.uri);
  return Object.freeze({ checkpoint: saved, reused: false, timings: converted.timings });
}
