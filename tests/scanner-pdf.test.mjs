import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../public/scanner-pdf.js',import.meta.url),'utf8');
await import('../public/scanner-pdf.js');
const {createPdf,normalizeFileName}=globalThis.WorklogScannerPdf;

test('PDF filename is sanitized and gets one .pdf extension',()=>{
  assert.equal(normalizeFileName('  계약서:최종?.PDF  '),'계약서-최종-.pdf');
  assert.equal(normalizeFileName(''),'스캔 문서.pdf');
});

test('share compatibility falls back safely when file sharing capability cannot be confirmed',()=>{
  assert.match(source,/typeof root\.File!==['"]function['"]/);
  assert.match(source,/typeof root\.navigator\.canShare!==['"]function['"]/);
  assert.match(source,/root\.navigator\.canShare=\(\)=>false/);
});

test('creates a multi-page PDF in the supplied page order',async()=>{
  const jpegA=new Blob([new Uint8Array([0xff,0xd8,0xff,0xdb,0x41,0xff,0xd9])],{type:'image/jpeg'});
  const jpegB=new Blob([new Uint8Array([0xff,0xd8,0xff,0xdb,0x42,0xff,0xd9])],{type:'image/jpeg'});
  const pdf=await createPdf([{blob:jpegA,width:1200,height:1600},{blob:jpegB,width:1600,height:1200}]);
  assert.equal(pdf.type,'application/pdf');
  const bytes=new Uint8Array(await pdf.arrayBuffer());
  const text=new TextDecoder('latin1').decode(bytes);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.match(text,/\/Count 2/);
  assert.match(text,/\/MediaBox \[0 0 595\.28 841\.89\]/);
  assert.match(text,/\/MediaBox \[0 0 841\.89 595\.28\]/);
  assert.ok(text.indexOf('/Width 1200')<text.indexOf('/Width 1600'),'first selected page object must be emitted before second page');
  const startxref=Number(text.match(/startxref\n(\d+)\n%%EOF/)?.[1]);
  assert.equal(new TextDecoder().decode(bytes.slice(startxref,startxref+4)),'xref');
});
