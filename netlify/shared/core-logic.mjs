export function isValidClientRequestId(value){
  return /^[A-Za-z0-9-]{16,100}$/.test(String(value || ""));
}

export function idempotencyHit(existing, fallbackMode){
  if(!existing?.pageId) return null;
  return {
    pageId:String(existing.pageId),
    url:String(existing.url || ""),
    mode:existing.mode || fallbackMode,
    deduped:true
  };
}

export function seoulDateFromRecordedAt(input, now=new Date()){
  let date=input ? new Date(input) : now;
  if(Number.isNaN(date.getTime())) date=now;
  const parts=new Intl.DateTimeFormat("en-CA",{
    timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
  }).formatToParts(date);
  const get=(type)=>parts.find(part=>part.type===type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function pageBelongsToDataSource(parentId, expectedDataSourceId){
  if(!expectedDataSourceId || !parentId) return true;
  const normalize=value=>String(value || "").replace(/-/g,"").toLowerCase();
  return normalize(parentId)===normalize(expectedDataSourceId);
}

export function briefingSnapshotFilter(project,title){
  return {
    and:[
      {property:"프로젝트",rich_text:{equals:String(project || "")}},
      {property:"업무명",title:{equals:String(title || "")}}
    ]
  };
}

export function parseBriefingSnapshot(rawText){
  try{
    const parsed=JSON.parse(rawText);
    if(parsed && typeof parsed==="object" && !Array.isArray(parsed)) return parsed;
  }catch{}
  if(!String(rawText || "").startsWith("BRIEFING_V1")) return null;

  const parsed={generatedAt:"",period:"",meta:"",top:[],today:[],upcoming:[],checking:[]};
  for(const rawLine of String(rawText).split(/\r?\n/).slice(1)){
    const line=rawLine.trim();
    if(!line) continue;
    if(line.startsWith("generatedAt=")) parsed.generatedAt=line.slice("generatedAt=".length).trim();
    else if(line.startsWith("period=")) parsed.period=line.slice("period=".length).trim();
    else if(line.startsWith("meta=")) parsed.meta=line.slice("meta=".length).trim();
    else if(line.startsWith("TOP|")){
      const [,title="",note="",institution="",pageId=""]=line.split("|");
      if(title.trim()) parsed.top.push({title:title.trim(),note:note.trim(),institution:institution.trim(),pageId:pageId.trim()});
    }else if(line.startsWith("TODAY|")){
      const [,title="",when=""]=line.split("|");
      if(title.trim()) parsed.today.push({title:title.trim(),when:when.trim()});
    }else if(line.startsWith("UPCOMING|")){
      const [,title="",when=""]=line.split("|");
      if(title.trim()) parsed.upcoming.push({title:title.trim(),when:when.trim()});
    }else if(line.startsWith("CHECK|")){
      const text=line.slice("CHECK|".length).trim();
      if(text) parsed.checking.push(text);
    }
  }
  return parsed;
}

export function sanitizeBriefingSnapshot(raw){
  const safeTop=value=>Array.isArray(value) ? value.slice(0,10) : [];
  const safeArray=value=>Array.isArray(value) ? value.slice(0,5) : [];
  return {
    generatedAt:String(raw?.generatedAt || ""), period:String(raw?.period || ""), meta:String(raw?.meta || ""),
    top:safeTop(raw?.top).map(item=>({title:String(item?.title || ""),note:String(item?.note || ""),institution:String(item?.institution || ""),pageId:String(item?.pageId || "")})).filter(item=>item.title),
    today:safeArray(raw?.today).map(item=>({title:String(item?.title || ""),when:String(item?.when || "")})).filter(item=>item.title),
    upcoming:safeArray(raw?.upcoming).map(item=>({title:String(item?.title || ""),when:String(item?.when || "")})).filter(item=>item.title),
    checking:safeArray(raw?.checking).map(item=>String(item || "")).filter(Boolean)
  };
}

export function quickTaskRank(task,today,dayDiff){
  if(task.dueKey){
    const diff=dayDiff(today,task.dueKey);
    if(diff<0) return 0;
    if(diff===0) return 1;
    if(diff<=3) return 2;
    if(diff<=7) return 3;
    return 4;
  }
  if(task.status==="확인필요") return 5;
  if(task.status==="진행중") return 6;
  if(task.status==="대기") return 7;
  return 8;
}

export function preservedQuickBriefingPeriod(snapshot, today, scheduledPeriods){
  if(snapshot?.generatedDate===today && scheduledPeriods.has(String(snapshot?.period || ""))) return snapshot.period;
  return "빠른 업데이트";
}

export async function enrichBriefingStatuses(items, getStatus, validPageId){
  const output=new Array(items.length);
  let cursor=0;
  const worker=async()=>{
    while(true){
      const index=cursor++;
      if(index>=items.length) return;
      const item=items[index];
      if(!item.pageId || !validPageId(item.pageId)){
        output[index]={...item,status:"",statusError:true};
        continue;
      }
      try{ output[index]={...item,status:await getStatus(item.pageId),statusError:false}; }
      catch{ output[index]={...item,status:"",statusError:true}; }
    }
  };
  await Promise.all(Array.from({length:Math.min(3,Math.max(1,items.length))},worker));
  return output;
}

function inline(value){
  return String(value || "").replace(/\s+/g," ").trim();
}

function splitLongLine(value,max=145){
  const text=String(value || "").trim();
  if(!text) return [""];
  const parts=[];
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

function packLines(lines,maxBody=145){
  const expanded=lines.flatMap(line=>splitLongLine(line,maxBody));
  const chunks=[];
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

export function buildKakaoBriefingMessages(briefing){
  const period=(inline(briefing.period) || "오늘").slice(0,20);
  const dateKey=value=>{
    const date=new Date(value);
    if(Number.isNaN(date.getTime())) return "";
    const parts=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(date);
    const get=type=>parts.find(part=>part.type===type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  };
  const generatedDate=dateKey(briefing.generatedAt || "");
  const todayDate=dateKey(new Date());
  const dateLabel=/^\d{4}-(\d{2})-(\d{2})$/.test(generatedDate) ? `${Number(generatedDate.slice(5,7))}/${Number(generatedDate.slice(8,10))}` : "";
  const lines=[];

  if(generatedDate && generatedDate!==todayDate) lines.push(`⚠ ${dateLabel || generatedDate}에 생성된 브리핑입니다.`,"");
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

export function isFreshBriefingAt(value, now=Date.now(), maxMinutes=90){
  const timestamp=Date.parse(value || "");
  return Number.isFinite(timestamp) && now-timestamp>=-5*60*1000 && now-timestamp<=maxMinutes*60*1000;
}

export function kakaoDeliveryDecision({expectedPeriod,period,requireFresh,generatedAt,now=Date.now(),alreadyDelivered}){
  if(expectedPeriod && period!==expectedPeriod) return "period-mismatch";
  if(requireFresh && !isFreshBriefingAt(generatedAt,now)) return "stale";
  if(alreadyDelivered) return "duplicate";
  return "send";
}

export function kakaoRunRecord(status, reason, briefing={}, messageCount=0, now=new Date()){
  return {
    attemptedAt:now.toISOString(), status, reason,
    period:String(briefing?.period || ""),
    generatedAt:String(briefing?.generatedAt || ""),
    messageCount
  };
}

export function isKakaoManualCooldown(lastAttemptAt, now=Date.now(), cooldownMs=30*1000){
  return Boolean(lastAttemptAt && now-Number(lastAttemptAt)<cooldownMs);
}

export async function deliverRemainingMessages(messages,nextIndex,send,onProgress=async()=>{}){
  for(let index=nextIndex;index<messages.length;index++){
    await send(messages[index]);
    await onProgress(index+1);
  }
  return messages.length;
}
