import { createMobileRecordingAudioInput } from './audio-input';
import {
  createPreparedAudioCheckpoint,
  prepareRecordingForStt,
  type MobileAudioPreprocessor,
  type PreparedAudioCheckpoint,
} from './audio-preprocessor';
import type { MeetingRecordingEntry } from './meeting-recordings';
import {
  transcribeMobileAudio,
  type MobileTranscriptV1,
  type MobileTranscriptionProvider,
} from './transcription-provider';

export type MeetingTranscriptionTimings = Readonly<{
  preprocessMs: number;
  transcribeMs: number;
}>;

export type MeetingTranscriptionResult = Readonly<{
  transcript: MobileTranscriptV1;
  checkpoint: PreparedAudioCheckpoint;
  timings: MeetingTranscriptionTimings;
}>;

export class MeetingTranscriptionFlowError extends Error {
  readonly stage: 'preprocess' | 'transcribe';
  readonly causeError: unknown;

  constructor(stage: 'preprocess' | 'transcribe', message: string, causeError: unknown) {
    super(message);
    this.name = 'MeetingTranscriptionFlowError';
    this.stage = stage;
    this.causeError = causeError;
  }
}

function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Provider-neutral meeting transcription path.
 *
 * Original recording -> derived PCM/WAV -> Transcript V1.
 * It deliberately does not save a worklog, create schedules, summarize, upload,
 * or delete either the source recording or prepared checkpoint.
 */
export async function transcribeMeetingRecording(input: {
  recording: MeetingRecordingEntry;
  preprocessor: MobileAudioPreprocessor;
  provider: MobileTranscriptionProvider;
  language?: string;
}): Promise<MeetingTranscriptionResult> {
  const source = createMobileRecordingAudioInput({
    uri: input.recording.uri,
    durationMs: input.recording.durationMs,
    createdAt: input.recording.createdAt,
  });

  const preprocessStartedAt = Date.now();
  let prepared;
  try {
    prepared = await prepareRecordingForStt(input.preprocessor, source);
  } catch (error) {
    throw new MeetingTranscriptionFlowError(
      'preprocess',
      messageOf(error, '회의 녹음을 STT용 음성으로 준비하지 못했습니다.'),
      error,
    );
  }
  const preprocessMs = Math.max(0, Date.now() - preprocessStartedAt);
  const checkpoint = createPreparedAudioCheckpoint(source, prepared);

  const transcribeStartedAt = Date.now();
  let transcript;
  try {
    transcript = await transcribeMobileAudio(input.provider, prepared, input.language || 'ko');
  } catch (error) {
    throw new MeetingTranscriptionFlowError(
      'transcribe',
      messageOf(error, '회의 녹음 전사에 실패했습니다.'),
      error,
    );
  }
  const transcribeMs = Math.max(0, Date.now() - transcribeStartedAt);

  return Object.freeze({
    transcript,
    checkpoint,
    timings: Object.freeze({
      preprocessMs,
      transcribeMs,
    }),
  });
}
