import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const downloader = fs.readFileSync('mobile/src/features/voice/stt-model-download.ts', 'utf8');
const hasher = fs.readFileSync('mobile/src/features/voice/incremental-sha256.ts', 'utf8');

test('large STT model checksum streams file bytes instead of allocating the whole model', () => {
  assert.match(downloader, /readableStream\(\)\.getReader\(\)/);
  assert.match(downloader, /reader\.read\(\)/);
  assert.match(downloader, /IncrementalSha256/);
  assert.doesNotMatch(downloader, /file\.arrayBuffer\(\)|file\.bytes\(\)/);
});

test('incremental SHA-256 keeps bounded 64-byte internal buffering', () => {
  assert.match(hasher, /new Uint8Array\(64\)/);
  assert.match(hasher, /process\(data: Uint8Array/);
  assert.match(hasher, /digestHex\(\)/);
});


test('interrupted model downloads preserve partial bytes, resume with Range, and hide raw network exceptions', () => {
  assert.match(downloader, /DOWNLOAD_ATTEMPTS = 3/);
  assert.match(downloader, /for \(let attempt = 0; attempt < DOWNLOAD_ATTEMPTS/);
  assert.match(downloader, /Range: `bytes=\$\{resumeFrom\}-`/);
  assert.match(downloader, /partialFile\.write\(value, \{ append: bytesWritten > 0 \}\)/);
  assert.match(downloader, /ModelDownloadIntegrityError/);
  assert.match(downloader, /if \(!isRetryableDownloadError\(error\)\) break/);
  assert.match(downloader, /connection reset\|network\|timeout/);
  assert.match(downloader, /음성 모델 다운로드가 중간에 끊겼습니다/);
});
