import * as Crypto from 'expo-crypto';
import { Directory, File, Paths } from 'expo-file-system';

import {
  type ResolvedSttModel,
  type SttModelDescriptor,
  type SttModelResolver,
  validateResolvedSttModel,
} from './stt-model';

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

function hex(buffer: ArrayBuffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(file: File) {
  const digest = await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, await file.arrayBuffer());
  return hex(digest);
}

function matchingDescriptor(expected: SttModelDescriptor, actual: SttModelDescriptor) {
  return expected.id === actual.id
    && expected.provider === actual.provider
    && expected.version === actual.version
    && expected.sha256 === actual.sha256;
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
      const expectedBytes = descriptor.downloadBytes;

      if (finalFile.exists) {
        const actualHash = await sha256(finalFile);
        if (actualHash === descriptor.sha256) {
          return validateResolvedSttModel(descriptor, { descriptor, localPath: finalFile.uri });
        }
        finalFile.delete();
      }

      if (expectedBytes !== null && Paths.availableDiskSpace < expectedBytes) {
        throw new Error('음성 모델을 받을 저장 공간이 부족합니다.');
      }

      if (partialFile.exists) partialFile.delete();
      try {
        const downloaded = await File.downloadFileAsync(registered.downloadUrl, partialFile, {
          onProgress: ({ bytesWritten, totalBytes }) => input.onProgress?.({
            modelId: descriptor.id,
            bytesWritten,
            totalBytes: totalBytes > 0 ? totalBytes : expectedBytes,
          }),
        });
        if (expectedBytes !== null && downloaded.size !== expectedBytes) {
          throw new Error('받은 음성 모델 크기가 예상값과 다릅니다.');
        }
        const actualHash = await sha256(downloaded);
        if (actualHash !== descriptor.sha256) {
          throw new Error('받은 음성 모델의 SHA-256 검증에 실패했습니다.');
        }
        await downloaded.move(finalFile);
        return validateResolvedSttModel(descriptor, { descriptor, localPath: finalFile.uri });
      } catch (error) {
        if (partialFile.exists) partialFile.delete();
        if (finalFile.exists) finalFile.delete();
        throw error;
      }
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
