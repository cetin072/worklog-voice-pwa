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
});

test("완료 후 재조회는 인라인 실행 취소가 사라진 뒤 blocking loading 없이 동기화한다", () => {
  const source = read("public/briefing-v2.js");
  const start = source.indexOf("function syncV2InBackground");
  const end = source.indexOf("function activateInlineUndo", start);
  const background = source.slice(start, end);

  assert.match(background, /inlineUndoStates\.size>0/);
  assert.match(background, /pendingCompletions>0/);
  assert.match(background, /await fetchV2\(\{ask:false\}\)/);
  assert.match(background, /render\(data\)/);
  assert.doesNotMatch(background, /setBusy\(true\)/);
  assert.doesNotMatch(background, /refreshV2\(/);
});

test("실행 취소는 떠다니는 토스트가 아니라 완료한 업무 자리의 인라인 피드백이다", () => {
  const source = read("public/briefing-v2.js");
  const css = read("public/briefing.css");

  assert.match(source, /row\.classList\.add\("briefing-inline-undo-row"\)/);
  assert.match(source, /row\.innerHTML=`<div class="briefing-inline-undo"><span>✓ 완료됨<\/span><button[^`]+실행 취소<\/button><\/div>`/);
  assert.match(source, /row\.setAttribute\("aria-label",`\$\{itemTitle\} 완료 처리됨\. 실행 취소 가능`\)/);
  assert.match(source, /setTimeout\(\(\)=>\{[\s\S]*state\.row\?\.isConnected[\s\S]*state\.row\.remove\(\)/);
  assert.match(css, /\.briefing-list li\.briefing-inline-undo-row\{/);
  assert.match(css, /\.briefing-inline-undo\{[^}]*display:flex/);
  assert.doesNotMatch(css, /\.briefing-undo-bar\{/);
  assert.doesNotMatch(source, /document\.body\.appendChild\(bar\)/);
});

test("마지막 업무를 완료해도 실행 취소 자리까지 사라지지 않고 asset은 cache-bust 된다", () => {
  const source = read("public/briefing-v2.js");
  const css = read("public/briefing.css");
  const html = read("public/index.html");

  assert.match(source, /section\.hidden=count===0 && pendingRows\.length===0/);
  assert.match(css, /\.briefing-v2-section\[hidden\]\{display:none\}/);
  assert.match(html, /briefing\.css\?v=20260916-3/);
  assert.match(html, /briefing-v2\.js\?v=20260916-4/);
});
