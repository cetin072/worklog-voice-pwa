import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
for(const file of ['morning-push.mts','afternoon-push.mts']) test(`${file} 기존 Push 함수가 유지된다`,()=>{const src=fs.readFileSync(new URL(`../netlify/functions/${file}`,import.meta.url),'utf8');assert.match(src,/sendWebPush/);assert.match(src,/client\.finish/);});
