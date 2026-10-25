import fs from 'node:fs';
const highest = Number(process.env.HIGHEST_CODE);
const release = Number(process.env.RELEASE_CODE);
if (!/^\d+$/.test(process.env.HIGHEST_CODE || '') || !/^\d+$/.test(process.env.RELEASE_CODE || '') || !Number.isSafeInteger(highest) || highest < 0 || !Number.isSafeInteger(release) || release <= highest || release > 2100000000) throw Error('Console-verified highest code and a greater valid release code are required');
const path = 'mobile/app.json';
const config = JSON.parse(fs.readFileSync(path, 'utf8'));
if (config.expo.android.package !== 'com.cetin072.worklog') throw Error('Unexpected Play identity');
config.expo.android.versionCode = release;
fs.writeFileSync(path, JSON.stringify(config, null, 2) + '\n');
