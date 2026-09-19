import {
  createUnconfiguredMobileTranscriptionProvider,
  type MobileTranscriptionProvider,
} from './transcription-provider';

export type MobileSttProviderFactory = () => MobileTranscriptionProvider;

export type MobileSttProviderRegistry = Readonly<{
  ids(): readonly string[];
  has(providerId: string): boolean;
  create(providerId: string): MobileTranscriptionProvider;
}>;

function normalizeProviderId(value: string) {
  const normalized = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(normalized)) {
    throw new Error('STT provider ID 형식이 올바르지 않습니다.');
  }
  return normalized;
}

/**
 * Composition-root registry for replaceable STT providers.
 *
 * UI, Data Core, and transcript normalization must not import provider-native
 * modules. A provider implementation is registered here (or in an adjacent
 * composition module) and exposed only as MobileTranscriptionProvider.
 */
export function createMobileSttProviderRegistry(
  registrations: Readonly<Record<string, MobileSttProviderFactory>> = {},
): MobileSttProviderRegistry {
  const factories = new Map<string, MobileSttProviderFactory>();

  for (const [providerId, factory] of Object.entries(registrations)) {
    const normalized = normalizeProviderId(providerId);
    if (typeof factory !== 'function') {
      throw new Error(`${normalized} STT provider factory가 필요합니다.`);
    }
    if (factories.has(normalized)) {
      throw new Error(`${normalized} STT provider가 중복 등록됐습니다.`);
    }
    factories.set(normalized, factory);
  }

  return Object.freeze({
    ids() {
      return Object.freeze([...factories.keys()].sort());
    },
    has(providerId: string) {
      return factories.has(normalizeProviderId(providerId));
    },
    create(providerId: string) {
      const normalized = normalizeProviderId(providerId);
      const factory = factories.get(normalized);
      if (!factory) return createUnconfiguredMobileTranscriptionProvider(normalized);

      const provider = factory();
      if (provider.provider !== normalized) {
        throw new Error(
          `STT registry key(${normalized})와 provider identity(${provider.provider})가 일치하지 않습니다.`,
        );
      }
      return provider;
    },
  });
}
