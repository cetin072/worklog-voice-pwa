import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("main app shell keeps settings page css off the critical path", () => {
  const main = fs.readFileSync("public/index.html", "utf8");
  const settings = fs.readFileSync("public/settings.html", "utf8");
  const distribution = fs.readFileSync("public/distribution.css", "utf8");

  assert.doesNotMatch(main, /href="\/settings\.css(?:\?[^\"]+)?"/);
  assert.match(main, /href="\/distribution\.css\?v=20260917-1"/);
  assert.match(settings, /href="\/settings\.css(?:\?[^\"]+)?"/);
  assert.match(distribution, /\.settings-open\{/);
  assert.match(distribution, /\.settings-open:active\{/);
});
