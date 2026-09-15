const CACHE="worklog-v36";
const FILES=["/","/index.html","/settings.html","/setup.html","/styles.css","/distribution.css","/settings.css","/briefing.css","/briefing-edit.css","/auth.js","/platform-auth.js","/platform-auth-ui.js","/onboarding.js","/notifications.js","/settings.js","/push-settings.js","/request-id.js","/app.js","/inference-guard.js","/quick-save.js","/manual-input.js","/briefing-legacy-loader.js","/briefing.js","/briefing-v2.js","/briefing-v2-expand-state.js","/briefing-edit.js","/setup.js","/manifest.webmanifest","/icons/icon-192-v3.png","/icons/icon-512-v3.png","/icons/icon-maskable-512-v3.png"];

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

self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)));self.skipWaiting()});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim()});
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)))});

self.addEventListener("push",event=>{
  const payload=readPushPayload(event);
  const title=String(payload.title || "업무수첩");
  const targetUrl=normalizeTargetUrl(payload.url || "/");
  const options={
    body:String(payload.body || "확인할 업무가 있습니다."),
    icon:"/icons/icon-192-v3.png",
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
