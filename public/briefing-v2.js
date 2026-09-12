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
    if(window.WorklogAuth?.getHeaders){
      return window.WorklogAuth.getHeaders({promptOwner:ask});
    }
    let key=localStorage.getItem("worklogAccessKey") || "";
    if(!key && ask){
      key=(window.prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
      if(key) localStorage.setItem("worklogAccessKey",key);
    }
    return key ? {"x-worklog-key":key} : {};
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

  function taskHtml(kind,item,index){
    const institution=item.institution
      ? `<span class="briefing-tag">${escapeHtml(institutionLabel(item.institution))}</span>`
      : "";
    const note=sectionNote(kind,item);
    const follow=kind==="followUp" && item.followUp
      ? `<small class="briefing-v2-follow">↳ ${escapeHtml(item.followUp)}</small>`
      : "";
    const hidden=index>=MAX_VISIBLE ? " hidden" : "";
    return `<li${hidden}><div><strong>${escapeHtml(item.title)}</strong><div class="briefing-sub">${institution}${note ? `<small>${escapeHtml(note)}</small>` : ""}</div>${follow}</div><button class="briefing-complete briefing-v2-complete" type="button" data-page-id="${escapeHtml(item.pageId)}" data-status="${escapeHtml(item.status)}" data-title="${escapeHtml(item.title)}">완료</button></li>`;
  }

  function sectionHtml(kind,label,items){
    if(!Array.isArray(items) || !items.length) return "";
    const extra=Math.max(0,items.length-MAX_VISIBLE);
    return `<section class="briefing-v2-section briefing-v2-${kind}" data-section="${kind}"><div class="briefing-v2-section-head"><h3>${label} <span>${items.length}</span></h3></div><ul class="briefing-list briefing-v2-list">${items.map((item,index)=>taskHtml(kind,item,index)).join("")}</ul>${extra ? `<button class="briefing-v2-more-toggle" type="button" data-section-toggle="${kind}" aria-expanded="false">${extra}개 더 보기</button>` : ""}</section>`;
  }

  function render(data){
    const structure=data?.structure || {};
    const counts=data?.counts || {};
    const total=Number(counts.total || 0);

    root.innerHTML=`<div class="briefing-v2-summary" aria-label="업무 상황 요약"><span class="is-overdue">지난 <b>${Number(counts.overdue || 0)}</b></span><span class="is-today">오늘 <b>${Number(counts.today || 0)}</b></span><span class="is-waiting">대기 <b>${Number(counts.waiting || 0)}</b></span><span class="is-followup">후속 <b>${Number(counts.followUp || 0)}</b></span></div>${sectionHtml("overdue","🔴 지난 것",structure.overdue)}${sectionHtml("today","🟠 오늘",structure.today)}${sectionHtml("waiting","🟡 기다리는 것",structure.waiting)}${sectionHtml("followUp","🔵 후속조치 필요",structure.followUp)}${Number(counts.other || 0)>0 ? `<p class="briefing-v2-other">그 외 진행중 <strong>${Number(counts.other || 0)}건</strong></p>` : ""}${total===0 ? `<p class="briefing-v2-clear">현재 미완료 업무가 없습니다.</p>` : ""}`;

    root.hidden=false;
    hideLegacy();
    title.textContent="오늘 업무 상황";
    const generated=formatGeneratedAt(data.generatedAt);
    const countLabel=data.truncated ? `미완료 ${total}건 이상` : `미완료 ${total}건`;
    meta.textContent=[generated,countLabel,"Notion 최신 기준"].filter(Boolean).join(" · ");
    if(data.truncated){
      error.textContent="업무가 많아 최근 500건 기준으로 정리했습니다.";
      card.classList.add("has-error");
    }else{
      error.textContent="";
      card.classList.remove("has-error");
    }
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
    if(loading) return;
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
    if(loading || button.disabled) return;
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
    if(loading) return;
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

  quick?.addEventListener("click",quickUpdate);

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && Date.now()-lastLoadedAt>90*1000){
      refreshV2({ask:false,silentFallback:true});
    }
  });

  refreshV2({ask:false,silentFallback:true});
})();
