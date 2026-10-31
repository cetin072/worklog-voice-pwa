import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
register('./helpers/mobile-ts-loader.mjs', import.meta.url);
const { createCaptureInbox } = await import('../mobile/src/features/capture/capture-inbox.ts');
const ts = createRequire(new URL('../mobile/package.json', import.meta.url))('typescript');
function load(path, modules) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
    { exports, URL, Uint8Array, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return exports;
}
function harness() {
  const rows = new Map(), opened = [], removed = [];
  const inbox = createCaptureInbox({ getItem: async key => rows.get(key) || null, setItem: async (key, value) => rows.set(key, value) });
  const state = { galleryActive: false };
  let pick = async () => 'file:///cache/selected.png', current = true, picks = 0, copies = 0;
  const { importCaptureFromGallery } = load('mobile/src/features/capture/capture-gallery.ts', {
    './capture-runtime': { captureInbox: inbox, captureImportState: state },
    './capture-gallery-picker': { pickCaptureImage: () => { picks++; return pick(); } },
    './capture-files': { importPickedCaptureImage: async () => { copies++; return { hash: 'a'.repeat(64), uri: 'file:///private/' + copies }; }, removeCaptureImage: async uri => removed.push(uri) },
  });
  return { inbox, state, opened, removed, pick: fn => pick = fn, switchAccount: () => current = false, picks: () => picks, copies: () => copies,
    run: () => importCaptureFromGallery('alice', () => current, hash => opened.push(hash)) };
}
test('gallery selection enters the same durable inbox and repeated selection reuses the saved receipt', async () => {
  const h = harness(); await h.run(); const entry = await h.inbox.get('a'.repeat(64), 'alice');
  assert.equal(h.opened[0], entry.hash); await h.inbox.put({ ...entry, saved: { pageId: 'saved-record' }, uri: undefined });
  await h.run(); assert.equal((await h.inbox.get(entry.hash, 'alice')).saved.pageId, 'saved-record');
  assert.deepEqual(h.removed, ['file:///private/2']); assert.equal(h.state.galleryActive, false);
});
test('cancel does not copy or create a record, and repeated taps cannot launch a second picker', async () => {
  const h = harness(); let release; h.pick(() => new Promise(resolve => release = resolve));
  const pending = h.run(); assert.equal(h.state.galleryActive, true); await h.run(); assert.equal(h.picks(), 1);
  release(null); await pending; assert.equal(h.copies(), 0); assert.equal(h.opened.length, 0); assert.equal(await h.inbox.pending('alice'), null);
});
test('an account switch retains the selected image for its original owner without opening it for another account', async () => {
  const h = harness(); let release; h.pick(() => new Promise(resolve => release = resolve));
  const pending = h.run(); h.switchAccount(); release('file:///cache/selected.png'); await pending;
  assert.ok(await h.inbox.pending('alice')); assert.equal(await h.inbox.pending('bob'), null); assert.equal(h.opened.length, 0);
});
test('picker uses a single original image and cancellation is normal', async () => {
  let options, response = { canceled: true };
  const picker = load('mobile/src/features/capture/capture-gallery-picker.ts', { 'expo-image-picker': { launchImageLibraryAsync: async value => { options = value; return response; } } });
  assert.equal(await picker.pickCaptureImage(), null); assert.equal(options.mediaTypes[0], 'images'); assert.equal(options.quality, 1);
  assert.equal(options.allowsMultipleSelection, false); assert.equal(options.allowsEditing, false);
  response = { canceled: false, assets: [{ type: 'image', uri: 'file:///cache/one.png' }] }; assert.equal(await picker.pickCaptureImage(), response.assets[0].uri);
  response = { canceled: false, assets: [{ type: 'video', uri: 'file:///cache/clip.mp4' }] }; await assert.rejects(picker.pickCaptureImage());
});
test('only picker cache files are copied and cleaned; shared private/cache URIs stay rejected', async () => {
  const deleted = [], copied = [];
  const files = load('mobile/src/features/capture/capture-files.ts', {
    'expo-constants': { __esModule: true, default: { expoConfig: { android: { package: 'com.cetin072.worklog.qa' } } } },
    'react-native': { Image: { getSize: (_uri, success) => success(320, 390) } },
    'expo-file-system/legacy': { documentDirectory: 'file:///private/files/', cacheDirectory: 'file:///private/cache/', makeDirectoryAsync: async () => {}, copyAsync: async value => copied.push(value), deleteAsync: async uri => deleted.push(uri) },
    'expo-file-system': { File: class { exists = true; size = 100; bytes = async () => new Uint8Array([1]); } },
    'expo-crypto': { randomUUID: () => 'private-copy', CryptoDigestAlgorithm: { SHA256: 'SHA256' }, digest: async () => new Uint8Array(32) },
  });
  assert.equal(files.incomingCaptureUri('file:///private/cache/picker.png'), false);
  const image = await files.importPickedCaptureImage('file:///private/cache/picker.png'); assert.equal(image.hash.length, 64);
  assert.equal(copied.length, 1); assert.deepEqual(deleted, ['file:///private/cache/picker.png']);
  for (const uri of ['file:///private/files/auth', 'file:///private/cache/../files/auth', 'file:///private/cache/%2e%2e%2ffiles/auth', 'https://example.com/image.png']) await assert.rejects(files.importPickedCaptureImage(uri));
});
test('committed capture notifications refresh preserved Home and select the correct bucket without changing drafts', () => {
  const source = readFileSync('mobile/app/index.tsx', 'utf8'); const ast = ts.createSourceFile('home.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function walk(node) { if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useEffect' && node.arguments[0]?.getText(ast).includes('captureChanges.subscribe')) effect = node.arguments[0].getText(ast); ts.forEachChild(node, walk); }
  walk(ast); assert.ok(effect); let listener, refreshes = 0, selected = null, expanded = {}, unsubscribed = false;
  const scope = { session: { user: { id: 'alice' } }, client: {}, captureChanges: { subscribe: fn => { listener = fn; return () => unsubscribed = true; } },
    seoulTodayKey: () => '2026-10-31', setTaskFilter: value => selected = value, setExpandedBuckets: fn => expanded = fn(expanded), setUpcomingExpanded: () => {}, refreshBriefing: () => refreshes++ };
  const js = ts.transpileModule(`return (${effect});`, {}).outputText; const cleanup = new Function('scope', `with(scope) { ${js} }`)(scope)();
  listener({ owner: 'bob', recordId: 'other', dueDate: '' }); assert.equal(refreshes, 0);
  listener({ owner: 'alice', recordId: 'review-id', dueDate: '' }); assert.equal(refreshes, 1); assert.equal(selected, 'undated'); assert.equal(expanded.undated, true);
  listener({ owner: 'alice', recordId: 'edited-id', dueDate: '2026-10-31' }); assert.equal(selected, 'today');
  listener({ owner: 'alice', recordId: 'edited-id', dueDate: '', cancelled: true }); assert.equal(refreshes, 3); assert.equal(selected, 'today'); cleanup(); assert.equal(unsubscribed, true);
});
