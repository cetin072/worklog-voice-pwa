import test from "node:test";
import assert from "node:assert/strict";
import { access, readdir, readFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = resolve(repoRoot, "public");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(path));
    else out.push(path);
  }
  return out;
}

test("index.html이 참조하는 로컬 정적 자산이 모두 존재한다", async () => {
  const html = await readFile(resolve(publicRoot, "index.html"), "utf8");
  const refs = [...html.matchAll(/(?:src|href)=["'](\/[A-Za-z0-9._~!$&'()*+,;=:@%\/-]+)["']/g)]
    .map((match) => match[1])
    .filter((ref) => !ref.startsWith("//"));

  assert.ok(refs.length > 0, "index.html 로컬 자산 참조가 있어야 한다");
  const missing = [];
  for (const ref of new Set(refs)) {
    const clean = ref.split("?")[0].split("#")[0];
    const file = resolve(publicRoot, `.${clean}`);
    if (!(await exists(file))) missing.push(ref);
  }
  assert.deepEqual(missing, []);
});

test("public 모듈의 상대 정적/동적 import 대상이 모두 존재한다", async () => {
  const files = (await walk(publicRoot)).filter((path) => [".mjs", ".js"].includes(extname(path)));
  const missing = [];
  for (const file of files) {
    const source = await readFile(file, "utf8");
    const refs = [
      ...[...source.matchAll(/\bfrom\s+["'](\.[^"']+)["']/g)].map((match) => match[1]),
      ...[...source.matchAll(/\bimport\(\s*["'](\.[^"']+)["']\s*\)/g)].map((match) => match[1]),
    ];
    for (const ref of refs) {
      const clean = ref.split("?")[0].split("#")[0];
      const target = resolve(dirname(file), clean);
      if (!(await exists(target))) missing.push(`${file.replace(repoRoot + "/", "")} -> ${ref}`);
    }
  }
  assert.deepEqual(missing, []);
});
