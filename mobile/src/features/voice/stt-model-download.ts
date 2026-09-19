import { Directory, File, Paths } from 'expo-file-system';
import { fetch } from 'expo/fetch';

import {
  type ResolvedSttModel,
  type SttModelDescriptor,
  type SttModelResolver,
  validateResolvedSttModel,
} from './stt-model';
import { IncrementalSha256 } from './incremental-sha256';

const DOWNLOAD_ATTEMPTS = 3;
const DOWNLOAD_RETRY_DELAY_MS = [0, 900, 2200] as const;

function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

export type DownloadableSttModel = Readonly<{
  descriptor: SttModelDescriptor;
  downloadUrl: string;
  fileName: string;
}>;

export type SttModelDownloadProgress = Readonly<{
  modelId: string;
  bytesWritten: number;
  totalBytes: number | null;
}>;

function safeFileName(value: string) {
  const normalized = value.trim();
  if (!/^[a-z0-9][a-z0-9._-]{0,180}$/i.test(normalized)) {
    throw new Error('STT model 파일 이름 형식이 올바르지 않습니다.');
  }
  return normalized;
}

function safeDownloadUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== 'https:') {
    throw new Error('STT model 다운로드는 HTTPS URL이어야 합니다.');
  }
  return url.toString();
}

export function defineDownloadableSttModel(input: {
  descriptor: SttModelDescriptor;
  downloadUrl: string;
  fileName: string;
}): DownloadableSttModel {
  return Object.freeze({
    descriptor: input.descriptor,
    downloadUrl: safeDownloadUrl(input.downloadUrl),
    fileName: safeFileName(input.fileName),
  });
}

async function sha256(file: File) {
  const hasher = new IncrementalSha256();
  const reader = file.readableStream().getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value?.byteLength) hasher.update(value);
    }
  } finally {
    reader.releaseLock();
  }
  return hasher.digestHex();
}

function matchingDescriptor(expected: SttModelDescriptor, actual: SttModelDescriptor) {
  return expected.id === actual.id
    && expected.provider === actual.provider
    && expected.version === actual.version
    && expected.sha256 === actual.sha256
    && expected.downloadBytes === actual.downloadBytes;
}

class ModelDownloadIntegrityError extends Error {}
class ModelDownloadHttpError extends Error {
  constructor(readonly status: number) {
    super(`음성 모델 서버가 HTTP ${status}를 반환했습니다.`);
  }
}

type DownloadMetadata = { v: 1; url: string; sha256: string; etag: string | null };
function strongEtag(value: string | null) {
  return value && /^"[^"\r\n]*"$/.test(value) ? value : null;
}
function headerBytes(response: Response, name: string) {
  const raw = response.headers.get(name);
  if (raw === null) return null;
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) throw new ModelDownloadIntegrityError('모델 서버의 길이 정보가 잘못됐습니다.');
  return Number(raw);
}
/** Validate exact byte positions BEFORE appending, not just the /total suffix. */
export function validateModelDownloadResponse(response: Response, resumeFrom: number, expectedBytes: number | null) {
  if (![200, 206].includes(response.status)) throw new ModelDownloadHttpError(response.status);
  if (/multipart\/byteranges/i.test(response.headers.get('content-type') || '')) {
    throw new ModelDownloadIntegrityError('여러 구간의 모델 응답은 지원하지 않습니다.');
  }
  const encoding = response.headers.get('content-encoding');
  if (encoding && encoding !== 'identity') throw new ModelDownloadIntegrityError('압축된 모델 응답은 이어받기할 수 없습니다.');
  const length = headerBytes(response, 'content-length');
  let total = length; let bodyBytes = length;
  if (response.status === 206) {
    const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
    if (!match) throw new ModelDownloadIntegrityError('모델 이어받기 구간을 확인하지 못했습니다.');
    const [first, last, complete] = match.slice(1).map(Number);
    if (![first, last, complete].every(Number.isSafeInteger) || first !== resumeFrom || last < first || complete <= last) {
      throw new ModelDownloadIntegrityError('모델 이어받기 위치가 기존 파일과 맞지 않습니다.');
    }
    bodyBytes = last - first + 1; total = complete;
    if (length !== null && length !== bodyBytes) throw new ModelDownloadIntegrityError('모델 응답 구간과 길이가 다릅니다.');
  }
  if (expectedBytes !== null && total !== null && total !== expectedBytes) {
    throw new ModelDownloadIntegrityError('모델 서버 파일의 전체 크기가 예상값과 다릅니다.');
  }
  return { restart: resumeFrom > 0 && response.status === 200, bodyBytes, totalBytes: total ?? expectedBytes };
}

async function downloadPartialWithRange(input: {
  url: string; partialFile: File; metadataFile: File; expectedBytes: number | null; sha256: string;
  onProgress?: (bytesWritten: number, totalBytes: number | null) => void;
}) {
  let resumeFrom = input.partialFile.exists ? input.partialFile.size : 0;
  let previous: DownloadMetadata | null = null;
  if (input.metadataFile.exists) {
    try {
      if (input.metadataFile.size > 4096) throw new Error('too large');
      const parsed = JSON.parse(await input.metadataFile.text());
      if (parsed.v !== 1 || parsed.url !== input.url || parsed.sha256 !== input.sha256) throw new Error('identity');
      previous = { ...parsed, etag: strongEtag(parsed.etag) };
    } catch {
      if (resumeFrom > 0) throw new ModelDownloadIntegrityError('중간 모델 파일의 출처를 확인하지 못했습니다. 모델 캐시 점검이 필요합니다.');
    }
  }
  const response = await fetch(input.url, {
    headers: { 'Accept-Encoding': 'identity', ...(resumeFrom > 0 ? { Range: `bytes=${resumeFrom}-`, ...(previous?.etag ? { 'If-Range': previous.etag } : {}) } : {}) },
  });
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  let finished = false;
  try {
    const plan = validateModelDownloadResponse(response, resumeFrom, input.expectedBytes);
    const etag = strongEtag(response.headers.get('etag'));
    if (resumeFrom > 0 && previous?.etag && etag && previous.etag !== etag) {
      throw new ModelDownloadIntegrityError('서버의 음성 모델이 변경돼 이어받기를 중단했습니다. 중간 파일은 보존했습니다.');
    }
    // A 200 response to Range must never be appended. If the server cannot
    // resume, stop instead of repeatedly spending another complete download.
    if (plan.restart) throw new ModelDownloadIntegrityError('서버가 이어받기를 지원하지 않습니다. 중간 파일을 보존했고 자동 전체 재다운로드는 중단했습니다.');
    if (!response.body) throw new Error('음성 모델 다운로드 응답 본문이 없습니다.');
    input.metadataFile.write(JSON.stringify({ v: 1, url: input.url, sha256: input.sha256, etag: etag ?? previous?.etag ?? null }));
    let bytesWritten = resumeFrom;
    input.onProgress?.(bytesWritten, plan.totalBytes);
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      if ((plan.bodyBytes !== null && bytesWritten + value.byteLength - resumeFrom > plan.bodyBytes)
        || (plan.totalBytes !== null && bytesWritten + value.byteLength > plan.totalBytes)) {
        throw new ModelDownloadIntegrityError('받은 음성 모델이 허용된 크기를 초과했습니다.');
      }
      input.partialFile.write(value, { append: bytesWritten > 0 });
      bytesWritten += value.byteLength;
      input.onProgress?.(bytesWritten, plan.totalBytes);
    }
    if ((plan.bodyBytes !== null && bytesWritten - resumeFrom !== plan.bodyBytes)
      || (plan.totalBytes !== null && bytesWritten < plan.totalBytes)) {
      throw new Error('모델 전송이 중간에 끝났습니다. 남은 구간을 이어받습니다.');
    }
    finished = true;
    return input.partialFile;
  } finally {
    // Cancel unread bodies on integrity/HTTP failure; releasing a lock alone
    // does not stop native network traffic.
    if (!finished) {
      try { if (reader) await reader.cancel(); else await response.body?.cancel(); } catch { /* original error wins */ }
    }
    reader?.releaseLock();
  }
}

function isRetryableDownloadError(error: unknown) {
  if (error instanceof ModelDownloadIntegrityError) return false;
  if (error instanceof ModelDownloadHttpError) return error.status >= 500 || error.status === 408 || error.status === 429;
  return true;
}

/**
 * Generic Expo-backed model cache. The download is written to a temporary
 * filename and only promoted after the expected SHA-256 has been verified.
 * This keeps partially downloaded or tampered model files out of STT runtime.
 */
export function createExpoSttModelResolver(input: {
  models: readonly DownloadableSttModel[];
  onProgress?: (progress: SttModelDownloadProgress) => void;
}): SttModelResolver {
  const models = new Map<string, DownloadableSttModel>();
  const inFlight = new Map<string, Promise<ResolvedSttModel>>();

  for (const model of input.models) {
    if (models.has(model.descriptor.id)) throw new Error(`STT model이 중복 등록됐습니다: ${model.descriptor.id}`);
    models.set(model.descriptor.id, model);
  }

  async function ensureAvailable(descriptor: SttModelDescriptor): Promise<ResolvedSttModel> {
    const registered = models.get(descriptor.id);
    if (!registered || !matchingDescriptor(descriptor, registered.descriptor)) {
      throw new Error('다운로드가 등록된 STT model descriptor가 필요합니다.');
    }

    const existing = inFlight.get(descriptor.id);
    if (existing) return existing;

    const task = (async () => {
      const directory = new Directory(Paths.document, 'worklog-stt-models');
      if (!directory.exists) directory.create({ idempotent: true, intermediates: true });

      const finalFile = new File(directory, registered.fileName);
      const partialFile = new File(directory, `${registered.fileName}.partial`);
      const metadataFile = new File(directory, `${registered.fileName}.resume.json`);
      const expectedBytes = descriptor.downloadBytes;

      if (finalFile.exists) {
        const actualHash = await sha256(finalFile);
        if (actualHash === descriptor.sha256) {
          return validateResolvedSttModel(descriptor, { descriptor, localPath: finalFile.uri });
        }
        finalFile.delete();
      }

      // A completed partial can be promoted without another network request.
      if (partialFile.exists && expectedBytes !== null && partialFile.size === expectedBytes) {
        const partialHash = await sha256(partialFile);
        if (partialHash === descriptor.sha256) {
          await partialFile.move(finalFile);
          return validateResolvedSttModel(descriptor, { descriptor, localPath: finalFile.uri });
        }
        throw new ModelDownloadIntegrityError('받은 음성 모델의 SHA-256 검증에 실패했습니다.');
      }

      const remainingBytes = expectedBytes === null ? null : expectedBytes - (partialFile.exists ? partialFile.size : 0);
      if (remainingBytes !== null && remainingBytes < 0) throw new ModelDownloadIntegrityError('중간 모델 파일이 예상 크기를 초과했습니다.');
      if (remainingBytes !== null && Paths.availableDiskSpace < remainingBytes) throw new Error('음성 모델을 받을 저장 공간이 부족합니다.');
      // Validate the returned path before promotion; failures after move must not re-download.
      const resolved = validateResolvedSttModel(descriptor, { descriptor, localPath: finalFile.uri });
      let verifiedDownload: File | null = null;
      let lastDownloadError: unknown = null;
      for (let attempt = 0; attempt < DOWNLOAD_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await delay(DOWNLOAD_RETRY_DELAY_MS[attempt] || 2000);

        try {
          const downloaded = await downloadPartialWithRange({
            url: registered.downloadUrl,
            partialFile, metadataFile,
            expectedBytes, sha256: descriptor.sha256,
            onProgress: (bytesWritten, totalBytes) => input.onProgress?.({
              modelId: descriptor.id,
              bytesWritten,
              totalBytes: totalBytes && totalBytes > 0 ? totalBytes : expectedBytes,
            }),
          });
          if (expectedBytes !== null && downloaded.size !== expectedBytes) {
            throw new ModelDownloadIntegrityError('받은 음성 모델 크기가 예상값과 다릅니다.');
          }
          const actualHash = await sha256(downloaded);
          if (actualHash !== descriptor.sha256) {
            throw new ModelDownloadIntegrityError('받은 음성 모델의 SHA-256 검증에 실패했습니다.');
          }
          verifiedDownload = downloaded;
          break;
        } catch (error) {
          lastDownloadError = error;
          if (!isRetryableDownloadError(error)) break;
        }
      }

      if (verifiedDownload) {
        await verifiedDownload.move(finalFile); // promotion errors are never download retries
        return resolved;
      }

      const detail = lastDownloadError instanceof Error ? lastDownloadError.message : '';
      if (lastDownloadError instanceof ModelDownloadIntegrityError) throw lastDownloadError;
      if (lastDownloadError instanceof ModelDownloadHttpError) throw lastDownloadError;
      if (/SocketException|connection abort|connection reset|network|timeout|abort|fetch/i.test(detail)) {
        throw new Error('음성 모델 다운로드가 중간에 끊겼습니다. 인터넷 연결을 확인한 뒤 음성 기록을 다시 눌러주세요.');
      }
      throw lastDownloadError instanceof Error ? lastDownloadError : new Error('음성 모델을 받지 못했습니다. 잠시 후 다시 시도해주세요.');
    })();

    inFlight.set(descriptor.id, task);
    try {
      return await task;
    } finally {
      inFlight.delete(descriptor.id);
    }
  }

  return Object.freeze({ ensureAvailable });
}
