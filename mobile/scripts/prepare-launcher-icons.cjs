// Deterministic Android packaging of the approved originals; no artwork redraw.
// Expo's existing image dependency supplies Jimp. Keep the full approved square
// inside 72/108 of the adaptive layer so circle/squircle masks do not crop the book.
const Jimp = require('jimp-compact');
const path = require('node:path');
const root = path.join(__dirname, '../assets/icons');
(async () => {
  for (const name of ['worklog-launcher', 'worklog-qa-launcher']) {
    const source = await Jimp.read(path.join(root, `${name}-1024.png`));
    if (source.bitmap.width !== 1024 || source.bitmap.height !== 1024) throw Error('Expected approved 1024px icon');
    const foreground = new Jimp(1536, 1536, 0x00000000);
    foreground.composite(source, 256, 256);
    await foreground.writeAsync(path.join(root, `${name}-adaptive.png`));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
