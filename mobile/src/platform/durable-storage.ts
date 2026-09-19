/**
 * Copy-on-write storage over individually replaceable encrypted native keys.
 * No multi-key/OS power-loss atomicity is assumed. A committed manifest selects
 * exactly one immutable generation; a durable intent tracks interrupted writes.
 * One instance owns a namespace in one JS runtime. Native cross-process writers
 * must not share it without an additional native transaction/locking mechanism.
 */
export type NativeStringStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};
export const STORAGE_LIMITS = Object.freeze({ chunkBytes: 1500, maxBytes: 1_500_000, maxChunks: 1024 });
export class StorageIntegrityError extends Error {
  constructor(readonly code: string) {
    super(`기기 저장소를 안전하게 처리하지 못했습니다. 다시 시도해주세요. (${code})`);
    this.name = 'StorageIntegrityError';
  }
}
type Generation = { id: string; chunks: number; length: number; bytes: number; digest: string };
type Legacy = { chunks: number };
type Manifest = { v: 1; current: Generation | null; garbage: Generation[]; legacy: Legacy | null };
const ID = /^[a-f0-9]{32}$/;
const HASH = /^[a-f0-9]{64}$/;
const headKey = (key: string) => `${key}__atomic_v1`;
const pendingKey = (key: string) => `${key}__atomic_pending_v1`;
const partKey = (key: string, id: string, index: number) => `${key}__atomic_${id}_${index}`;
const legacyMetaKey = (key: string) => `${key}__chunkmeta`;
const legacyPartKey = (key: string, index: number) => `${key}__chunk_${index}`;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function parse(raw: string): unknown {
  try { return JSON.parse(raw); } catch { throw new StorageIntegrityError('CORRUPT_METADATA'); }
}
function validCount(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0 && Number(value) <= STORAGE_LIMITS.maxChunks;
}
function generation(value: unknown): Generation {
  if (!object(value) || typeof value.id !== 'string' || !ID.test(value.id)
    || !validCount(value.chunks) || !Number.isInteger(value.length) || Number(value.length) < 0
    || !Number.isInteger(value.bytes) || Number(value.bytes) < 0 || Number(value.bytes) > STORAGE_LIMITS.maxBytes
    || Number(value.length) > Number(value.bytes) || typeof value.digest !== 'string' || !HASH.test(value.digest)) {
    throw new StorageIntegrityError('CORRUPT_GENERATION');
  }
  return { id: value.id, chunks: value.chunks, length: Number(value.length), bytes: Number(value.bytes), digest: value.digest };
}
function legacy(value: unknown): Legacy {
  if (!object(value) || !Number.isInteger(value.chunks) || Number(value.chunks) < 0
    || Number(value.chunks) > STORAGE_LIMITS.maxChunks) throw new StorageIntegrityError('CORRUPT_LEGACY');
  return { chunks: Number(value.chunks) };
}
function manifest(raw: string): Manifest {
  const value = parse(raw);
  if (!object(value) || value.v !== 1 || !Array.isArray(value.garbage) || value.garbage.length > 2) {
    throw new StorageIntegrityError('CORRUPT_MANIFEST');
  }
  const current = value.current === null ? null : generation(value.current);
  const garbage = value.garbage.map(generation);
  if (garbage.some((ref) => ref.id === current?.id)) throw new StorageIntegrityError('UNSAFE_CLEANUP');
  return { v: 1, current, garbage, legacy: value.legacy === null ? null : legacy(value.legacy) };
}

/** UTF-8 byte bounded; never split a surrogate pair or pass malformed Unicode to native storage. */
function chunk(value: string) {
  if (typeof value !== 'string') throw new StorageIntegrityError('INVALID_VALUE');
  const parts: string[] = [];
  let part = ''; let partBytes = 0; let bytes = 0;
  for (const char of value) {
    const cp = char.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) throw new StorageIntegrityError('INVALID_UNICODE');
    const size = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    bytes += size;
    if (bytes > STORAGE_LIMITS.maxBytes) throw new StorageIntegrityError('VALUE_TOO_LARGE');
    if (partBytes + size > STORAGE_LIMITS.chunkBytes) { parts.push(part); part = ''; partBytes = 0; }
    part += char; partBytes += size;
  }
  parts.push(part);
  if (parts.length > STORAGE_LIMITS.maxChunks) throw new StorageIntegrityError('VALUE_TOO_LARGE');
  return { parts, bytes };
}

export function createDurableStorage(options: {
  store: NativeStringStore;
  newGenerationId(): string;
  digest(value: string): Promise<string>;
  onMaintenancePending?(): void;
}) {
  const { store } = options;
  const tails = new Map<string, Promise<void>>();
  function serial<T>(key: string, operation: () => Promise<T>): Promise<T> {
    if (!/^[a-zA-Z0-9._-]+$/.test(key)) return Promise.reject(new StorageIntegrityError('INVALID_KEY'));
    const result = (tails.get(key) || Promise.resolve()).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    tails.set(key, tail);
    void tail.then(() => { if (tails.get(key) === tail) tails.delete(key); });
    return result;
  }
  async function readManifest(key: string) {
    const raw = await store.getItem(headKey(key));
    return raw === null ? null : manifest(raw);
  }
  async function readPending(key: string) {
    const raw = await store.getItem(pendingKey(key));
    return raw === null ? null : generation(parse(raw));
  }
  async function readLegacyInfo(key: string): Promise<Legacy> {
    const raw = await store.getItem(legacyMetaKey(key));
    if (raw === null) return { chunks: 0 };
    const value = legacy(parse(raw));
    if (!value.chunks) throw new StorageIntegrityError('CORRUPT_LEGACY');
    return value;
  }
  async function readGeneration(key: string, ref: Generation) {
    const parts: string[] = [];
    for (let i = 0; i < ref.chunks; i += 1) {
      const part = await store.getItem(partKey(key, ref.id, i));
      if (part === null) throw new StorageIntegrityError('MISSING_CHUNK');
      parts.push(part);
    }
    const value = parts.join('');
    if (value.length !== ref.length || chunk(value).bytes !== ref.bytes || await options.digest(value) !== ref.digest) {
      throw new StorageIntegrityError('CORRUPT_VALUE');
    }
    return value;
  }
  async function readUnlocked(key: string): Promise<string | null> {
    const state = await readManifest(key);
    if (state) return state.current ? readGeneration(key, state.current) : null;
    const info = await readLegacyInfo(key);
    if (!info.chunks) return store.getItem(key);
    const parts: string[] = [];
    for (let i = 0; i < info.chunks; i += 1) {
      const part = await store.getItem(legacyPartKey(key, i));
      if (part === null) throw new StorageIntegrityError('MISSING_LEGACY_CHUNK');
      parts.push(part);
    }
    const value = parts.join('');
    chunk(value); // Apply the same documented size/Unicode bounds to migrated data.
    return value;
  }
  async function deleteGeneration(key: string, ref: Generation) {
    for (let i = 0; i < ref.chunks; i += 1) await store.removeItem(partKey(key, ref.id, i));
  }
  async function maintenance(key: string) {
    const state = await readManifest(key);
    const pending = await readPending(key);
    // An interrupted commit may have succeeded natively even if JS never received its result.
    if (pending) {
      if (pending.id !== state?.current?.id) await deleteGeneration(key, pending);
      await store.removeItem(pendingKey(key));
    }
    if (!state) return;
    for (const old of state.garbage) await deleteGeneration(key, old);
    if (state.legacy) {
      for (let i = 0; i < state.legacy.chunks; i += 1) await store.removeItem(legacyPartKey(key, i));
      await store.removeItem(key);
      await store.removeItem(legacyMetaKey(key));
    }
    if (state.garbage.length || state.legacy) {
      await store.setItem(headKey(key), JSON.stringify({ ...state, garbage: [], legacy: null }));
    }
  }
  async function bestEffortMaintenance(key: string) {
    try { await maintenance(key); }
    catch {
      // Only post-commit garbage collection is deferred. Current state remains durable.
      try { options.onMaintenancePending?.(); } catch { /* diagnostics cannot change a committed result */ }
    }
  }
  async function writeUnlocked(key: string, value: string) {
    const { parts, bytes } = chunk(value); // Reject over-limit writes BEFORE any mutation.
    const digest = await options.digest(value);
    if (!HASH.test(digest)) throw new StorageIntegrityError('INVALID_DIGEST');
    await maintenance(key); // Never overwrite an unresolved durable intent.
    const previous = await readManifest(key);
    const legacyInfo = previous ? null : await readLegacyInfo(key);
    const id = options.newGenerationId();
    if (!ID.test(id) || id === previous?.current?.id) throw new StorageIntegrityError('INVALID_GENERATION_ID');
    const ref: Generation = { id, chunks: parts.length, length: value.length, bytes, digest };
    await store.setItem(pendingKey(key), JSON.stringify(ref));
    // Sequential writes ensure there are no still-running writes after one rejects.
    for (let i = 0; i < parts.length; i += 1) await store.setItem(partKey(key, id, i), parts[i]);
    if (await readGeneration(key, ref) !== value) throw new StorageIntegrityError('WRITE_VERIFICATION_FAILED');
    const next: Manifest = { v: 1, current: ref, garbage: previous?.current ? [previous.current] : [], legacy: legacyInfo };
    try { await store.setItem(headKey(key), JSON.stringify(next)); }
    catch (error) {
      // Do not roll back blindly after an ambiguous native write acknowledgement.
      if ((await readManifest(key))?.current?.id !== id) throw error;
    }
    await bestEffortMaintenance(key);
  }
  async function removeUnlocked(key: string) {
    let previous: Manifest | null = null;
    let legacyInfo: Legacy | null = null;
    try { previous = await readManifest(key); if (!previous) legacyInfo = await readLegacyInfo(key); }
    catch (error) {
      if (!(error instanceof StorageIntegrityError)) throw error;
      // Explicit deletion may tombstone corrupt metadata, but must never guess orphan ownership.
    }
    const next: Manifest = {
      v: 1, current: null,
      garbage: previous?.current ? [...previous.garbage, previous.current] : previous?.garbage || [],
      legacy: previous?.legacy || legacyInfo,
    };
    // Retain this tombstone, even if physical cleanup fails; never fall back to an old session.
    await store.setItem(headKey(key), JSON.stringify(next));
    await bestEffortMaintenance(key);
  }
  return Object.freeze({
    getItem: (key: string) => serial(key, () => readUnlocked(key)),
    setItem: (key: string, value: string) => serial(key, () => writeUnlocked(key, value)),
    removeItem: (key: string) => serial(key, () => removeUnlocked(key)),
    /** Atomic read-modify-write for a shared logical value in this JS runtime. No nested calls for this key. */
    updateItem: (key: string, update: (previous: string | null) => string | null) => serial(key, async () => {
      const next = update(await readUnlocked(key));
      if (next === null) await removeUnlocked(key); else await writeUnlocked(key, next);
      return next;
    }),
    // Explicit recovery is useful on startup; reads remain non-destructive.
    recover: (key: string) => serial(key, () => maintenance(key)),
  });
}
