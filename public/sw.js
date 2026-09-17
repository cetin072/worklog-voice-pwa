const CACHE="worklog-v41-home-briefing-dedup";
const FILES=["/","/index.html","/settings.html","/patch-notes.html","/setup.html","/styles.css","/distribution.css","/settings.css","/patch-notes.css","/briefing.css","/briefing-edit.css","/home-ux.css","/auth.js","/platform-auth.js","/platform-auth-ui.js","/onboarding.js","/notifications.js","/settings.js","/main-ui-state.js","/push-settings.js","/morning-push-settings.js","/request-id.js","/app.js","/inference-guard.js","/quick-save.js","/manual-input.js","/briefing-legacy-loader.js","/briefing.js","/briefing-v2.js","/briefing-v2-expand-state.js","/briefing-edit.js","/home-ux.js","/setup.js","/manifest.webmanifest","/icons/icon-192-v6.png","/icons/icon-512-v6.png"];
const STATIC_PATHS=new Set(FILES.filter(path=>!path.endsWith(".html") && path!=="/"));

function normalizeTargetUrl(value){
  try{
    const url=new URL(value || "/",self.location.origin);
    if(url.origin!==self.location.origin) return "/";
    return `${url.pathname}${url.search}${url.hash}` || "/";
  }catch{
    return "/";
  }
}

function readPushPayload(event){
  if(!event.data) return {};
  try{
    return event.data.json() || {};
  }catch{
    try{
      return {body:event.data.text() || ""};
    }catch{
      return {};
    }
  }
}

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

self.addEventListener("push",event=>{
  const payload=readPushPayload(event);
  const title=String(payload.title || "업무수첩");
  const targetUrl=normalizeTargetUrl(payload.url || "/");
  const options={
    body:String(payload.body || "확인할 업무가 있습니다."),
    icon:"/icons/icon-192-v6.png",
    tag:String(payload.tag || "worklog-reminder"),
    data:{url:targetUrl},
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener("notificationclick",event=>{
  event.notification?.close();
  const targetUrl=normalizeTargetUrl(event.notification?.data?.url || "/");
  const absoluteUrl=new URL(targetUrl,self.location.origin).href;
  event.waitUntil((async()=>{
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    for(const client of windows){
      try{
        if(client.url!==absoluteUrl && "navigate" in client) await client.navigate(absoluteUrl);
      }catch{}
      if("focus" in client) return client.focus();
    }
    if(self.clients.openWindow) return self.clients.openWindow(targetUrl);
    return undefined;
  })());
});