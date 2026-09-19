export type SttModelDescriptor = Readonly<{
  id: string;
  provider: string;
  version: string;
  language: string;
  format: string;
  sha256: string;
  downloadBytes: number | null;
}>;

export type ResolvedSttModel = Readonly<{
  descriptor: SttModelDescriptor;
  localPath: string;
}>;

export type SttModelResolver = Readonly<{
  ensureAvailable(descriptor: SttModelDescriptor): Promise<ResolvedSttModel>;
}>;

function cleanToken(value: string, label: string, max = 120) {
  const normalized = value.trim();
  if (!normalized || normalized.length > max) {
    throw new Error(`${label}가 올바르지 않습니다.`);
  }
  return normalized;
}

export function defineSttModel(input: {
  id: string;
  provider: string;
  version: string;
  language: string;
  format: string;
  sha256: string;
  downloadBytes?: number | null;
}): SttModelDescriptor {
  const sha256 = input.sha256.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new Error('STT model sha256이 필요합니다.');
  }

  const downloadBytes = input.downloadBytes ?? null;
  if (downloadBytes !== null && (!Number.isSafeInteger(downloadBytes) || downloadBytes <= 0)) {
    throw new Error('STT model downloadBytes가 올바르지 않습니다.');
  }

  return Object.freeze({
    id: cleanToken(input.id, 'STT model id'),
    provider: cleanToken(input.provider, 'STT model provider').toLowerCase(),
    version: cleanToken(input.version, 'STT model version'),
    language: cleanToken(input.language, 'STT model language', 32),
    format: cleanToken(input.format, 'STT model format', 64).toLowerCase(),
    sha256,
    downloadBytes,
  });
}

export function validateResolvedSttModel(
  descriptor: SttModelDescriptor,
  resolved: ResolvedSttModel,
): ResolvedSttModel {
  if (resolved.descriptor.id !== descriptor.id
    || resolved.descriptor.provider !== descriptor.provider
    || resolved.descriptor.version !== descriptor.version
    || resolved.descriptor.sha256 !== descriptor.sha256) {
    throw new Error('요청한 STT model과 확보된 model identity가 일치하지 않습니다.');
  }

  const localPath = resolved.localPath.trim();
  if (!localPath) throw new Error('STT model local path가 없습니다.');

  return Object.freeze({
    descriptor,
    localPath,
  });
}
