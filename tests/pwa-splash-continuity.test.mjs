import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("installed PWA system splash uses the same white launch surface as the in-app brand splash", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  const html = read("public/index.html");
  const css = read("public/distribution.css");

  assert.equal(manifest.background_color, "#ffffff");
  assert.equal(manifest.theme_color, "#ffffff");
  assert.match(html, /<meta name="theme-color" content="#ffffff">/);
  assert.match(html, /<link rel="manifest" href="\/manifest\.webmanifest\?v=20260916-2">/);
  assert.match(css, /body\.platform-auth-loading \.welcome-card\{[^}]*background:#fff/);
});

test("splash continuity keeps the same application icon source", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  const css = read("public/distribution.css");
  const anyIcon = manifest.icons.find((icon) => icon.sizes === "192x192" && icon.purpose === "any");

  assert.equal(anyIcon?.src, "/icons/icon-192-v3.png");
  assert.match(css, /\/icons\/icon-192-v3\.png/);
});
