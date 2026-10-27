import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(new URL('../mobile/package.json', import.meta.url));
const configure = require('./app.config.js');
const base = JSON.parse(readFileSync('mobile/app.json')).expo;
test('approved icon variants preserve app identity, permissions and version', () => {
  const previous = process.env.WORKLOG_ICON_VARIANT;
  try {
    for (const variant of ['existing', 'production', 'qa']) {
      process.env.WORKLOG_ICON_VARIANT = variant;
      const config = configure({ config: base });
      const { icon, adaptiveIcon, ...android } = config.android;
      assert.deepEqual(android, base.android);
      assert.equal(config.scheme, base.scheme);
      assert.equal(config.version, base.version);
      assert.deepEqual(config.plugins, base.plugins);
      assert.equal(icon.includes('qa-launcher'), variant === 'qa');
      assert.ok(readFileSync(`mobile/${adaptiveIcon.foregroundImage}`).length > 0);
    }
  } finally { if (previous === undefined) delete process.env.WORKLOG_ICON_VARIANT; else process.env.WORKLOG_ICON_VARIANT = previous; }
});
test('original approved PNG files are byte-for-byte preserved', () => {
  for (const [name, digest] of [
    ['worklog-launcher', '917669bd70a8b6401e017093768ffdc1553e83c49b2cd117e4619464672a0616'],
    ['worklog-qa-launcher', 'd48c10831e1d6ace0baafe0c6b07245f1b10e28f98bb81c5b9190d582d422cb3'],
  ]) assert.equal(createHash('sha256').update(readFileSync(`mobile/assets/icons/${name}-1024.png`)).digest('hex'), digest);
});
