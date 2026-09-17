import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("legacy capture buttons stay in the DOM only as hidden compatibility controls", () => {
  const html = read("public/index.html");

  for (const id of ["save", "manualEntry", "clear"]) {
    assert.match(html, new RegExp(`<button id="${id}"[^>]*hidden[^>]*aria-hidden="true"[^>]*tabindex="-1"`));
  }
  assert.match(html, /<section id="entryCard" class="card core-app-card" hidden>/);
  assert.match(html, /id="typedSave"/);
});

test("memo opens direct entry while cancel and successful save collapse it again", () => {
  const source = read("public/home-ux.js");

  assert.match(source, /function setEntryOpen\(open\)/);
  assert.match(source, /entryCard\.hidden = !open/);
  assert.match(source, /manual\.setAttribute\("aria-controls", "entryCard"\)/);
  assert.match(source, /manual\.addEventListener\("click", \(\) => \{[\s\S]*setEntryOpen\(true\)[\s\S]*\$\("manualEntry"\)\?\.click\(\)/);
  assert.match(source, /cancel\.addEventListener\("click", \(\) => \{[\s\S]*\$\("clear"\)\?\.click\(\)[\s\S]*setEntryOpen\(false\)/);
  assert.match(source, /worklog:record-saved[\s\S]*if \(!\$\("text"\)\?\.value\?\.trim\(\)\) setEntryOpen\(false\)/);
  assert.match(source, /setEntryOpen\(Boolean\(\$\("text"\)\?\.value\?\.trim\(\)\)\)/);
});

test("Home UX 0.5 remains a thin layer without duplicate save or network logic", () => {
  const source = read("public/home-ux.js");
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\/api\/worklog/);
  assert.doesNotMatch(source, /localStorage\.setItem/);
});
