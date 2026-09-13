import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const scanner=await readFile(new URL('../public/scanner.js',import.meta.url),'utf8');
const css=await readFile(new URL('../public/scanner.css',import.meta.url),'utf8');
const sw=await readFile(new URL('../public/sw.js',import.meta.url),'utf8');

test('gallery import is primary and camera capture remains separate',()=>{
  assert.match(scanner,/galleryInput\.multiple=true/);
  assert.match(scanner,/galleryInput\.removeAttribute\("capture"\)/);
  assert.match(scanner,/input\.setAttribute\("capture","environment"\)/);
  assert.match(scanner,/갤러리에서 문서 선택/);
  assert.match(scanner,/카메라로 촬영/);
});

test('multi-page scanner supports edit delete reorder PDF save and share',()=>{
  for(const token of ['movePage(','deletePage(','editPage(','buildPdf(','navigator.share','scanPdfSave','scanPdfShare'])assert.ok(scanner.includes(token),token);
  assert.match(scanner,/pages\.push\(page\)/);
  assert.match(scanner,/persistPages\(\)/);
  assert.match(scanner,/sourceBlob/);
  assert.match(css,/\.scan-pdf-card/);
  assert.match(css,/\.scan-page-item/);
  assert.match(sw,/\/scanner-pdf\.js/);
});
