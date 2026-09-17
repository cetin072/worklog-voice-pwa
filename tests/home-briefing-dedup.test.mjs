import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("compact briefing keeps urgent buckets visible and leaves undated work to detail", () => {
  const html = read("public/index.html");
  const css = read("public/home-ux.css");
  const source = read("public/briefing-v2.js");

  assert.match(html, /id="homeBriefingOverdueCount"/);
  assert.match(html, /id="homeBriefingTodayCount"/);
  assert.match(html, /id="homeBriefingUpcomingCount"/);
  assert.match(html, /id="homeBriefingUndatedCount"/);

  assert.match(css, /\.home-briefing-item\.is-undated\{display:none/);
  assert.match(css, /\.home-briefing-item\.is-upcoming\{grid-column:1\/-1/);
  assert.match(css, /@media\(min-width:560px\)\{\.home-briefing-grid\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)\}/);

  assert.match(source, /sectionHtml\("undated","⚪ 기한 없는 업무"/);
});

test("expanded briefing starts with detail instead of repeating the four-count summary", () => {
  const css = read("public/home-ux.css");
  const source = read("public/briefing-v2.js");

  assert.match(source, /class="briefing-v2-summary"/);
  assert.match(css, /\.briefing-card \.briefing-v2-summary\{display:none\}/);
  assert.match(source, /sectionHtml\("overdue","🔴 지난 것"/);
  assert.match(source, /sectionHtml\("today","🟠 오늘 할 일"/);
  assert.match(source, /sectionHtml\("upcoming","🔵 다가오는 업무"/);
  assert.match(source, /sectionHtml\("undated","⚪ 기한 없는 업무"/);
});