import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("home puts the daily briefing before capture support content", () => {
  const html = read("public/index.html");
  const briefing = html.indexOf('id="homeBriefingCard"');
  const voice = html.indexOf('class="card voice-card core-app-card"');
  const entry = html.indexOf('id="entryCard"');

  assert.ok(briefing >= 0, "home daily briefing card missing");
  assert.ok(voice > briefing, "daily briefing should appear before voice support card");
  assert.ok(entry > voice, "direct input should remain after the voice support card");

  for (const id of [
    "homeBriefingOverdueCount",
    "homeBriefingTodayCount",
    "homeBriefingUpcomingCount",
    "homeBriefingUndatedCount",
    "homeBriefingOpen",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  for (const label of ["지난 것", "오늘 할 일", "다가오는 업무", "기한 없는 업무"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
});

test("primary voice capture stays in the lower-center thumb reach zone", () => {
  const css = read("public/home-ux.css");
  assert.match(css, /\.voice-quick-dock\{[^}]*position:fixed/);
  assert.match(css, /\.voice-quick-dock\{[^}]*left:50%/);
  assert.match(css, /\.voice-quick-dock\{[^}]*bottom:calc\([^)]*env\(safe-area-inset-bottom\)/);
  assert.match(css, /\.voice-quick-dock\{[^}]*transform:translateX\(-50%\)/);
  assert.match(css, /\.voice-quick-dock \.mic\{[^}]*left:50%/);
  assert.match(css, /\.voice-quick-dock \.mic\{[^}]*bottom:0/);
  assert.match(css, /\.app\{[^}]*padding-bottom:calc\(/);

  const clearRule = css.match(/\.voice-card \.clear\{([^}]*)\}/)?.[1] || "";
  assert.doesNotMatch(clearRule, /position\s*:\s*fixed/);
});

test("one mic CTA owns idle and recording-end labels", () => {
  const html = read("public/index.html");
  const source = read("public/home-ux.js");

  assert.match(html, /id="mic"/);
  assert.match(html, /id="micText">음성 기록<\/span>/);
  assert.match(source, /listening \? "종료" : "음성 기록"/);
  assert.match(source, /음성 기록 종료 후 저장/);
  assert.match(source, /MutationObserver\(syncMicState\)/);
});

test("compact briefing reuses the exact four Briefing V2 work buckets", () => {
  const source = read("public/home-ux.js");
  assert.match(source, /getElementById\("briefingV2"\)|\$\("briefingV2"\)/);
  assert.match(source, /summaryCount\(summary, "\.is-overdue"\)/);
  assert.match(source, /summaryCount\(summary, "\.is-today"\)/);
  assert.match(source, /summaryCount\(summary, "\.is-upcoming"\)/);
  assert.match(source, /summaryCount\(summary, "\.is-undated"\)/);
  assert.doesNotMatch(source, /briefing-v2-schedules/);
  assert.doesNotMatch(source, /dataset\.followUpCount/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\/api\//);
});

test("compact and full briefing use the same labels and visual bucket order", () => {
  const html = read("public/index.html");
  const source = read("public/briefing-v2.js");
  const css = read("public/home-ux.css");
  const labels = ["지난 것", "오늘 할 일", "다가오는 업무", "기한 없는 업무"];
  let previous = -1;
  for (const label of labels) {
    const index = html.indexOf(`<span>${label}</span>`);
    assert.ok(index > previous, `${label} must keep the full briefing order`);
    previous = index;
    assert.match(source, new RegExp(label));
  }
  assert.match(css, /\.home-briefing-item\.is-overdue/);
  assert.match(css, /\.home-briefing-item\.is-today/);
  assert.match(css, /\.home-briefing-item\.is-upcoming/);
  assert.match(css, /\.home-briefing-item\.is-undated/);
});

test("full briefing uses one due-date axis while status and follow-up stay as task badges", () => {
  const source = read("public/briefing-v2.js");
  const css = read("public/briefing.css");
  assert.match(source, /지난 것/);
  assert.match(source, /오늘 할 일/);
  assert.match(source, /다가오는 업무/);
  assert.match(source, /기한 없는 업무/);
  assert.match(source, /briefing-tag is-waiting/);
  assert.match(source, /briefing-tag is-review/);
  assert.match(source, /briefing-tag is-followup/);
  assert.match(source, /root\.dataset\.followUpCount/);
  assert.doesNotMatch(source, /기다리는 것/);
  assert.doesNotMatch(source, /sectionHtml\("followUp"/);
  assert.match(css, /\.briefing-tag\.is-waiting/);
  assert.match(css, /\.briefing-tag\.is-review/);
  assert.match(css, /\.briefing-tag\.is-followup/);
});

test("full briefing stays available behind the compact summary", () => {
  const html = read("public/index.html");
  const source = read("public/home-ux.js");
  assert.match(html, /id="briefingCard"[^>]*hidden/);
  assert.match(html, /id="homeBriefingOpen"[^>]*aria-controls="briefingCard"/);
  assert.match(source, /briefingCard\.hidden = !open/);
  assert.match(source, /open \? "간단히 보기" : "전체 보기"/);
});

test("Home UX assets and product records are wired into the app", () => {
  const html = read("public/index.html");
  const sw = read("public/sw.js");
  const changelog = read("CHANGELOG.md");
  const decisions = read("docs/PRODUCT_DECISIONS.md");

  assert.match(html, /\/home-ux\.css\?v=20260916-2/);
  assert.match(html, /\/home-ux\.js\?v=20260916-3/);
  assert.match(html, /\/briefing\.css\?v=20260916-3/);
  assert.match(html, /\/briefing-v2\.js\?v=20260916-4/);
  assert.ok(sw.includes('"/home-ux.css"'));
  assert.ok(sw.includes('"/home-ux.js"'));
  assert.match(changelog, /오늘의 브리핑/);
  assert.match(changelog, /음성 기록 버튼/);
  assert.match(decisions, /Thumb-first Voice Capture/);
  assert.match(decisions, /오늘 상황 확인 → 음성 기록 → 업무화/);
});