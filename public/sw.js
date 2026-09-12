const CACHE="worklog-v28";
const FILES=["/","/index.html","/setup.html","/styles.css","/scanner.css","/briefing.css","/briefing-edit.css","/auth.js","/request-id.js","/app.js","/inference-guard.js","/scanner.js","/scanner-save-bridge.js","/quick-save.js","/manual-input.js","/briefing.js","/briefing-v2.js","/briefing-v2-expand-state.js","/briefing-edit.js","/kakao.js","/setup.js","/manifest.webmanifest","/icons/icon-192-v3.png","/icons/icon-512-v3.png","/icons/icon-maskable-512-v3.png"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});
