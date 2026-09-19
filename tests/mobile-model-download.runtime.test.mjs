import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { register } from 'node:module';
import { fs, Paths } from './helpers/download-native.mjs';
const mock = new URL('./helpers/download-native.mjs', import.meta.url).href;
register('./helpers/mobile-ts-loader.mjs', import.meta.url, { data: { mocks: { 'expo-file-system': mock, 'expo/fetch': mock } } });
const { createExpoSttModelResolver, defineDownloadableSttModel, validateModelDownloadResponse } = await import('../mobile/src/features/voice/stt-model-download.ts');
const { defineSttModel } = await import('../mobile/src/features/voice/stt-model.ts');
const bytes = Buffer.from('abcdefghi0123456789');
const descriptor = defineSttModel({ id: 'test', provider: 'test', language: 'ko', version: '1', format: 'bin', sha256: createHash('sha256').update(bytes).digest('hex'), downloadBytes: bytes.length });
const url = 'https://example.invalid/model.bin';
const final = 'file:///test/worklog-stt-models/model.bin'; const partial = `${final}.partial`; const meta = `${final}.resume.json`;
const resolver = () => createExpoSttModelResolver({ models: [defineDownloadableSttModel({ descriptor, downloadUrl: url, fileName: 'model.bin' })] });
const response = (b = bytes, status = 200, extra = {}) => new Response(new Uint8Array(b), { status, headers: { 'content-length': String(b.length), etag: '"object1"', ...extra } });
function seed(n = 5) { fs.files.set(partial, bytes.subarray(0, n)); fs.files.set(meta, Buffer.from(JSON.stringify({ v: 1, url, sha256: descriptor.sha256, etag: '"object1"' }))); }

test('resume appends only validated remaining bytes and sends If-Range; hash matches the complete file', async () => {
  fs.reset(); seed(); Paths.availableDiskSpace = bytes.length - 5;
  fs.reply = () => response(bytes.subarray(5), 206, { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` });
  assert.equal((await resolver().ensureAvailable(descriptor)).localPath, final);
  assert.deepEqual(fs.files.get(final), bytes); assert.equal(fs.requests.length, 1);
  assert.equal(fs.requests[0].opts.headers.Range, 'bytes=5-'); assert.equal(fs.requests[0].opts.headers['If-Range'], '"object1"');
});
test('wrong offset/length/encoding and changed ETag fail once, preserve the partial, never produce final', async () => {
  const cases = [
    () => response(bytes.subarray(5), 206, { 'content-range': `bytes 4-${bytes.length - 2}/${bytes.length}` }),
    () => response(bytes.subarray(5), 206, { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length + 1}` }),
    () => response(bytes.subarray(5), 206, { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`, etag: '"changed"' }),
    () => response(bytes.subarray(5), 206, { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}`, 'content-encoding': 'gzip' }),
  ];
  for (const reply of cases) { fs.reset(); seed(); fs.reply = reply; await assert.rejects(resolver().ensureAvailable(descriptor)); assert.equal(fs.requests.length, 1); assert.deepEqual(fs.files.get(partial), bytes.subarray(0, 5)); assert.equal(fs.files.has(final), false); }
});
test('server ignoring Range cannot append a full duplicate or silently re-download repeatedly', async () => {
  fs.reset(); seed(); fs.reply = () => response();
  await assert.rejects(resolver().ensureAvailable(descriptor), /이어받기를 지원하지/);
  assert.equal(fs.requests.length, 1); assert.deepEqual(fs.files.get(partial), bytes.subarray(0, 5));
});
test('short interrupted body is resumable, not deterministic integrity failure', async () => {
  fs.reset(); let calls = 0;
  fs.reply = () => ++calls === 1 ? response(bytes.subarray(0, 5), 200, { 'content-length': String(bytes.length) })
    : response(bytes.subarray(5), 206, { 'content-range': `bytes 5-${bytes.length - 1}/${bytes.length}` });
  await resolver().ensureAvailable(descriptor); assert.equal(calls, 2); assert.deepEqual(fs.files.get(final), bytes);
  assert.equal(fs.requests[1].opts.headers.Range, 'bytes=5-');
});
test('complete partial and valid final require no network or extra free space', async () => {
  for (const source of [partial, final]) { fs.reset(); fs.files.set(source, bytes); Paths.availableDiskSpace = 0; await resolver().ensureAvailable(descriptor); assert.deepEqual(fs.files.get(final), bytes); assert.equal(fs.requests.length, 0); }
});
test('hash mismatch and promotion failure do not spend three full downloads', async () => {
  fs.reset(); fs.reply = () => response(Buffer.alloc(bytes.length, 42)); await assert.rejects(resolver().ensureAvailable(descriptor), /SHA-256/); assert.equal(fs.requests.length, 1); assert.equal(fs.files.has(final), false);
  fs.reset(); fs.reply = () => response(); fs.beforeMove = () => { throw new Error('promotion failed'); };
  await assert.rejects(resolver().ensureAvailable(descriptor), /promotion failed/); assert.equal(fs.requests.length, 1); assert.deepEqual(fs.files.get(partial), bytes);
});
test('malformed/multipart response cannot be accepted merely because status is 206', () => {
  for (const headers of [{}, { 'content-range': 'bytes 5-3/19' }, { 'content-range': 'items 5-18/19' }, { 'content-range': 'bytes 5-18/19', 'content-type': 'multipart/byteranges; boundary=a' }, { 'content-range': 'bytes 5-18/19', 'content-length': 'Infinity' }]) {
    assert.throws(() => validateModelDownloadResponse(new Response(null, { status: 206, headers }), 5, bytes.length));
  }
});
