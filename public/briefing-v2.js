(()=>{
  const $=(id)=>document.getElementById(id);
  const card=$("briefingCard");
  const legacyTitle=$("briefingTitle");
  const legacyMeta=$("briefingMeta");
  const legacyError=$("briefingError");
  let title=legacyTitle;
  let meta=legacyMeta;
  let error=legacyError;
  const legacyTop=$("briefingTop");
  const legacyMore=card?.querySelector?.(".briefing-more");
  const originalQuick=$("briefingQuickUpdate");
  if(!card || !title || !meta || !error || !legacyTop) return;

  const UNDO_KEY="worklogBriefingUndoStates";
  const MAX_VISIBLE=3;
  const IS_PREVIEW_DEMO=location.hostname.startsWith("deploy-preview-") && new URLSearchParams(location.search).get("briefingDemo")==="1";
  let loading=false;
  let lastLoadedAt=0;
  let renderedMode="";
  let authRetryPending=false;
  let pendingCompletions=0;
  let backgroundSyncTimer=0;
  const inlineUndoStates=new Map();

  const nextTitle=title.cloneNode(true);
  title.replaceWith(nextTitle);
  title=nextTitle;
  const nextMeta=meta.cloneNode(true);
  meta.replaceWith(nextMeta);
  meta=nextMeta;
  const nextError=error.cloneNode(true);
  error.replaceWith(nextError);
  error=nextError;

  let root=$("briefingV2");
  if(!root){
    root=document.createElement("div");
    root.id="briefingV2";
    root.className="briefing-v2";
    root.hidden=true;
    meta.insertAdjacentElement("afterend",root);
  }

  function syncLegacyHeader(){
    if(!root.hidden) return;
    title.textContent=legacyTitle.textContent;
    meta.textContent=legacyMeta.textContent;
    error.textContent=legacyError.textContent;
  }

  const legacyObserver=new MutationObserver(syncLegacyHeader);
  [legacyTitle,legacyMeta,legacyError].forEach(node=>{
    legacyObserver.observe(node,{childList:true,subtree:true,characterData:true});
  });

  let quick=originalQuick;
  if(originalQuick){
    quick=originalQuick.cloneNode(true);
    originalQuick.replaceWith(quick);
    quick.id="briefingQuickUpdate";
    quick.textContent="브리핑 다시 정리";
  }

  function authHeaders({ask=true}={}){
    const session=window.WorklogPlatformAuth?.readSession?.();
    const promptOwner=ask && !session?.access_token;
    const headers=window.WorklogAuth?.getHeaders
      ? window.WorklogAuth.getHeaders({promptOwner})
      : (()=>{
          let key=localStorage.getItem("worklogAccessKey") || "";
          if(!key && promptOwner){
            key=(window.prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
            if(key) localStorage.setItem("worklogAccessKey",key);
          }
          return key ? {"x-worklog-key":key} : {};
        })();
    if(session?.access_token) headers.authorization=`Bearer ${session.access_token}`;
    return headers;
  }

  function escapeHtml(value){
    return String(value ?? "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function institutionLabel(value){
    if(value==="미래여성가족진흥원") return "미래진흥원";
    return value || "미지정";
  }

  function mmdd(key){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(String(key || ""))) return "";
    const [,month,day]=key.split("-");
    return `${Number(month)}/${Number(day)}`;
  }

  function formatGeneratedAt(value){
    try{
      return new Intl.DateTimeFormat("ko-KR",{
        timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"
      }).format(new Date(value));
    }catch{ return ""; }
  }

  function loadUndoStates(){
    try{
      const raw=JSON.parse(localStorage.getItem(UNDO_KEY) || "{}");
      const cutoff=Date.now()-48*60*60*1000;
      const cleaned={};
      Object.entries(raw).forEach(([pageId,value])=>{
        if(value?.status && Number(value?.ts || 0)>=cutoff) cleaned[pageId]=value;
      });
      localStorage.setItem(UNDO_KEY,JSON.stringify(cleaned));
      return cleaned;
    }catch{ return {}; }
  }

  function saveUndoState(pageId,status,itemTitle){
    const states=loadUndoStates();
    states[pageId]={status,title:itemTitle,ts:Date.now()};
    localStorage.setItem(UNDO_KEY,JSON.stringify(states));
  }

  function removeUndoState(pageId){
    const states=loadUndoStates();
    delete states[pageId];
    localStorage.setItem(UNDO_KEY,JSON.stringify(states));
  }

  function hideLegacy(){
    legacyTop.hidden=true;
    legacyMore?.setAttribute("hidden","");
    const toggle=card.querySelector(".briefing-top-toggle");
    if(toggle) toggle.hidden=true;
  }

  function showLegacy(){
    legacyTop.hidden=false;
    legacyMore?.removeAttribute("hidden");
    root.hidden=true;
    if(quick) quick.hidden=false;
    syncLegacyHeader();
  }

  function setBusy(value){
    loading=value;
    card.classList.toggle("loading",value);
    if(quick){
      quick.disabled=value;
      quick.textContent=value ? "정리 중…" : "브리핑 다시 정리";
    }
  }

  function sectionNote(kind,item){
    const pieces=[];
    if(kind==="overdue"){
      if(item.dueKey) pieces.push(`${mmdd(item.dueKey)}까지`);
      if(item.daysOverdue) pieces.push(`${item.daysOverdue}일 지남`);
    }else if(kind==="today"){
      pieces.push("오늘 기한");
    }else if(kind==="upcoming" && item.dueKey){
      pieces.push(`기한 ${mmdd(item.dueKey)}`);
      if(item.daysUntil) pieces.push(`${item.daysUntil}일 후`);
    }else if(kind==="undated"){
      pieces.push("기한 없음");
    }
    return pieces.join(" · ");
  }

  function taskBadges(item){
    const badges=[];
    if(item.status==="대기") badges.push('<span class="briefing-tag is-waiting">대기</span>');
    if(item.status==="확인필요") badges.push('<span class="briefing-tag is-review">확인필요</span>');
    if(item.followUp) badges.push('<span class="briefing-tag is-followup">후속조치</span>');
    return badges.join("");
  }

  function taskHtml(kind,item,index,canUpdate){
    const institution=item.institution
      ? `<span class="briefing-tag">${escapeHtml(institutionLabel(item.institution))}</span>`
      : "";
    const badges=taskBadges(item);
    const note=sectionNote(kind,item);
    const follow=item.followUp
      ? `<small class="briefing-v2-follow">↳ ${escapeHtml(item.followUp)}</small>`
      : "";
    const hidden=index>=MAX_VISIBLE ? " hidden" : "";
    const action=!canUpdate
      ? `<small class="briefing-v2-read-only">Data Core</small>`
      : IS_PREVIEW_DEMO
      ? `<button class="briefing-complete briefing-v2-complete" type="button" disabled>완료</button>`
      : `<button class="briefing-complete briefing-v2-complete" type="button" data-page-id="${escapeHtml(item.pageId)}" data-status="${escapeHtml(item.status)}" data-title="${escapeHtml(item.title)}">완료</button>`;
    return `<li${hidden}><div><strong>${escapeHtml(item.title)}</strong><div class="briefing-sub">${institution}${badges}${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>${follow}</div>${action}</li>`;
  }

  function sectionHtml(kind,label,items,canUpdate){
    if(!Array.isArray(items) || !items.length) return "";
    const extra=Math.max(0,items.length-MAX_VISIBLE);
    return `<section class="briefing-v2-section briefing-v2-${kind}" data-section="${kind}"><div class="briefing-v2-section-head"><h3>${label} <span>${items.length}</span></h3></div><ul class="briefing-list briefing-v2-list">${items.map((item,index)=>taskHtml(kind,item,index,canUpdate)).join("")}</ul>${extra ? `<button class="briefing-v2-more-toggle" type="button" data-section-toggle="${kind}" aria-expanded="false">${extra}개 더 보기</button>` : ""}</section>`;
  }

  function scheduleWhen(item){
    const day=mmdd(item?.dateKey);
    if(!day) return "";
    if(item?.allDay) return `${day} 종일`;
    const startsAt=new Date(String(item?.startsAt || ""));
    if(Number.isNaN(startsAt.getTime())) return day;
    const parts=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit",hour12:false}).formatToParts(startsAt);
    const get=(type)=>parts.find(part=>part.type===type)?.value || "";
    return get("hour") && get("minute") ? `${day} ${Number(get("hour"))}:${get("minute")}` : day;
  }

  function scheduleHtml(item){
    const when=scheduleWhen(item);
    const detail=[item?.status,item?.location].filter(Boolean).join(" · ");
    return `<li><span class="briefing-date">${escapeHtml(when)}</span><div><strong>${escapeHtml(item?.title)}</strong>${detail ? `<div class="briefing-sub"><small>${escapeHtml(detail)}</small></div>` : ""}</div></li>`;
  }

  function scheduleSectionHtml(schedules,enabled){
    if(!enabled) return "";
    const today=Array.isArray(schedules?.today) ? schedules.today : [];
    const upcoming=Array.isArray(schedules?.upcoming) ? schedules.upcoming : [];
    const total=Number(schedules?.total || 0);
    const list=(items,empty)=>items.length ? items.map(scheduleHtml).join("") : `<li class="briefing-empty">${empty}</li>`;
    return `<section class="briefing-v2-section briefing-v2-schedules"><div class="briefing-v2-section-head"><h3>📅 일정 <span>${total}</span></h3></div><p class="label">오늘</p><ul class="briefing-list briefing-v2-list">${list(today,"오늘 확정 일정이 없습니다.")}</ul><p class="label">14일 이내</p><ul class="briefing-list briefing-v2-list">${list(upcoming,"다가오는 일정이 없습니다.")}</ul></section>`;
  }

  function render(data){
    const structure=data?.structure || {};
    const counts=data?.counts || {};
    const total=Number(counts.total || 0);
    const canUpdate=data?.canUpdate!==false;
    renderedMode=String(data?.mode || "");

    root.dataset.followUpCount=String(Number(counts.followUp || 0));
    root.innerHTML=`<div class="briefing-v2-summary" aria-label="업무 상황 요약"><span class="is-overdue">지난 것 <b>${Number(counts.overdue || 0)}</b></span><span class="is-today">오늘 할 일 <b>${Number(counts.today || 0)}</b></span><span class="is-upcoming">다가오는 업무 <b>${Number(counts.upcoming || 0)}</b></span><span class="is-undated">기한 없는 업무 <b>${Number(counts.undated || 0)}</b></span></div>${sectionHtml("overdue","🔴 지난 것",structure.overdue,canUpdate)}${sectionHtml("today","🟠 오늘 할 일",structure.today,canUpdate)}${sectionHtml("upcoming","🔵 다가오는 업무",structure.upcoming,canUpdate)}${sectionHtml("undated","⚪ 기한 없는 업무",structure.undated,canUpdate)}${scheduleSectionHtml(data?.schedules,data?.scheduleEnabled===true)}${total===0 ? `<p class="briefing-v2-clear">현재 미완료 업무가 없습니다.</p>` : ""}`;

    root.hidden=false;
    hideLegacy();
    title.textContent=IS_PREVIEW_DEMO ? "오늘 업무 상황 · 화면 미리보기" : "오늘 업무 상황";
    const generated=formatGeneratedAt(data.generatedAt);
    const countLabel=data.truncated ? `미완료 ${total}건 이상` : `미완료 ${total}건`;
    meta.textContent=IS_PREVIEW_DEMO ? "예시 업무로 보는 브리핑 2.0 화면" : [generated,countLabel,data?.mode==="data_core" ? "Data Core 기준" : "Notion 최신 기준"].filter(Boolean).join(" · ");
    if(quick) quick.hidden=!canUpdate || renderedMode==="data_core";
    if(data.truncated){
      error.textContent="업무가 많아 최근 500건 기준으로 정리했습니다.";
      card.classList.add("has-error");
    }else{
      error.textContent="";
      card.classList.remove("has-error");
    }
  }

  function previewDemoData(){
    const sample=(title,status,dueKey="",extra={})=>({pageId:`demo-${title}`,title,institution:"태장",status,dueKey,followUp:"",daysOverdue:0,daysUntil:0,...extra});
    return {
      generatedAt:new Date().toISOString(),
      counts:{overdue:4,today:3,upcoming:4,undated:5,waiting:3,followUp:4,other:0,total:16},
      structure:{
        overdue:[
          sample("견적서 금액 확인 후 대표 보고","진행중","2026-09-10",{daysOverdue:2,followUp:"대표 확인 후 거래처에 회신"}),
          sample("거래처 세금계산서 확인","확인필요","2026-09-11",{daysOverdue:1}),
          sample("지원사업 제출서류 보완","진행중","2026-09-11",{daysOverdue:1}),
          sample("계약서 수정사항 회신","대기","2026-09-11",{daysOverdue:1})
        ],
        today:[
          sample("삼현 행사 일정 최종 확인","진행중","2026-09-12"),
          sample("대표이사 보고자료 전달","진행중","2026-09-12",{followUp:"보고 후 수정사항 반영"}),
          sample("납품 수량 확정 연락","확인필요","2026-09-12")
        ],
        upcoming:[
          sample("업체 견적 회신 확인","대기","2026-09-13",{daysUntil:1}),
          sample("취재 일정 답변 확인","대기","2026-09-15",{daysUntil:3}),
          sample("다음 주 계약서 검토","진행중","2026-09-18",{daysUntil:6}),
          sample("월말 비용 정리","진행중","2026-09-30",{daysUntil:18})
        ],
        undated:[
          sample("어제 받은 계약서 검토","진행중","",{followUp:"수정할 조항 표시 후 상대방에게 회신"}),
          sample("통화 내용 담당자에게 전달","확인필요","",{followUp:"담당자 확인 후 결과 기록"}),
          sample("새 거래처 자료 정리","진행중"),
          sample("대표 요청사항 확인","진행중"),
          sample("검토 대기 문서 정리","대기")
        ],
        totalOpen:16
      }
    };
  }

  async function fetchV2({ask=true,retryAuth=true}={}){
    const headers=authHeaders({ask});
    if(!Object.keys(headers).length) throw new Error("Notion 연결 또는 개인 접근키가 필요합니다.");
    const res=await fetch("/api/briefing-v2",{method:"GET",headers,cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    const platformSession=window.WorklogPlatformAuth?.readSession?.();
    if(res.status===401 && retryAuth && platformSession?.access_token && window.WorklogPlatformAuth?.refreshSession){
      await window.WorklogPlatformAuth.refreshSession();
      return fetchV2({ask:false,retryAuth:false});
    }
    if(res.status===401 && !platformSession?.access_token && window.WorklogAuth?.mode?.()!=="personal"){
      localStorage.removeItem("worklogAccessKey");
    }
    if(!res.ok) throw new Error(data.error || "브리핑 2.0을 불러오지 못했습니다.");
    return data;
  }

  async function refreshV2({ask=true,silentFallback=false}={}){
    if(loading || IS_PREVIEW_DEMO) return;
    setBusy(true);
    try{
      const data=await fetchV2({ask});
      render(data);
      lastLoadedAt=Date.now();
    }catch(err){
      showLegacy();
      if(!silentFallback){
        error.textContent=`브리핑 2.0을 불러오지 못해 기존 브리핑을 표시합니다. ${err?.message || ""}`.trim();
        card.classList.add("has-error");
      }
    }finally{
      const retryAfterAuth=authRetryPending && lastLoadedAt===0;
      authRetryPending=false;
      setBusy(false);
      if(retryAfterAuth){
        window.setTimeout(()=>refreshV2({ask:false,silentFallback:true}),0);
      }
    }
  }

  async function updateTaskStatus(pageId,status){
    const headers=authHeaders({ask:true});
    if(!Object.keys(headers).length) throw new Error("Platform 로그인 또는 Notion 연결이 필요합니다.");
    const dataCore=renderedMode==="data_core";
    const res=await fetch(dataCore ? "/api/briefing-v2" : "/api/briefing",{
      method:"POST",
      headers:{...headers,"content-type":"application/json"},
      body:JSON.stringify(dataCore ? {recordId:pageId,status} : {pageId,status}),
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "업무 상태를 변경하지 못했습니다.");
    return data;
  }

  function readCount(node){
    const value=Number(node?.textContent || 0);
    return Number.isFinite(value) ? value : 0;
  }

  function writeCount(node,value){
    if(node) node.textContent=String(Math.max(0,Number(value) || 0));
  }

  function summaryTotal(){
    return ["overdue","today","upcoming","undated"].reduce((total,kind)=>{
      return total+readCount(root.querySelector(`.briefing-v2-summary .is-${kind} b`));
    },0);
  }

  function syncMetaTotal(){
    const total=summaryTotal();
    meta.textContent=meta.textContent.replace(/미완료\s+(\d+)(건 이상|건)/,(_,count,suffix)=>`미완료 ${total}${suffix}`);
  }

  function syncOptimisticEmptyState(){
    const total=summaryTotal();
    let clear=root.querySelector('.briefing-v2-clear[data-optimistic-clear="true"]');
    if(total===0 && !clear){
      clear=document.createElement("p");
      clear.className="briefing-v2-clear";
      clear.dataset.optimisticClear="true";
      clear.textContent="현재 미완료 업무가 없습니다.";
      root.appendChild(clear);
    }else if(total>0 && clear){
      clear.remove();
    }
  }

  function syncOptimisticSection(section){
    if(!section) return;
    const allRows=[...section.querySelectorAll(".briefing-v2-list > li")];
    const rows=allRows.filter(row=>row.dataset.optimisticComplete!=="true");
    const pendingRows=allRows.filter(row=>row.dataset.optimisticComplete==="true");
    const count=rows.length;
    writeCount(section.querySelector(".briefing-v2-section-head h3 span"),count);
    const toggle=section.querySelector(".briefing-v2-more-toggle");
    const expanded=toggle?.getAttribute("aria-expanded")==="true";
    rows.forEach((row,index)=>{ row.hidden=!expanded && index>=MAX_VISIBLE; });
    pendingRows.forEach(row=>{ row.hidden=false; });
    if(toggle){
      const extra=Math.max(0,count-MAX_VISIBLE);
      toggle.hidden=extra===0;
      toggle.textContent=expanded ? "접기" : `${extra}개 더 보기`;
    }
    section.hidden=count===0 && pendingRows.length===0;
  }

  function beginOptimisticComplete(button){
    const row=button.closest("li");
    const section=button.closest(".briefing-v2-section");
    const kind=section?.dataset.section || "";
    if(!row || !section || !["overdue","today","upcoming","undated"].includes(kind)) return null;
    const pageId=button.dataset.pageId || "";
    const itemTitle=button.dataset.title || "업무";
    const hadFollowUp=!!row.querySelector(".briefing-tag.is-followup");
    const originalHtml=row.innerHTML;
    const originalHidden=row.hidden;
    row.dataset.optimisticComplete="true";
    row.classList.add("briefing-inline-undo-row");
    row.hidden=false;
    row.setAttribute("aria-label",`${itemTitle} 완료 처리 중`);
    row.innerHTML=`<div class="briefing-inline-undo"><span>✓ 완료됨</span><button type="button" data-v2-undo="${escapeHtml(pageId)}" disabled>실행 취소</button></div>`;
    const summary=root.querySelector(`.briefing-v2-summary .is-${kind} b`);
    writeCount(summary,readCount(summary)-1);
    if(hadFollowUp){
      root.dataset.followUpCount=String(Math.max(0,Number(root.dataset.followUpCount || 0)-1));
    }
    syncOptimisticSection(section);
    syncMetaTotal();
    syncOptimisticEmptyState();
    return {row,section,kind,hadFollowUp,originalHtml,originalHidden,pageId,itemTitle,undoTimer:0};
  }

  function rollbackOptimisticComplete(state){
    if(!state?.row?.isConnected) return;
    clearTimeout(state.undoTimer);
    inlineUndoStates.delete(state.pageId);
    delete state.row.dataset.optimisticComplete;
    state.row.classList.remove("briefing-inline-undo-row");
    state.row.removeAttribute("aria-label");
    state.row.innerHTML=state.originalHtml;
    state.row.hidden=state.originalHidden;
    const summary=root.querySelector(`.briefing-v2-summary .is-${state.kind} b`);
    writeCount(summary,readCount(summary)+1);
    if(state.hadFollowUp){
      root.dataset.followUpCount=String(Math.max(0,Number(root.dataset.followUpCount || 0)+1));
    }
    state.section.hidden=false;
    syncOptimisticSection(state.section);
    syncMetaTotal();
    syncOptimisticEmptyState();
  }

  function syncV2InBackground(){
    clearTimeout(backgroundSyncTimer);
    if(inlineUndoStates.size>0) return;
    backgroundSyncTimer=window.setTimeout(async()=>{
      if(IS_PREVIEW_DEMO || inlineUndoStates.size>0) return;
      if(pendingCompletions>0){
        syncV2InBackground();
        return;
      }
      if(loading) return;
      try{
        const data=await fetchV2({ask:false});
        render(data);
        lastLoadedAt=Date.now();
      }catch{}
    },120);
  }

  function activateInlineUndo(state,pageId,itemTitle){
    if(!state?.row?.isConnected) return;
    const undo=state.row.querySelector("[data-v2-undo]");
    if(undo) undo.disabled=false;
    state.row.setAttribute("aria-label",`${itemTitle} 완료 처리됨. 실행 취소 가능`);
    inlineUndoStates.set(pageId,state);
    clearTimeout(state.undoTimer);
    state.undoTimer=window.setTimeout(()=>{
      if(inlineUndoStates.get(pageId)!==state) return;
      inlineUndoStates.delete(pageId);
      if(state.row?.isConnected) state.row.remove();
      syncOptimisticSection(state.section);
      syncOptimisticEmptyState();
      if(inlineUndoStates.size===0 && pendingCompletions===0) syncV2InBackground();
    },8000);
  }

  async function completeTask(button){
    if(IS_PREVIEW_DEMO || loading || button.disabled) return;
    const pageId=button.dataset.pageId || "";
    const itemTitle=button.dataset.title || "업무";
    const fallbackStatus=button.dataset.status || "";
    if(!pageId) return;
    const optimisticState=beginOptimisticComplete(button);
    if(!optimisticState){
      button.disabled=true;
      button.textContent="처리 중";
    }
    pendingCompletions+=1;
    try{
      const data=await updateTaskStatus(pageId,"완료");
      const previousStatus=renderedMode==="data_core" ? fallbackStatus : (data.previousStatus || fallbackStatus);
      if(previousStatus && previousStatus!=="완료") saveUndoState(pageId,previousStatus,itemTitle);
      if(optimisticState) activateInlineUndo(optimisticState,pageId,itemTitle);
      else syncV2InBackground();
    }catch(err){
      if(optimisticState) rollbackOptimisticComplete(optimisticState);
      error.textContent=err?.message || "완료 처리에 실패했습니다.";
      card.classList.add("has-error");
      if(!optimisticState){
        button.disabled=false;
        button.textContent="완료";
      }
    }finally{
      pendingCompletions=Math.max(0,pendingCompletions-1);
    }
  }

  async function undoTask(pageId){
    if(IS_PREVIEW_DEMO) return;
    const saved=loadUndoStates()[pageId];
    if(!saved?.status) return;
    const optimisticState=inlineUndoStates.get(pageId);
    const undoButton=optimisticState?.row?.querySelector?.("[data-v2-undo]");
    if(undoButton){
      undoButton.disabled=true;
      undoButton.textContent="되돌리는 중…";
    }
    try{
      await updateTaskStatus(pageId,saved.status);
      removeUndoState(pageId);
      if(optimisticState?.row?.isConnected){
        rollbackOptimisticComplete(optimisticState);
      }else{
        inlineUndoStates.delete(pageId);
        await refreshV2({ask:false});
      }
      if(inlineUndoStates.size===0) syncV2InBackground();
    }catch(err){
      if(undoButton){
        undoButton.disabled=false;
        undoButton.textContent="실행 취소";
      }
      error.textContent=err?.message || "완료 취소에 실패했습니다.";
      card.classList.add("has-error");
    }
  }

  function toggleSection(button){
    const section=button.closest(".briefing-v2-section");
    if(!section) return;
    const rows=[...section.querySelectorAll(".briefing-v2-list > li")];
    const activeRows=rows.filter(row=>row.dataset.optimisticComplete!=="true");
    const expanded=button.getAttribute("aria-expanded")==="true";
    activeRows.forEach((row,index)=>{ if(index>=MAX_VISIBLE) row.hidden=expanded; });
    rows.filter(row=>row.dataset.optimisticComplete==="true").forEach(row=>{ row.hidden=false; });
    button.setAttribute("aria-expanded",String(!expanded));
    button.textContent=expanded ? `${Math.max(0,activeRows.length-MAX_VISIBLE)}개 더 보기` : "접기";
  }

  async function quickUpdate(){
    if(IS_PREVIEW_DEMO || loading) return;
    const headers=authHeaders({ask:true});
    if(!Object.keys(headers).length){
      error.textContent="브리핑을 다시 정리하려면 Notion 연결 또는 개인 접근키가 필요합니다.";
      card.classList.add("has-error");
      return;
    }
    setBusy(true);
    try{
      const res=await fetch("/api/briefing",{
        method:"POST",
        headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify({action:"quick_update"}),
        cache:"no-store"
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "브리핑 다시 정리에 실패했습니다.");
      const v2=await fetchV2({ask:false});
      render(v2);
      lastLoadedAt=Date.now();
    }catch(err){
      error.textContent=err?.message || "브리핑 다시 정리에 실패했습니다.";
      card.classList.add("has-error");
    }finally{
      setBusy(false);
    }
  }

  root.addEventListener("click",event=>{
    const complete=event.target.closest?.(".briefing-v2-complete");
    if(complete){ completeTask(complete); return; }
    const toggle=event.target.closest?.(".briefing-v2-more-toggle");
    if(toggle) toggleSection(toggle);
  });

  document.addEventListener("click",event=>{
    const undo=event.target.closest?.("[data-v2-undo]");
    if(undo) undoTask(undo.dataset.v2Undo || "");
  });

  if(IS_PREVIEW_DEMO){
    render(previewDemoData());
    if(quick){
      quick.disabled=true;
      quick.textContent="화면 미리보기";
    }
  }else{
    quick?.addEventListener("click",quickUpdate);
    window.addEventListener("worklog:platform-auth-changed",event=>{
      if(String(event?.detail?.state || "")!=="platform-signed-in" || lastLoadedAt>0) return;
      if(loading){
        authRetryPending=true;
        return;
      }
      refreshV2({ask:false,silentFallback:true});
    });
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="visible" && Date.now()-lastLoadedAt>90*1000){
        refreshV2({ask:false,silentFallback:true});
      }
    });
    refreshV2({ask:false,silentFallback:true});
  }
})();