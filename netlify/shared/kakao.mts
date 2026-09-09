import { getStore } from "@netlify/blobs";

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

type KakaoRunRecord = {
  slot:string;
  attemptedAt:string;
  status:"sent"|"skipped"|"failed";
  reason:string;
  period:string;
  generatedAt:string;
  messageCount:number;
};

type DeliveryRecord = {
  state:"sending"|"done";
  runId:string;
  generatedAt:string;
  period:string;
  messages:string[];
  nextIndex:number;
  updatedAt:string;
};

type SendOptions = {
  expectedPeriod?:string;
  slot?:string;
  requireFresh?:boolean;
  automatic?:boolean;
  manual?:boolean;
};

function kakaoStore(){
  return getStore("worklog-kakao",{consistency:"strong"});
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

function inline(value:unknown){
  return String(value || "").replace(/\s+/g," ").trim();
}

function splitLongLine(value:string,max=145){
  const text=value.trim();
  if(!text) return [""];
  const parts:string[]=[];
  let remaining=text;
  while(remaining.length>max){
    let cut=remaining.lastIndexOf(" ",max);
    if(cut<Math.floor(max*0.6)) cut=max;
    parts.push(remaining.slice(0,cut).trim());
    remaining=remaining.slice(cut).trim();
  }
  if(remaining) parts.push(remaining);
  return parts;
}

function packLines(lines:string[],maxBody=145){
  const expanded=lines.flatMap(line=>splitLongLine(line,maxBody));
  const chunks:string[]=[];
  let current="";
  for(const line of expanded){
    const candidate=current ? `${current}\n${line}` : line;
    if(candidate.length<=maxBody){
      current=candidate;
      continue;
    }
    if(current.trim()) chunks.push(current.trimEnd());
    current=line;
  }
  if(current.trim()) chunks.push(current.trimEnd());
  return chunks;
}

function seoulDate(input:Date|string|number=new Date()){
  const date=input instanceof Date ? input : new Date(input);
  if(Number.isNaN(date.getTime())) return "";
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get=(type:string)=>parts.find(part=>part.type===type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function mmdd(dateKey:string){
  const match=/^\d{4}-(\d{2})-(\d{2})$/.exec(dateKey);
  return match ? `${Number(match[1])}/${Number(match[2])}` : "";
}

function buildBriefingMessages(briefing:BriefingPayload){
  const period=(inline(briefing.period) || "오늘").slice(0,20);
  const generatedDate=seoulDate(String(briefing.generatedAt || ""));
  const todayDate=seoulDate();
  const stale=Boolean(generatedDate && generatedDate!==todayDate);
  const dateLabel=mmdd(generatedDate);
  const lines:string[]=[];

  if(stale) lines.push(`⚠ ${dateLabel || generatedDate}에 생성된 브리핑입니다.`,"");
  lines.push("📌 우선 업무");

  const top=Array.isArray(briefing.top) ? briefing.top.filter(Boolean) : [];
  if(top.length){
    top.forEach((item,index)=>{
      const institution=inline(item?.institution);
      const prefix=institution && institution!=="기타" ? `[${institution}] ` : "";
      lines.push(`${index+1}. ${prefix}${inline(item?.title) || "제목 없음"}`);
      const note=inline(item?.note);
      if(note) lines.push(`↳ ${note}`);
    });
  }else{
    lines.push("- 없음");
  }

  const today=Array.isArray(briefing.today) ? briefing.today.filter(Boolean) : [];
  if(today.length){
    lines.push("","📅 오늘 일정");
    today.forEach(item=>{
      const label=[inline(item?.when),inline(item?.title)].filter(Boolean).join(" ");
      if(label) lines.push(`- ${label}`);
    });
  }

  const upcoming=Array.isArray(briefing.upcoming) ? briefing.upcoming.filter(Boolean) : [];
  if(upcoming.length){
    lines.push("","🗓 다가오는 일정");
    upcoming.forEach(item=>{
      const label=[inline(item?.when),inline(item?.title)].filter(Boolean).join(" ");
      if(label) lines.push(`- ${label}`);
    });
  }

  const checking=Array.isArray(briefing.checking) ? briefing.checking.filter(Boolean) : [];
  if(checking.length){
    lines.push("","🔎 확인 필요");
    checking.forEach(item=>{
      const text=inline(item);
      if(text) lines.push(`- ${text}`);
    });
  }

  const bodies=packLines(lines,145);
  const total=Math.max(1,bodies.length);
  return (bodies.length ? bodies : ["📌 우선 업무\n- 없음"]).map((body,index)=>{
    const datedPeriod=[dateLabel,period].filter(Boolean).join(" ");
    const header=`📋 ${datedPeriod} 브리핑${total>1 ? ` (${index+1}/${total})` : ""}`;
    return `${header}\n${body}`.trim();
  });
}

function isFreshBriefing(value:string,maxMinutes=90){
  const timestamp=Date.parse(value || "");
  if(!Number.isFinite(timestamp)) return false;
  const age=Date.now()-timestamp;
  return age>=-5*60*1000 && age<=maxMinutes*60*1000;
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
  const message=String(text || "").replace(/\r\n/g,"\n").trim();
  if(!message || message.length>200) throw new Error("KAKAO_SEND_FAILED");
  let token=await ensureAccessToken();
  const template={
    object_type:"text",
    text:message,
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
  const res=await fetch(`${config.siteUrl}/api/briefing?statuses=0`,{
    method:"GET",
    headers:{"x-worklog-key":accessKey},
    cache:"no-store"
  });
  const data:any=await res.json().catch(()=>({}));
  if(!res.ok || !data?.ready || !data?.briefing) throw new Error("BRIEFING_NOT_READY");
  return data.briefing as BriefingPayload;
}

async function readRun(slot:string){
  if(!slot) return null;
  return await kakaoStore().get(`last-run:${slot}`,{type:"json"}) as KakaoRunRecord | null;
}

async function writeRun(slot:string,record:Omit<KakaoRunRecord,"slot">){
  if(!slot) return;
  await kakaoStore().setJSON(`last-run:${slot}`,{slot,...record});
}

async function recordResult(slot:string,status:KakaoRunRecord["status"],reason:string,briefing?:BriefingPayload,messageCount=0){
  await writeRun(slot,{
    attemptedAt:new Date().toISOString(),
    status,
    reason,
    period:String(briefing?.period || ""),
    generatedAt:String(briefing?.generatedAt || ""),
    messageCount
  });
}

export async function getKakaoStatus(production:boolean){
  const config=kakaoConfig();
  if(!production){
    return {
      production:false,
      configured:Boolean(config.restApiKey),
      linked:false,
      autoSend:false,
      redirectUri:config.redirectUri,
      lastRuns:{morning:null,afternoon:null,evening:null}
    };
  }

  const [token,morning,afternoon,evening]=await Promise.all([
    readToken(),readRun("morning"),readRun("afternoon"),readRun("evening")
  ]);
  return {
    production:true,
    configured:Boolean(config.restApiKey),
    linked:Boolean(token?.refreshToken),
    autoSend:Boolean(token?.refreshToken && token?.autoSend),
    redirectUri:config.redirectUri,
    lastRuns:{morning,afternoon,evening}
  };
}

export async function beginKakaoAuthorization(production:boolean){
  if(!production) throw new Error("KAKAO_PRODUCTION_ONLY");
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

export async function finishKakaoAuthorization(code:string,state:string,production:boolean){
  if(!production) throw new Error("KAKAO_PRODUCTION_ONLY");
  const config=kakaoConfig();
  if(!config.restApiKey) throw new Error("KAKAO_NOT_CONFIGURED");
  const saved:any=await kakaoStore().get("oauth-state",{type:"json"});
  const valid=saved?.state && saved.state===state && Date.now()-Number(saved.createdAt || 0)<10*60*1000;
  if(!valid) throw new Error("KAKAO_STATE_INVALID");

  try{
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
    return token;
  }finally{
    await kakaoStore().delete("oauth-state");
  }
}

export async function disconnectKakao(){
  await kakaoStore().delete("owner-token");
}

export async function sendCurrentBriefing(options:SendOptions={}){
  const slot=String(options.slot || "");
  let briefing:BriefingPayload | undefined;

  try{
    const token=await readToken();
    if(!token?.refreshToken){
      if(slot) await recordResult(slot,"skipped","not-linked");
      return {sent:false,reason:"not-linked"};
    }
    if(options.automatic && !token.autoSend){
      if(slot) await recordResult(slot,"skipped","auto-disabled");
      return {sent:false,reason:"auto-disabled"};
    }

    if(options.manual){
      const lastManual:any=await kakaoStore().get("manual:last",{type:"json"});
      if(lastManual?.at && Date.now()-Number(lastManual.at)<30*1000){
        return {sent:false,reason:"cooldown"};
      }
    }

    briefing=await fetchCurrentBriefing();
    if(options.expectedPeriod && briefing.period!==options.expectedPeriod){
      if(slot) await recordResult(slot,"skipped","period-mismatch",briefing);
      return {sent:false,reason:"period-mismatch",period:briefing.period || ""};
    }
    if(options.requireFresh && !isFreshBriefing(String(briefing.generatedAt || ""))){
      if(slot) await recordResult(slot,"skipped","stale",briefing);
      return {sent:false,reason:"stale"};
    }

    const date=seoulDate();
    const dedupeKey=slot ? `sent:${date}:${slot}` : "";
    let messages=buildBriefingMessages(briefing);
    let nextIndex=0;
    let delivery:DeliveryRecord | null=null;

    if(dedupeKey){
      delivery=await kakaoStore().get(dedupeKey,{type:"json"}) as DeliveryRecord | null;
      if(delivery?.state==="done") return {sent:false,reason:"duplicate"};

      if(delivery?.state==="sending" && Array.isArray(delivery.messages) && delivery.messages.length){
        messages=delivery.messages;
        nextIndex=Math.max(0,Math.min(Number(delivery.nextIndex || 0),messages.length));
      }else{
        delivery={
          state:"sending",
          runId:crypto.randomUUID(),
          generatedAt:String(briefing.generatedAt || ""),
          period:String(briefing.period || ""),
          messages,
          nextIndex:0,
          updatedAt:new Date().toISOString()
        };
        await kakaoStore().setJSON(dedupeKey,delivery);
      }
    }

    for(let index=nextIndex;index<messages.length;index++){
      await sendMemo(messages[index]);
      if(dedupeKey && delivery){
        delivery={...delivery,nextIndex:index+1,updatedAt:new Date().toISOString()};
        await kakaoStore().setJSON(dedupeKey,delivery);
      }
    }

    if(dedupeKey && delivery){
      delivery={...delivery,state:"done",nextIndex:messages.length,updatedAt:new Date().toISOString()};
      await kakaoStore().setJSON(dedupeKey,delivery);
    }
    if(options.manual) await kakaoStore().setJSON("manual:last",{at:Date.now(),generatedAt:String(briefing.generatedAt || "")});
    if(slot) await recordResult(slot,"sent","sent",briefing,messages.length);

    return {
      sent:true,
      period:briefing.period || "",
      generatedAt:briefing.generatedAt || "",
      messageCount:messages.length,
      resumedFrom:nextIndex
    };
  }catch(error){
    if(slot){
      try{
        await recordResult(slot,"failed",String((error as any)?.message || "unknown").slice(0,80),briefing);
      }catch{}
    }
    throw error;
  }
}
