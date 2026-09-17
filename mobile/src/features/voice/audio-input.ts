export type MobileRecordingAudioInput = {
  sourceKind: 'mobile-recording';
  uri: string;
  fileName: string;
  mimeType: string;
  durationMs: number;
  createdAt: string;
};

function fileNameFromUri(uri: string) {
  const cleanUri = uri.split(/[?#]/, 1)[0];
  const lastSegment = cleanUri.split('/').filter(Boolean).at(-1) || 'recording.m4a';

  try {
    return decodeURIComponent(lastSegment);
  } catch {
    return lastSegment;
  }
}

function mimeTypeFromFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.wav')) return 'audio/wav';
  if (lower.endsWith('.webm')) return 'audio/webm';
  if (lower.endsWith('.mp3')) return 'audio/mpeg';
  return 'audio/mp4';
}

export function createMobileRecordingAudioInput(input: {
  uri: string;
  durationMs: number;
  createdAt?: string;
}): MobileRecordingAudioInput {
  const uri = input.uri.trim();
  if (!uri) {
    throw new Error('녹음 파일 경로가 없습니다.');
  }

  const durationMs = Math.max(0, Math.round(input.durationMs));
  const fileName = fileNameFromUri(uri);

  return {
    sourceKind: 'mobile-recording',
    uri,
    fileName,
    mimeType: mimeTypeFromFileName(fileName),
    durationMs,
    createdAt: input.createdAt || new Date().toISOString(),
  };
}
