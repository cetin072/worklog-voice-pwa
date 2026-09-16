import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMorningPushPayload } from "../netlify/shared/morning-push-content.mjs";

const indexHtml = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");

test("morning push opens the actual briefing card", () => {
  assert.match(indexHtml, /id="briefingCard"/);
  assert.equal(buildMorningPushPayload({ todayCount: 1 })?.url, "/#briefingCard");
});
