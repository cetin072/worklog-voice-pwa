import type { MeetingRecordingEntry } from './meeting-recordings';
import {
  loadMeetingTranscript,
  type MeetingTranscriptCheckpointV1,
} from './meeting-transcript-checkpoint';
import { createAndroidMeetingAudioPreprocessor } from './providers/android-meeting-audio-preprocessor';
import { prepareRecordedMeetingTranscript } from './providers/meeting-transcription-runtime';

/**
 * Meeting screen uses this narrow UI-facing facade, not a Whisper/MediaCodec
 * provider. The experimental control is QA-only until a real Samsung device
 * validates 5/30/60 minute recordings and the user's original data survives.
 */
export const MEETING_TRANSCRIPTION_QA_ONLY =
  process.env.EXPO_PUBLIC_WORKLOG_APP_VARIANT === 'qa';

export type MeetingTranscriptionUiResult = Readonly<{
  checkpoint: MeetingTranscriptCheckpointV1;
  reused: boolean;
}>;

export function canStartMeetingTranscription(): boolean {
  return MEETING_TRANSCRIPTION_QA_ONLY &&
    createAndroidMeetingAudioPreprocessor().configured;
}

export function readSavedMeetingTranscript(
  recording: MeetingRecordingEntry,
): MeetingTranscriptCheckpointV1 | null {
  return loadMeetingTranscript(recording);
}

/**
 * Intentionally cannot be called from production. Read an existing checkpoint
 * first, so a missing native decoder or a model download never blocks viewing
 * an already saved raw transcript.
 */
export async function transcribeMeetingForQa(input: {
  recording: MeetingRecordingEntry;
  onModelDownload?: (writtenBytes: number, totalBytes: number | null) => void;
}): Promise<MeetingTranscriptionUiResult> {
  if (!MEETING_TRANSCRIPTION_QA_ONLY) {
    throw new Error('회의 자동 전사는 아직 정식 앱에서 사용할 수 없습니다.');
  }
  const existing = loadMeetingTranscript(input.recording);
  if (existing) return Object.freeze({ checkpoint: existing, reused: true });
  if (!canStartMeetingTranscription()) {
    throw new Error('이 QA 앱에는 회의 전사용 Android 모듈이 없습니다. 다음 QA 빌드에서 확인할 수 있습니다.');
  }
  return prepareRecordedMeetingTranscript(input.recording, input.onModelDownload);
}
