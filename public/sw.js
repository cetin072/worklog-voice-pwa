const CACHE="worklog-v42-retired-web-push";
const FILES=["/","/index.html","/settings.html","/patch-notes.html","/setup.html","/styles.css","/distribution.css","/settings.css","/patch-notes.css","/briefing.css","/briefing-edit.css","/home-ux.css","/auth.js","/platform-auth.js","/platform-auth-ui.js","/onboarding.js","/settings.js","/main-ui-state.js","/request-id.js","/app.js","/inference-guard.js","/quick-save.js","/manual-input.js","/briefing-legacy-loader.js","/briefing.js","/briefing-v2.js","/briefing-v2-expand-state.js","/briefing-edit.js","/home-ux.js","/setup.js","/manifest.webmanifest","/icons/icon-192-v6.png","/icons/icon-512-v6.png"];
const STATIC_PATHS=new Set(FILES.filter(path=>!path.endsWith(".html") && path!=="/"));

function isStaticRequest(request,url){
  if(url.origin!==self.location.origin) return false;
  if(STATIC_PATHS.has(url.pathname)) return true;
  return ["script","style","image","font"].includes(request.destination);
}

async function cacheResponse(cache,key,response){
  if(response?.ok) await cache.put(key,response.clone());
  return response;
}

async function navigationResponse(request){
  try{
    return await fetch(request);
  }catch{
    return await caches.match(request) || await caches.match("/index.html") || await caches.match("/");
  }
}

async function staticResponse(event,url){
  const request=event.request;
  const cache=await caches.open(CACHE);
  const exact=await cache.match(request);
  if(exact){
    event.waitUntil(fetch(request).then(response=>cacheResponse(cache,request,response)).catch(()=>undefined));
    return exact;
  }

  if(url.search){
    try{
      return await cacheResponse(cache,request,await fetch(request));
    }catch{
      return await cache.match(url.pathname);
    }
  }

  const cached=await cache.match(url.pathname);
  const refresh=fetch(request).then(response=>cacheResponse(cache,url.pathname,response));
  if(cached){
    event.waitUntil(refresh.catch(()=>undefined));
    return cached;
  }
  return refresh;
}

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))));
  self.clients.claim();
});
self.addEventListener("fetch",event=>{
  const request=event.request;
  if(request.method!=="GET") return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;

  if(url.pathname.startsWith("/api/")){
    event.respondWith(fetch(request));
    return;
  }
  if(request.mode==="navigate" || request.destination==="document"){
    event.respondWith(navigationResponse(request));
    return;
  }
  if(isStaticRequest(request,url)){
    event.respondWith(staticResponse(event,url));
    return;
  }
  event.respondWith(fetch(request).catch(()=>caches.match(request)));
});
