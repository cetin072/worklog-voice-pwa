import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const targets = [
  "../public/call-folder-shortcut.mjs",
  "../public/call-folder-runtime.mjs",
  "../public/call-folder-utils.mjs",
  "../public/call-inbox.mjs",
  "../public/home-folds.mjs",
  "../public/settings.mjs",
];

test("Preview 핵심 클라이언트 모듈은 JavaScript 문법검사를 통과한다", () => {
  for (const relative of targets) {
    const path = fileURLToPath(new URL(relative, import.meta.url));
    let output = "";
    try {
      output = execFileSync(process.execPath, ["--check", path], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      assert.fail(`${relative} 문법 오류: ${error?.stderr || error?.message || output}`);
    }
  }
});
