import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../public/sw.js", import.meta.url), "utf8");

test("service worker separates API, navigation, and static asset strategies", () => {
  assert.match(source, /const CACHE="worklog-v38-pwa-splash-continuity"/);
  assert.match(source, /"\/morning-push-settings\.js"/);
  assert.match(source, /"\/home-ux\.css"/);
  assert.match(source, /"\/home-ux\.js"/);
  assert.match(source, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(source, /event\.respondWith\(fetch\(request\)\)/);
  assert.match(source, /request\.mode==="navigate" \|\| request\.destination==="document"/);
  assert.match(source, /event\.respondWith\(navigationResponse\(request\)\)/);
  assert.match(source, /event\.respondWith\(staticResponse\(event,url\)\)/);
});

test("static assets use stale-while-revalidate while versioned assets avoid stale base-first", () => {
  assert.match(source, /const exact=await cache\.match\(request\)/);
  assert.match(source, /event\.waitUntil\(fetch\(request\)\.then\(response=>cacheResponse\(cache,request,response\)\)/);
  assert.match(source, /if\(url\.search\)\{[\s\S]*return await cacheResponse\(cache,request,await fetch\(request\)\)/);
  assert.match(source, /const cached=await cache\.match\(url\.pathname\)/);
  assert.match(source, /event\.waitUntil\(refresh\.catch\(\(\)=>undefined\)\)/);
});

test("API responses are never written into the service worker cache", () => {
  const fetchHandler = source.slice(source.indexOf('self.addEventListener("fetch"'), source.indexOf('self.addEventListener("push"'));
  const apiStart = fetchHandler.indexOf('url.pathname.startsWith("/api/")');
  const apiEnd = fetchHandler.indexOf('if(request.mode===', apiStart);
  const apiBranch = fetchHandler.slice(apiStart, apiEnd);
  assert.match(apiBranch, /event\.respondWith\(fetch\(request\)\)/);
  assert.doesNotMatch(apiBranch, /cacheResponse|cache\.put|caches\.match/);
});

test("navigation stays network-first with offline app shell fallback", () => {
  assert.match(source, /async function navigationResponse\(request\)\{[\s\S]*return await fetch\(request\);[\s\S]*caches\.match\("\/index\.html"\)[\s\S]*caches\.match\("\/"\)/);
  assert.doesNotMatch(source, /async function navigationResponse\(request\)\{\s*const cached/);
});
