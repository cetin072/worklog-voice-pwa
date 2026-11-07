import type { MeetingRecordingEntry } from '../meeting-recordings';
import { ensureMeetingTranscript } from '../meeting-transcription-checkpoint-flow';
import { createAndroidMeetingAudioPreprocessor } from './android-meeting-audio-preprocessor';
import { prepareQuickVoiceWhisperProvider } from './whisper-rn-quick-voice-runtime';

/**
 * Composition entrypoint for a future QA-validated transcription action.
 * Shares the existing multilingual Whisper provider and downloaded model.
 * No audio upload, AI summary or calendar/worklog mutation here.
 */
export async function prepareRecordedMeetingTranscript(recording: MeetingRecordingEntry) {
  const preprocessor = createAndroidMeetingAudioPreprocessor();
  if (!preprocessor.configured) {
    throw new Error('현재 설치된 앱에 Android 회의 전사 엔진이 없습니다. 다음 QA 업데이트가 필요합니다.');
  }
  const provider = await prepareQuickVoiceWhisperProvider();
  return ensureMeetingTranscript({ recording, preprocessor, provider });
}
