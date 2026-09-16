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
    "homeBriefingTodayCount",
    "homeBriefingOverdueCount",
    "homeBriefingFollowUpCount",
    "homeBriefingNextSchedule",
    "homeBriefingOpen",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
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

test("compact briefing reuses rendered Briefing V2 instead of adding another API", () => {
  const source = read("public/home-ux.js");
  assert.match(source, /getElementById\("briefingV2"\)|\$\("briefingV2"\)/);
  assert.match(source, /\.is-overdue b/);
  assert.match(source, /\.is-followup b/);
  assert.match(source, /\.briefing-v2-schedules/);
  assert.doesNotMatch(source, /fetch\s*\(/);
  assert.doesNotMatch(source, /\/api\//);
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

  assert.match(html, /\/home-ux\.css\?v=20260916-1/);
  assert.match(html, /\/home-ux\.js\?v=20260916-1/);
  assert.ok(sw.includes('"/home-ux.css"'));
  assert.ok(sw.includes('"/home-ux.js"'));
  assert.match(changelog, /오늘의 브리핑/);
  assert.match(changelog, /음성 기록 버튼/);
  assert.match(decisions, /Thumb-first Voice Capture/);
  assert.match(decisions, /오늘 상황 확인 → 음성 기록 → 업무화/);
});