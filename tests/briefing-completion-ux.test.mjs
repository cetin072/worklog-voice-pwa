import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("완료는 서버 왕복 전에 화면에서 즉시 반영되고 실패하면 되돌린다", () => {
  const source = read("public/briefing-v2.js");
  const start = source.indexOf("async function completeTask");
  const end = source.indexOf("async function undoTask", start);
  const complete = source.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(complete, /const optimisticState=beginOptimisticComplete\(button\)/);
  assert.ok(
    complete.indexOf("beginOptimisticComplete(button)") < complete.indexOf('await updateTaskStatus(pageId,"완료")'),
    "optimistic UI must happen before the status request completes"
  );
  assert.match(complete, /rollbackOptimisticComplete\(optimisticState\)/);
  assert.doesNotMatch(complete, /await refreshV2/);
  assert.match(complete, /syncV2InBackground\(\)/);
});

test("완료 후 전체 브리핑 재조회는 blocking loading 없이 백그라운드에서 동기화한다", () => {
  const source = read("public/briefing-v2.js");
  const start = source.indexOf("function syncV2InBackground");
  const end = source.indexOf("function showUndoNotice", start);
  const background = source.slice(start, end);

  assert.match(background, /pendingCompletions>0/);
  assert.match(background, /await fetchV2\(\{ask:false\}\)/);
  assert.match(background, /render\(data\)/);
  assert.doesNotMatch(background, /setBusy\(true\)/);
  assert.doesNotMatch(background, /refreshV2\(/);
});

test("실행 취소는 고정 위치를 유지하되 모바일 화면을 가득 채우지 않는 compact toast다", () => {
  const source = read("public/briefing-v2.js");
  const css = read("public/briefing.css");
  const homeCss = read("public/home-ux.css");

  assert.match(source, /bar\.innerHTML=`<span>완료됨<\/span><button[^`]+실행 취소<\/button>`/);
  assert.match(source, /bar\.setAttribute\("aria-label",`\$\{itemTitle\} 완료 처리됨\. 실행 취소 가능`\)/);
  assert.match(css, /\.briefing-undo-bar\{[^}]*position:fixed/);
  assert.match(css, /\.briefing-undo-bar\{[^}]*width:auto/);
  assert.match(css, /\.briefing-undo-bar\{[^}]*max-width:min\(calc\(100% - 40px\),300px\)/);
  assert.doesNotMatch(css, /briefing-undo-bar\{[^}]*520px/);
  assert.match(homeCss, /\.briefing-undo-bar\{bottom:calc\(226px \+ env\(safe-area-inset-bottom\)\)\}/);
});

test("optimistic completion can hide an empty section and ships with cache-busted assets", () => {
  const css = read("public/briefing.css");
  const html = read("public/index.html");

  assert.match(css, /\.briefing-v2-section\[hidden\]\{display:none\}/);
  assert.match(html, /briefing\.css\?v=20260916-3/);
  assert.match(html, /briefing-v2\.js\?v=20260916-4/);
});
