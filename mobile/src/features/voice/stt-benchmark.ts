import type { MobileSttAudioInput } from './audio-input';
import { transcribeQuickVoice, type MobileTranscriptionProvider } from './transcription-provider';

export type SttBenchmarkEntity = Readonly<{
  label: string;
  expected: string;
}>;

export type SttBenchmarkCandidate = Readonly<{
  id: string;
  provider: MobileTranscriptionProvider;
}>;

export type SttBenchmarkResult = Readonly<{
  candidateId: string;
  provider: string;
  configured: boolean;
  ok: boolean;
  text: string;
  model: string;
  durationMs: number;
  transcribeMs: number;
  entityMatches: readonly Readonly<{
    label: string;
    expected: string;
    matched: boolean;
  }>[];
  error: string;
}>;

function normalizeComparableText(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\s,._-]+/g, '')
    .toLowerCase();
}

function entityMatches(text: string, entities: readonly SttBenchmarkEntity[]) {
  const haystack = normalizeComparableText(text);
  return Object.freeze(entities.map((entity) => Object.freeze({
    label: entity.label,
    expected: entity.expected,
    matched: Boolean(entity.expected.trim()) && haystack.includes(normalizeComparableText(entity.expected)),
  })));
}

/**
 * Provider-neutral STT bakeoff.
 *
 * This intentionally does NOT save a worklog or create a schedule. The exact
 * same trusted audio is passed to each configured provider, so provider/model
 * quality can be compared without contaminating user data.
 */
export async function runSttProviderBenchmark(input: {
  candidates: readonly SttBenchmarkCandidate[];
  audio: MobileSttAudioInput;
  language?: string;
  entities?: readonly SttBenchmarkEntity[];
}): Promise<readonly SttBenchmarkResult[]> {
  const language = input.language?.trim() || 'ko';
  const entities = input.entities || [];
  const results: SttBenchmarkResult[] = [];

  for (const candidate of input.candidates) {
    const startedAt = Date.now();
    try {
      const transcript = await transcribeQuickVoice(candidate.provider, input.audio, language);
      results.push(Object.freeze({
        candidateId: candidate.id,
        provider: transcript.provider,
        configured: candidate.provider.configured,
        ok: true,
        text: transcript.text,
        model: transcript.model,
        durationMs: transcript.durationMs,
        transcribeMs: Math.max(0, Date.now() - startedAt),
        entityMatches: entityMatches(transcript.text, entities),
        error: '',
      }));
    } catch (error) {
      results.push(Object.freeze({
        candidateId: candidate.id,
        provider: candidate.provider.provider,
        configured: candidate.provider.configured,
        ok: false,
        text: '',
        model: '',
        durationMs: Math.max(0, Math.round(input.audio.durationMs)),
        transcribeMs: Math.max(0, Date.now() - startedAt),
        entityMatches: entityMatches('', entities),
        error: error instanceof Error ? error.message : 'STT benchmark failed',
      }));
    }
  }

  return Object.freeze(results);
}
