import * as SecureStore from 'expo-secure-store';

const CHUNK_SIZE = 1500;
const META_SUFFIX = '__chunkmeta';
const CHUNK_SUFFIX = '__chunk_';
const STORE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

type ChunkMeta = { chunks: number };

function metaKey(key: string) {
  return `${key}${META_SUFFIX}`;
}

function chunkKey(key: string, index: number) {
  return `${key}${CHUNK_SUFFIX}${index}`;
}

async function readChunkMeta(key: string): Promise<ChunkMeta | null> {
  const raw = await SecureStore.getItemAsync(metaKey(key));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ChunkMeta>;
    if (Number.isInteger(parsed.chunks) && Number(parsed.chunks) > 0 && Number(parsed.chunks) < 100) {
      return { chunks: Number(parsed.chunks) };
    }
  } catch {
    // Ignore damaged metadata and fall back to the direct key.
  }
  return null;
}

export const secureSessionStorage = {
  async getItem(key: string) {
    const meta = await readChunkMeta(key);
    if (!meta) return SecureStore.getItemAsync(key);

    const chunks = await Promise.all(
      Array.from({ length: meta.chunks }, (_, index) => SecureStore.getItemAsync(chunkKey(key, index))),
    );
    if (chunks.some((part) => part === null)) return null;
    return chunks.join('');
  },

  async setItem(key: string, value: string) {
    await this.removeItem(key);

    if (value.length <= CHUNK_SIZE) {
      await SecureStore.setItemAsync(key, value, STORE_OPTIONS);
      return;
    }

    const chunks: string[] = [];
    for (let index = 0; index < value.length; index += CHUNK_SIZE) {
      chunks.push(value.slice(index, index + CHUNK_SIZE));
    }

    await Promise.all(
      chunks.map((part, index) => SecureStore.setItemAsync(chunkKey(key, index), part, STORE_OPTIONS)),
    );
    await SecureStore.setItemAsync(metaKey(key), JSON.stringify({ chunks: chunks.length }), STORE_OPTIONS);
  },

  async removeItem(key: string) {
    const meta = await readChunkMeta(key);
    if (meta) {
      await Promise.all(
        Array.from({ length: meta.chunks }, (_, index) => SecureStore.deleteItemAsync(chunkKey(key, index))),
      );
      await SecureStore.deleteItemAsync(metaKey(key));
    }
    await SecureStore.deleteItemAsync(key);
  },
};
