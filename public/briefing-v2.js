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

  // briefing.js has already captured the original nodes. Replace the visible
  // header/error nodes so its asynchronous V1 refresh cannot overwrite V2 copy.
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
    const headers=window.WorklogAuth?.getHeaders
      ? window.WorklogAuth.getHeaders({promptOwner:ask})
      : (()=>{
          let key=localStorage.getItem("worklogAccessKey") || "";
          if(!key && ask){
            key=(window.prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
            if(key) localStorage.setItem("worklogAccessKey",key);
          }
          return key ? {"x-worklog-key":key} : {};
        })();
    const session=window.WorklogPlatformAuth?.readSession?.();
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
    }else if(item.dueKey){
      pieces.push(`기한 ${mmdd(item.dueKey)}`);
    }
    if(item.status) pieces.push(item.status);
    return pieces.join(" · ");
  }

  function taskHtml(kind,item,index,canUpdate){
    const institution=item.institution
      ? `<span class="briefing-tag">${escapeHtml(institutionLabel(item.institution))}</span>`
      : "";
    const note=sectionNote(kind,item);
    const follow=kind==="followUp" && item.followUp
      ? `<small class="briefing-v2-follow">↳ ${escapeHtml(item.followUp)}</small>`
      : "";
    const hidden=index>=MAX_VISIBLE ? " hidden" : "";
    const action=!canUpdate
      ? `<small class="briefing-v2-read-only">Data Core</small>`
      : IS_PREVIEW_DEMO
      ? `<button class="briefing-complete briefing-v2-complete" type="button" disabled>완료</button>`
      : `<button class="briefing-complete briefing-v2-complete" type="button" data-page-id="${escapeHtml(item.pageId)}" data-status="${escapeHtml(item.status)}" data-title="${escapeHtml(item.title)}">완료</button>`;
    return `<li${hidden}><div><strong>${escapeHtml(item.title)}</strong><div class="briefing-sub">${institution}${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>${follow}</div>${action}</li>`;
  }

  function sectionHtml(kind,label,items,canUpdate){
    if(!Array.isArray(items) || !items.length) return "";
    const extra=Math.max(0,items.length-MAX_VISIBLE);
    return `<section class="briefing-v2-section briefing-v2-${kind}" data-section="${kind}"><div class="briefing-v2-section-head"><h3>${label} <span>${items.length}</span></h3></div><ul class="briefing-list briefing-v2-list">${items.map((item,index)=>taskHtml(kind,item,index,canUpdate)).join("")}</ul>${extra ? `<button class="briefing-v2-more-toggle" type="button" data-section-toggle="${kind}" aria-expanded="false">${extra}개 더 보기</button>` : ""}</section>`;
  }

  function render(data){
    const structure=data?.structure || {};
    const counts=data?.counts || {};
    const total=Number(counts.total || 0);
    const canUpdate=data?.canUpdate!==false;

    root.innerHTML=`<div class="briefing-v2-summary" aria-label="업무 상황 요약"><span class="is-overdue">지난 <b>${Number(counts.overdue || 0)}</b></span><span class="is-today">오늘 <b>${Number(counts.today || 0)}</b></span><span class="is-waiting">대기 <b>${Number(counts.waiting || 0)}</b></span><span class="is-followup">후속 <b>${Number(counts.followUp || 0)}</b></span></div>${sectionHtml("overdue","🔴 지난 것",structure.overdue,canUpdate)}${sectionHtml("today","🟠 오늘",structure.today,canUpdate)}${sectionHtml("waiting","🟡 기다리는 것",structure.waiting,canUpdate)}${sectionHtml("followUp","🔵 후속조치 필요",structure.followUp,canUpdate)}${Number(counts.other || 0)>0 ? `<p class="briefing-v2-other">그 외 진행중 <strong>${Number(counts.other || 0)}건</strong></p>` : ""}${total===0 ? `<p class="briefing-v2-clear">현재 미완료 업무가 없습니다.</p>` : ""}`;

    root.hidden=false;
    hideLegacy();
    title.textContent=IS_PREVIEW_DEMO ? "오늘 업무 상황 · 화면 미리보기" : "오늘 업무 상황";
    const generated=formatGeneratedAt(data.generatedAt);
    const countLabel=data.truncated ? `미완료 ${total}건 이상` : `미완료 ${total}건`;
    meta.textContent=IS_PREVIEW_DEMO ? "예시 업무로 보는 브리핑 2.0 화면" : [generated,countLabel,data?.mode==="data_core" ? "Data Core 기준" : "Notion 최신 기준"].filter(Boolean).join(" · ");
    if(quick) quick.hidden=!canUpdate;
    if(data.truncated){
      error.textContent="업무가 많아 최근 500건 기준으로 정리했습니다.";
      card.classList.add("has-error");
    }else{
      error.textContent="";
      card.classList.remove("has-error");
    }
  }

  function previewDemoData(){
    const sample=(title,status,dueKey="",extra={})=>({pageId:"demo",title,institution:"태장",status,dueKey,followUp:"",daysOverdue:0,daysUntil:0,...extra});
    return {
      generatedAt:new Date().toISOString(),
      counts:{overdue:4,today:3,waiting:2,followUp:2,other:5,total:16},
      structure:{
        overdue:[
          sample("견적서 금액 확인 후 대표 보고","진행중","2026-09-10",{daysOverdue:2}),
          sample("거래처 세금계산서 확인","확인필요","2026-09-11",{daysOverdue:1}),
          sample("지원사업 제출서류 보완","진행중","2026-09-11",{daysOverdue:1}),
          sample("계약서 수정사항 회신","대기","2026-09-11",{daysOverdue:1})
        ],
        today:[
          sample("삼현 행사 일정 최종 확인","진행중","2026-09-12"),
          sample("대표이사 보고자료 전달","진행중","2026-09-12"),
          sample("납품 수량 확정 연락","확인필요","2026-09-12")
        ],
        waiting:[
          sample("업체 견적 회신 대기","대기","2026-09-15"),
          sample("취재 일정 답변 대기","대기")
        ],
        followUp:[
          sample("어제 받은 계약서 검토","진행중","",{followUp:"수정할 조항 표시 후 상대방에게 회신"}),
          sample("통화 내용 담당자에게 전달","확인필요","",{followUp:"담당자 확인 후 결과 기록"})
        ],
        otherCount:5,
        totalOpen:16
      }
    };
  }

  async function fetchV2({ask=true}={}){
    const headers=authHeaders({ask});
    if(!Object.keys(headers).length) throw new Error("Notion 연결 또는 개인 접근키가 필요합니다.");
    const res=await fetch("/api/briefing-v2",{method:"GET",headers,cache:"no-store"});
    const data=await res.json().catch(()=>({}));
    if(res.status===401 && window.WorklogAuth?.mode?.()!=="personal"){
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
      setBusy(false);
    }
  }

  async function updateTaskStatus(pageId,status){
    const headers=authHeaders({ask:true});
    if(!Object.keys(headers).length) throw new Error("Notion 연결 또는 개인 접근키가 필요합니다.");
    const res=await fetch("/api/briefing",{
      method:"POST",
      headers:{...headers,"content-type":"application/json"},
      body:JSON.stringify({pageId,status}),
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "업무 상태를 변경하지 못했습니다.");
    return data;
  }

  function showUndoNotice(pageId,itemTitle){
    let bar=$("briefingV2UndoBar");
    if(!bar){
      bar=document.createElement("div");
      bar.id="briefingV2UndoBar";
      bar.className="briefing-undo-bar";
      document.body.appendChild(bar);
    }
    bar.innerHTML=`<span>${escapeHtml(itemTitle)} 완료 처리</span><button type="button" data-v2-undo="${escapeHtml(pageId)}">실행 취소</button>`;
    bar.classList.add("show");
    clearTimeout(bar._hideTimer);
    bar._hideTimer=setTimeout(()=>bar.classList.remove("show"),8000);
  }

  async function completeTask(button){
    if(IS_PREVIEW_DEMO || loading || button.disabled) return;
    const pageId=button.dataset.pageId || "";
    const itemTitle=button.dataset.title || "업무";
    if(!pageId) return;
    button.disabled=true;
    button.textContent="처리 중";
    try{
      const data=await updateTaskStatus(pageId,"완료");
      if(data.previousStatus && data.previousStatus!=="완료") saveUndoState(pageId,data.previousStatus,itemTitle);
      await refreshV2({ask:false});
      showUndoNotice(pageId,itemTitle);
    }catch(err){
      error.textContent=err?.message || "완료 처리에 실패했습니다.";
      card.classList.add("has-error");
      button.disabled=false;
      button.textContent="완료";
    }
  }

  async function undoTask(pageId){
    if(IS_PREVIEW_DEMO) return;
    const state=loadUndoStates()[pageId];
    if(!state?.status) return;
    try{
      await updateTaskStatus(pageId,state.status);
      removeUndoState(pageId);
      $("briefingV2UndoBar")?.classList.remove("show");
      await refreshV2({ask:false});
    }catch(err){
      error.textContent=err?.message || "완료 취소에 실패했습니다.";
      card.classList.add("has-error");
    }
  }

  function toggleSection(button){
    const section=button.closest(".briefing-v2-section");
    if(!section) return;
    const rows=[...section.querySelectorAll(".briefing-v2-list > li")];
    const expanded=button.getAttribute("aria-expanded")==="true";
    rows.forEach((row,index)=>{ if(index>=MAX_VISIBLE) row.hidden=expanded; });
    button.setAttribute("aria-expanded",String(!expanded));
    button.textContent=expanded ? `${Math.max(0,rows.length-MAX_VISIBLE)}개 더 보기` : "접기";
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
    document.addEventListener("visibilitychange",()=>{
      if(document.visibilityState==="visible" && Date.now()-lastLoadedAt>90*1000){
        refreshV2({ask:false,silentFallback:true});
      }
    });
    refreshV2({ask:false,silentFallback:true});
  }
})();
