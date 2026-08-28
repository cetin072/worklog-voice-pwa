import { getDeployStore, getStore } from "@netlify/blobs";

type KakaoTokenRecord = {
  accessToken:string;
  refreshToken:string;
  expiresAt:number;
  refreshTokenExpiresAt:number;
  scope:string;
  autoSend:boolean;
  linkedAt:string;
};

type BriefingPayload = {
  generatedAt?:string;
  period?:string;
  meta?:string;
  top?:Array<{title?:string;note?:string;institution?:string}>;
  today?:Array<{title?:string;when?:string}>;
  upcoming?:Array<{title?:string;when?:string}>;
  checking?:string[];
};

function isProduction(){
  return Netlify.env.get("CONTEXT") === "production";
}

function kakaoStore(){
  if(isProduction()) return getStore("worklog-kakao",{consistency:"strong"});
  return getDeployStore("worklog-kakao");
}

function kakaoConfig(){
  const siteUrl=(Netlify.env.get("URL") || "https://worklog-voice-pwa.netlify.app").replace(/\/$/,"");
  return {
    restApiKey:(Netlify.env.get("KAKAO_REST_API_KEY") || "").trim(),
    clientSecret:(Netlify.env.get("KAKAO_CLIENT_SECRET") || "").trim(),
    siteUrl,
    redirectUri:(Netlify.env.get("KAKAO_REDIRECT_URI") || `${siteUrl}/api/kakao/callback`).trim()
  };
}

function formBody(values:Record<string,string>){
  const body=new URLSearchParams();
  Object.entries(values).forEach(([key,value])=>{ if(value) body.set(key,value); });
  return body;
}

function compact(value:unknown,max=34){
  const text=String(value || "").replace(/\s+/g," ").trim();
  return text.length>max ? `${text.slice(0,Math.max(1,max-1))}…` : text;
}

function seoulDate(input:Date|string|number=new Date()){
  const date=input instanceof Date ? input : new Date(input);
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get=(type:string)=>parts.find(part=>part.type===type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function isFreshBriefing(value:string,maxMinutes=90){
  const timestamp=Date.parse(value || "");
  if(!Number.isFinite(timestamp)) return false;
  const age=Date.now()-timestamp;
  return age>=-5*60*1000 && age<=maxMinutes*60*1000;
}

function buildBriefingText(briefing:BriefingPayload){
  const period=compact(briefing.period || "오늘",20);
  const lines=[`[${period} 브리핑]`];
  const top=Array.isArray(briefing.top) ? briefing.top.slice(0,5) : [];
  if(top.length){
    top.forEach((item,index)=>lines.push(`${index+1}. ${compact(item?.title,31)}`));
  }else{
    lines.push("우선 업무 없음");
  }

  const today=Array.isArray(briefing.today) ? briefing.today.slice(0,2) : [];
  if(today.length){
    const schedule=today.map(item=>{
      const when=compact(item?.when,9);
      const title=compact(item?.title,20);
      return [when,title].filter(Boolean).join(" ");
    }).join(" / ");
    lines.push(`일정: ${schedule}`);
  }

  const checking=Array.isArray(briefing.checking) ? briefing.checking.filter(Boolean) : [];
  if(checking.length) lines.push(`확인: ${compact(checking[0],28)}`);

  const joined=lines.join("\n");
  return joined.length<=195 ? joined : `${joined.slice(0,194)}…`;
}

async function readToken(){
  return await kakaoStore().get("owner-token",{type:"json"}) as KakaoTokenRecord | null;
}

async function saveToken(token:KakaoTokenRecord){
  await kakaoStore().setJSON("owner-token",token);
}

async function refreshToken(token:KakaoTokenRecord){
  const config=kakaoConfig();
  if(!config.restApiKey || !token.refreshToken) throw new Error("KAKAO_NOT_LINKED");
  const res=await fetch("https://kauth.kakao.com/oauth/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded;charset=utf-8"},
    body:formBody({
      grant_type:"refresh_token",
      client_id:config.restApiKey,
      refresh_token:token.refreshToken,
      client_secret:config.clientSecret
    })
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok || !data?.access_token) throw new Error("KAKAO_REFRESH_FAILED");

  const next:KakaoTokenRecord={
    ...token,
    accessToken:String(data.access_token),
    expiresAt:Date.now()+Number(data.expires_in || 0)*1000,
    refreshToken:data.refresh_token ? String(data.refresh_token) : token.refreshToken,
    refreshTokenExpiresAt:data.refresh_token_expires_in
      ? Date.now()+Number(data.refresh_token_expires_in)*1000
      : token.refreshTokenExpiresAt,
    scope:String(data.scope || token.scope || "")
  };
  await saveToken(next);
  return next;
}

async function ensureAccessToken(){
  const token=await readToken();
  if(!token?.accessToken || !token?.refreshToken) throw new Error("KAKAO_NOT_LINKED");
  if(token.expiresAt>Date.now()+2*60*1000) return token;
  return refreshToken(token);
}

async function sendMemo(text:string,retry=true){
  const config=kakaoConfig();
  let token=await ensureAccessToken();
  const template={
    object_type:"text",
    text:compact(text,200),
    link:{web_url:config.siteUrl,mobile_web_url:config.siteUrl},
    button_title:"업무기록 열기"
  };
  const request=async(accessToken:string)=>fetch("https://kapi.kakao.com/v2/api/talk/memo/default/send",{
    method:"POST",
    headers:{
      "Authorization":`Bearer ${accessToken}`,
      "content-type":"application/x-www-form-urlencoded;charset=utf-8"
    },
    body:formBody({template_object:JSON.stringify(template)})
  });

  let res=await request(token.accessToken);
  if(res.status===401 && retry){
    token=await refreshToken(token);
    res=await request(token.accessToken);
  }
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok || Number(data?.result_code ?? -1)!==0) throw new Error("KAKAO_SEND_FAILED");
  return data;
}

async function fetchCurrentBriefing(){
  const config=kakaoConfig();
  const accessKey=(Netlify.env.get("APP_ACCESS_KEY") || "").trim();
  if(!accessKey) throw new Error("APP_ACCESS_KEY_MISSING");
  const res=await fetch(`${config.siteUrl}/api/briefing`,{
    method:"GET",
    headers:{"x-worklog-key":accessKey},
    cache:"no-store"
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok || !data?.ready || !data?.briefing) throw new Error("BRIEFING_NOT_READY");
  return data.briefing as BriefingPayload;
}

export async function getKakaoStatus(){
  const config=kakaoConfig();
  const token=await readToken();
  return {
    production:isProduction(),
    configured:Boolean(config.restApiKey),
    linked:Boolean(token?.refreshToken),
    autoSend:Boolean(token?.refreshToken && token?.autoSend),
    redirectUri:config.redirectUri
  };
}

export async function beginKakaoAuthorization(){
  if(!isProduction()) throw new Error("KAKAO_PRODUCTION_ONLY");
  const config=kakaoConfig();
  if(!config.restApiKey) throw new Error("KAKAO_NOT_CONFIGURED");
  const state=crypto.randomUUID();
  await kakaoStore().setJSON("oauth-state",{state,createdAt:Date.now()});
  const url=new URL("https://kauth.kakao.com/oauth/authorize");
  url.searchParams.set("client_id",config.restApiKey);
  url.searchParams.set("redirect_uri",config.redirectUri);
  url.searchParams.set("response_type","code");
  url.searchParams.set("scope","talk_message");
  url.searchParams.set("state",state);
  return url.toString();
}

export async function finishKakaoAuthorization(code:string,state:string){
  if(!isProduction()) throw new Error("KAKAO_PRODUCTION_ONLY");
  const config=kakaoConfig();
  if(!config.restApiKey) throw new Error("KAKAO_NOT_CONFIGURED");
  const saved:any=await kakaoStore().get("oauth-state",{type:"json"});
  const valid=saved?.state && saved.state===state && Date.now()-Number(saved.createdAt || 0)<10*60*1000;
  if(!valid) throw new Error("KAKAO_STATE_INVALID");

  const res=await fetch("https://kauth.kakao.com/oauth/token",{
    method:"POST",
    headers:{"content-type":"application/x-www-form-urlencoded;charset=utf-8"},
    body:formBody({
      grant_type:"authorization_code",
      client_id:config.restApiKey,
      redirect_uri:config.redirectUri,
      code,
      client_secret:config.clientSecret
    })
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok || !data?.access_token || !data?.refresh_token) throw new Error("KAKAO_TOKEN_FAILED");

  const token:KakaoTokenRecord={
    accessToken:String(data.access_token),
    refreshToken:String(data.refresh_token),
    expiresAt:Date.now()+Number(data.expires_in || 0)*1000,
    refreshTokenExpiresAt:Date.now()+Number(data.refresh_token_expires_in || 0)*1000,
    scope:String(data.scope || ""),
    autoSend:true,
    linkedAt:new Date().toISOString()
  };
  await saveToken(token);
  await kakaoStore().delete("oauth-state");
  return token;
}

export async function disconnectKakao(){
  await kakaoStore().delete("owner-token");
}

export async function sendCurrentBriefing(options:{expectedPeriod?:string;slot?:string;requireFresh?:boolean;automatic?:boolean}={}){
  const token=await readToken();
  if(!token?.refreshToken) return {sent:false,reason:"not-linked"};
  if(options.automatic && !token.autoSend) return {sent:false,reason:"auto-disabled"};

  const briefing=await fetchCurrentBriefing();
  if(options.expectedPeriod && briefing.period!==options.expectedPeriod){
    return {sent:false,reason:"period-mismatch",period:briefing.period || ""};
  }
  if(options.requireFresh && !isFreshBriefing(String(briefing.generatedAt || ""))){
    return {sent:false,reason:"stale"};
  }

  const date=seoulDate(briefing.generatedAt || new Date());
  const dedupeKey=options.slot ? `sent:${date}:${options.slot}` : "";
  if(dedupeKey){
    const already=await kakaoStore().get(dedupeKey);
    if(already) return {sent:false,reason:"duplicate"};
  }

  const text=buildBriefingText(briefing);
  await sendMemo(text);
  if(dedupeKey) await kakaoStore().set(dedupeKey,new Date().toISOString());
  return {sent:true,period:briefing.period || "",generatedAt:briefing.generatedAt || ""};
}
