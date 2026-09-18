import { readFile, access } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';

let mocks = {};
const root = new URL('../../mobile/', import.meta.url);
export function initialize(data = {}) { mocks = data.mocks || {}; }
export async function resolve(specifier, context, nextResolve) {
  if (mocks[specifier]) return { url: mocks[specifier], shortCircuit: true };
  const mobileParent = context.parentURL?.includes('/mobile/src/');
  if (mobileParent && (specifier.startsWith('@/') || specifier.startsWith('.'))) {
    const url = specifier.startsWith('@/') ? new URL(specifier.slice(2), root) : new URL(specifier, context.parentURL);
    for (const suffix of ['', '.ts', '/index.ts']) {
      try { await access(new URL(`${url.href}${suffix}`)); return { url: `${url.href}${suffix}`, shortCircuit: true }; } catch { /* try extension */ }
    }
  }
  return nextResolve(specifier, context);
}
// Strip types from CURRENT production sources. Only native/network/storage boundaries may be mocked.
export async function load(url, context, nextLoad) {
  if (url.startsWith('file:') && url.endsWith('.ts') && url.includes('/mobile/src/')) {
    return { format: 'module', source: stripTypeScriptTypes(await readFile(new URL(url), 'utf8'), { mode: 'transform' }), shortCircuit: true };
  }
  return nextLoad(url, context);
}
