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
  return Object.freeze({ checkpoint: saved, reused: false, timings: converted.timings });
}
