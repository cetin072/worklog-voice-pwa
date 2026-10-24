import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
const source = fs.readFileSync('mobile/app.config.js', 'utf8');
const original = JSON.parse(fs.readFileSync('mobile/app.json', 'utf8')).expo;
function load(variant, present = false) {
  const context = { module: { exports: {} }, process: { env: variant === undefined ? {} : { WORKLOG_ICON_VARIANT: variant } }, __dirname: '/approved-mobile', require(name) {
    if (name === 'node:fs') return { existsSync(file) { assert.ok(file.startsWith('/approved-mobile/assets/')); return present; } };
    if (name === 'node:path') return path;
    throw Error('Unexpected dependency');
  } };
  vm.runInNewContext(source, context);
  return context.module.exports;
}
for (const variant of [undefined, 'existing']) test(`unselected icons preserve current config: ${variant}`, () => {
  assert.equal(load(variant)({ config: original }), original);
});
for (const variant of ['base', 'qa']) {
  test(`missing ${variant} bytes fail closed without pretending the image was applied`, () => {
    assert.throws(() => load(variant)({ config: original }), /not available locally/);
  });
  test(`${variant} selection preserves package, scheme, version and unrelated configuration`, () => {
    const config = structuredClone(original);
    const result = load(variant, true)({ config });
    const expected = variant === 'qa' ? './assets/worklog-qa-launcher-1024.png' : './assets/worklog-launcher-1024.png';
    assert.equal(result.icon, expected);
    assert.equal(result.android.icon, expected);
    assert.equal(result.ios.icon, expected);
    assert.equal(result.web.favicon, expected);
    assert.equal(result.android.package, original.android.package);
    assert.equal(result.scheme, original.scheme);
    assert.equal(result.android.versionCode, original.android.versionCode);
    assert.deepEqual(config, original);
    assert.equal(result.android.adaptiveIcon, undefined);
  });
}
test('invalid selection and unreviewed adaptive overrides fail closed', () => {
  assert.throws(() => load('other')({ config: original }), /must be/);
  assert.throws(() => load('qa', true)({ config: { ...original, android: { ...original.android, adaptiveIcon: {} } } }), /adaptive layers/);
});
