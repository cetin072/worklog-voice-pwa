import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Voice Quick Dock adds 취소, 메모, and recording timer around the existing mic", () => {
  const source = read("public/home-ux.js");

  for (const id of ["voiceQuickDock", "voiceDockTimer", "voiceDockTimerText", "voiceDockCancel", "voiceDockManual"]) {
    assert.match(source, new RegExp(id));
  }

  assert.match(source, /dock\.append\(timer, cancel, mic, manual\)/);
  assert.match(source, /\$\("clear"\)\?\.click\(\)/);
  assert.match(source, /\$\("manualEntry"\)\?\.click\(\)/);
  assert.match(source, /"✕", "취소"/);
  assert.match(source, /"✏️", "메모"/);
  assert.match(source, /현재 입력 취소 및 지우기/);
  assert.match(source, /메모 직접 입력으로 이동/);
});

test("recording state owns a visible elapsed timer while idle keeps it hidden", () => {
  const source = read("public/home-ux.js");

  assert.match(source, /timer\.setAttribute\("role", "timer"\)/);
  assert.match(source, /timer\.hidden = true/);
  assert.match(source, /function formatElapsed/);
  assert.match(source, /window\.setInterval\(updateRecordingTimer, 250\)/);
  assert.match(source, /if \(listening\) startRecordingTimer\(\)/);
  assert.match(source, /else stopRecordingTimer\(\)/);
  assert.match(source, /녹음 시간 \$\{Number\(minutes\)\}분 \$\{Number\(seconds\)\}초/);
});

test("quick dock stays fixed, thumb-centered, and safe-area aware", () => {
  const css = read("public/home-ux.css");

  assert.match(css, /\.voice-quick-dock\{[^}]*position:fixed/);
  assert.match(css, /\.voice-quick-dock\{[^}]*left:50%/);
  assert.match(css, /\.voice-quick-dock\{[^}]*safe-area-inset-bottom/);
  assert.match(css, /\.voice-quick-dock \.mic\{[^}]*position:absolute/);
  assert.match(css, /\.voice-quick-action\.is-cancel\{[^}]*left:/);
  assert.match(css, /\.voice-quick-action\.is-manual\{[^}]*right:/);
  assert.match(css, /\.voice-dock-timer\{[^}]*top:0/);
  assert.match(css, /\.voice-quick-action\{[^}]*border-radius:50%/);
  assert.match(css, /\.voice-quick-label\{[^}]*font-size:/);
});

test("Quick Dock remains a thin UX layer without save or API duplication", () => {
  const source = read("public/home-ux.js");
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/worklog/);
  assert.doesNotMatch(source, /localStorage\.setItem\(DRAFT_KEY/);
});

test("Home UX 0.3 is recorded as a product decision and changelog improvement", () => {
  const decisions = read("docs/PRODUCT_DECISIONS.md");
  const changelog = read("CHANGELOG.md");
  assert.match(decisions, /Voice Quick Dock/);
  assert.match(decisions, /좌측.*취소.*우측.*메모/s);
  assert.match(changelog, /Voice Quick Dock/);
  assert.match(changelog, /녹음 시간/);
  assert.match(changelog, /✏️ 메모/);
});