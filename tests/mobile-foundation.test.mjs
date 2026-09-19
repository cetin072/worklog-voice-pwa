import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

async function text(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('mobile foundation pins Expo 57 and Expo Router entry', async () => {
  const pkg = JSON.parse(await text('mobile/package.json'));
  assert.equal(pkg.main, 'expo-router/entry');
  assert.match(pkg.dependencies.expo, /^57\./);
  assert.match(pkg.dependencies['expo-router'], /^57\./);
  assert.equal(pkg.dependencies['react-native'], '0.86.3');
  assert.ok(pkg.dependencies['expo-secure-store']);
  assert.ok(pkg.dependencies['@supabase/supabase-js']);
  for (const version of Object.values({ ...pkg.dependencies, ...pkg.devDependencies })) {
    assert.doesNotMatch(String(version), /^[~^]/, 'mobile direct dependencies must be pinned exactly');
  }
});

test('mobile foundation keeps secrets out of the checked-in env example', async () => {
  const env = await text('mobile/.env.example');
  assert.match(env, /EXPO_PUBLIC_API_BASE_URL=/);
  assert.doesNotMatch(env, /SERVICE_ROLE|NOTION_TOKEN|APP_ACCESS_KEY|PRIVATE_KEY/i);
});

test('mobile foundation reuses the existing platform endpoints', async () => {
  const config = await text('mobile/src/platform/config.ts');
  const api = await text('mobile/src/platform/worklog-api.ts');
  assert.match(config, /\/api\/supabase-auth-config/);
  assert.match(api, /\/api\/briefing-fast/);
  assert.match(api, /\/api\/worklog/);
  assert.match(api, /authorization: `Bearer \$\{accessToken\}`/);
});

test('mobile auth session storage uses Expo SecureStore', async () => {
  const storage = await text('mobile/src/platform/secure-storage.ts');
  assert.match(storage, /expo-secure-store/);
  assert.match(storage, /createDurableStorage/);
  const durable = await text('mobile/src/platform/durable-storage.ts');
  assert.match(durable, /STORAGE_LIMITS/);
  assert.match(storage, /AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY/);
});
