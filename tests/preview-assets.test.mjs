import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function localAssetPath(value) {
  if (!value || /^(?:https?:|data:|#)/i.test(value)) return null;
  const clean = value.split(/[?#]/)[0];
  if (!clean) return null;
  return clean.startsWith("/") ? resolve(publicDir, clean.slice(1)) : null;
}

test("index.html의 로컬 script·stylesheet·manifest·icon 자산이 실제 public에 존재한다", async () => {
  const html = await readFile(resolve(publicDir, "index.html"), "utf8");
  const refs = [];
  for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/gi)) refs.push(match[1]);
  assert.ok(refs.length > 0);
  for (const ref of refs) {
    const path = localAssetPath(ref);
    if (!path) continue;
    assert.equal(await exists(path), true, `누락된 Preview 자산: ${ref}`);
  }
});

test("public 모듈의 상대 정적·동적 import 대상이 실제 파일로 존재한다", async () => {
  const modules = [
    "call-folder-shortcut.mjs",
    "call-folder-runtime.mjs",
    "call-folder-utils.mjs",
    "home-folds.mjs",
    "call-analysis-preview.mjs",
    "mock-call-review.mjs",
    "mock-call-review-bridge.mjs",
    "settings.mjs",
    "usage-dashboard.mjs",
  ];
  for (const file of modules) {
    const full = resolve(publicDir, file);
    assert.equal(await exists(full), true, `${file} 자체가 누락됨`);
    const source = await readFile(full, "utf8");
    const specs = [
      ...source.matchAll(/(?:from\s+|import\s*\()(["'])(\.\.?\/[^"']+)\1/g),
    ].map((match) => match[2]);
    for (const spec of specs) {
      const target = resolve(dirname(full), spec);
      assert.equal(await exists(target), true, `${file} → ${spec} import 대상이 누락됨`);
    }
  }
});
