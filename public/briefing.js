(()=>{
  const $=(id)=>document.getElementById(id);
  const els={
    card:$("briefingCard"),
    title:$("briefingTitle"),
    meta:$("briefingMeta"),
    top:$("briefingTop"),
    today:$("briefingToday"),
    upcoming:$("briefingUpcoming"),
    quick:$("briefingQuickUpdate"),
    error:$("briefingError")
  };

  if(!els.card) return;

  const UNDO_KEY="worklogBriefingUndoStates";
  let loading=false;
  let lastLoadedAt=0;
  let undoTimer=null;
  let topExpanded=false;
  let topToggle=null;

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

  function formatGeneratedAt(value){
    if(!value) return "";
    try{
      return new Intl.DateTimeFormat("ko-KR",{
        timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"numeric",minute:"2-digit"
      }).format(new Date(value));
    }catch{ return value; }
  }

  function seoulDateKey(value=new Date()){
    const date=value instanceof Date ? value : new Date(value);
    if(Number.isNaN(date.getTime())) return "";
    const parts=new Intl.DateTimeFormat("en-CA",{
      timeZone:"Asia/Seoul",year:"numeric",month:"2-digit",day:"2-digit"
    }).formatToParts(date);
    const get=(type)=>parts.find(part=>part.type===type)?.value || "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  }

  function briefingFreshness(value){
    const generated=seoulDateKey(value);
    if(!generated) return {fresh:false,message:"⚠ 브리핑 생성 시각을 확인할 수 없습니다."};
    const today=seoulDateKey();
    if(generated!==today){
      return {fresh:false,message:`⚠ ${formatGeneratedAt(value)}에 생성된 브리핑입니다. 오늘 브리핑이 아닙니다.`};
    }
    return {fresh:true,message:""};
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

  function saveUndoState(pageId,status,title){
    const states=loadUndoStates();
    states[pageId]={status,title,ts:Date.now()};
    localStorage.setItem(UNDO_KEY,JSON.stringify(states));
  }

  function removeUndoState(pageId){
    const states=loadUndoStates();
    delete states[pageId];
    localStorage.setItem(UNDO_KEY,JSON.stringify(states));
  }

  function priorityHtml(item){
    const institution=item.institution ? `<span class="briefing-tag">${escapeHtml(institutionLabel(item.institution))}</span>` : "";
    const note=item.note ? `<small>${escapeHtml(item.note)}</small>` : "";
    const statusWarning=item.statusError ? `<small>상태 확인 실패</small>` : "";
    const pageId=String(item.pageId || "");
    const isDone=item.status==="완료";
    const canUndo=isDone && Boolean(loadUndoStates()[pageId]?.status);
    const action=pageId
      ? `<button class="briefing-complete${isDone ? " is-done" : ""}" type="button" data-page-id="${escapeHtml(pageId)}" data-title="${escapeHtml(item.title)}" data-action="${isDone ? "undo" : "complete"}"${isDone && !canUndo ? " disabled" : ""}>${isDone ? "✓ 완료" : "완료"}</button>`
      : "";
    return `<li class="${isDone ? "briefing-done" : ""}"><div><strong>${escapeHtml(item.title)}</strong><div class="briefing-sub">${institution}${note}${statusWarning}</div></div>${action}</li>`;
  }

  function scheduleHtml(item){
    const when=item.when ? `<span class="briefing-date">${escapeHtml(item.when)}</span>` : "";
    return `<li>${when}<div><strong>${escapeHtml(item.title)}</strong></div></li>`;
  }

  function renderList(target,items,emptyText,renderer){
    if(!target) return;
    if(!items?.length){
      target.innerHTML=`<li class="briefing-empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    target.innerHTML=items.map(renderer).join("");
  }

  function ensureTopToggle(){
    if(topToggle || !els.top) return topToggle;
    topToggle=document.createElement("button");
    topToggle.type="button";
    topToggle.className="briefing-top-toggle";
    topToggle.hidden=true;
    topToggle.setAttribute("aria-controls","briefingTop");
    topToggle.addEventListener("click",()=>{
      topExpanded=!topExpanded;
      applyTopExpansion();
    });
    els.top.insertAdjacentElement("afterend",topToggle);
    return topToggle;
  }

  function applyTopExpansion(){
    if(!els.top) return;
    const rows=Array.from(els.top.children);
    const extraCount=Math.max(0,rows.length-5);
    rows.forEach((row,index)=>{
      if(index>=5) row.hidden=!topExpanded;
    });
    const toggle=ensureTopToggle();
    if(!toggle) return;
    toggle.hidden=extraCount===0;
    toggle.setAttribute("aria-expanded",String(topExpanded));
    toggle.textContent=topExpanded ? "접기" : `${extraCount}개 더 보기`;
  }

  function renderTop(items,emptyText){
    const topItems=Array.isArray(items) ? items.slice(0,10) : [];
    renderList(els.top,topItems,emptyText,priorityHtml);
    if(!topItems.length) topExpanded=false;
    applyTopExpansion();
  }

  function setBusy(kind=""){
    loading=Boolean(kind);
    els.card.classList.toggle("loading",loading);
    if(els.quick){
      els.quick.disabled=loading;
      els.quick.textContent=kind==="quick" ? "정리 중…" : "브리핑 다시 정리";
    }
  }

  function showUndoNotice(pageId,title){
    let bar=document.getElementById("briefingUndoBar");
    if(!bar){
      bar=document.createElement("div");
      bar.id="briefingUndoBar";
      bar.className="briefing-undo-bar";
      document.body.appendChild(bar);
    }
    bar.innerHTML=`<span>${escapeHtml(title)} 완료 처리</span><button type="button" data-undo-page="${escapeHtml(pageId)}">실행 취소</button>`;
    bar.classList.add("show");
    clearTimeout(undoTimer);
    undoTimer=setTimeout(()=>bar.classList.remove("show"),8000);
  }

  function render(data){
    if(!data.ready){
      els.title.textContent="첫 브리핑 준비 중";
      els.meta.textContent=data.message || "오전 8시·오후 12시 30분·오후 6시 브리핑 후 표시됩니다.";
      renderTop([],"아직 확정된 브리핑이 없습니다.");
      renderList(els.today,[],"아직 확정된 일정이 없습니다.",scheduleHtml);
      renderList(els.upcoming,[],"아직 확정된 일정이 없습니다.",scheduleHtml);
      els.error.textContent="";
      els.card.classList.remove("has-error");
      return;
    }

    const briefing=data.briefing || {};
    const freshness=briefingFreshness(briefing.generatedAt);
    els.title.textContent=`${freshness.fresh ? "" : "⚠ "}${briefing.period ? `${briefing.period} 브리핑` : "오늘 브리핑"}`;
    const generated=formatGeneratedAt(briefing.generatedAt);
    els.meta.textContent=[generated,briefing.meta].filter(Boolean).join(" · ") || "예약 업무가 확정한 최신 브리핑";

    renderTop(briefing.top,"오늘 우선 업무가 없습니다.");
    renderList(els.today,briefing.today,"오늘 확정 일정이 없습니다.",scheduleHtml);
    renderList(els.upcoming,briefing.upcoming,"다가오는 일정이 없습니다.",scheduleHtml);

    const warnings=[];
    if(!freshness.fresh) warnings.push(freshness.message);
    if(Array.isArray(briefing.checking) && briefing.checking.length){
      warnings.push(`확인 필요: ${briefing.checking.join(" · ")}`);
    }
    const statusFailures=Array.isArray(briefing.top) ? briefing.top.filter(item=>item?.statusError).length : 0;
    if(statusFailures) warnings.push(`업무 ${statusFailures}건의 현재 상태를 확인하지 못했습니다.`);

    els.error.textContent=warnings.join(" ");
    els.card.classList.toggle("has-error",warnings.length>0);
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

  async function completeTask(button){
    if(loading) return;
    const pageId=button.dataset.pageId || "";
    const title=button.dataset.title || "업무";
    if(!pageId || button.disabled) return;
    button.disabled=true;
    button.textContent="처리 중";
    try{
      const data=await updateTaskStatus(pageId,"완료");
      if(data.previousStatus && data.previousStatus!=="완료") saveUndoState(pageId,data.previousStatus,title);
      await refreshBriefing({promptIfMissing:false});
      showUndoNotice(pageId,title);
    }catch(error){
      els.error.textContent=error?.message || "완료 처리에 실패했습니다.";
      els.card.classList.add("has-error");
      button.disabled=false;
      button.textContent="완료";
    }
  }

  async function undoTask(pageId,{confirmFirst=false}={}){
    const state=loadUndoStates()[pageId];
    if(!state?.status) return;
    if(confirmFirst && !confirm(`‘${state.title || "업무"}’ 완료 처리를 취소할까요?`)) return;
    try{
      await updateTaskStatus(pageId,state.status);
      removeUndoState(pageId);
      const bar=document.getElementById("briefingUndoBar");
      bar?.classList.remove("show");
      await refreshBriefing({promptIfMissing:false});
    }catch(error){
      els.error.textContent=error?.message || "완료 취소에 실패했습니다.";
      els.card.classList.add("has-error");
    }
  }

  async function refreshBriefing({promptIfMissing=true}={}){
    if(loading) return;
    const headers=authHeaders({ask:promptIfMissing});
    if(!Object.keys(headers).length){
      els.error.textContent="브리핑을 보려면 Notion 연결 또는 개인 접근키가 필요합니다.";
      els.card.classList.add("has-error");
      return;
    }

    setBusy("refresh");
    try{
      const res=await fetch("/api/briefing",{
        method:"GET",
        headers,
        cache:"no-store"
      });
      const data=await res.json().catch(()=>({}));
      if(res.status===401 && window.WorklogAuth?.mode?.()!=="personal"){
        localStorage.removeItem("worklogAccessKey");
      }
      if(!res.ok) throw new Error(data.error || "브리핑을 불러오지 못했습니다.");
      render(data);
      lastLoadedAt=Date.now();
    }catch(error){
      els.error.textContent=error?.message || "브리핑을 불러오지 못했습니다.";
      els.card.classList.add("has-error");
    }finally{
      setBusy();
    }
  }

  async function quickUpdateBriefing(){
    if(loading) return;
    const headers=authHeaders({ask:true});
    if(!Object.keys(headers).length){
      els.error.textContent="브리핑을 다시 정리하려면 Notion 연결 또는 개인 접근키가 필요합니다.";
      els.card.classList.add("has-error");
      return;
    }

    setBusy("quick");
    try{
      const res=await fetch("/api/briefing",{
        method:"POST",
        headers:{...headers,"content-type":"application/json"},
        body:JSON.stringify({action:"quick_update"}),
        cache:"no-store"
      });
      const data=await res.json().catch(()=>({}));
      if(res.status===401 && window.WorklogAuth?.mode?.()!=="personal"){
        localStorage.removeItem("worklogAccessKey");
      }
      if(!res.ok) throw new Error(data.error || "브리핑 다시 정리에 실패했습니다.");
      render(data);
      lastLoadedAt=Date.now();
    }catch(error){
      els.error.textContent=error?.message || "브리핑 다시 정리에 실패했습니다.";
      els.card.classList.add("has-error");
    }finally{
      setBusy();
    }
  }

  els.quick?.addEventListener("click",quickUpdateBriefing);
  els.top?.addEventListener("click",event=>{
    const button=event.target.closest?.(".briefing-complete");
    if(!button) return;
    if(button.dataset.action==="undo") undoTask(button.dataset.pageId || "",{confirmFirst:true});
    else completeTask(button);
  });
  document.addEventListener("click",event=>{
    const button=event.target.closest?.("[data-undo-page]");
    if(button) undoTask(button.dataset.undoPage || "");
  });

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && Date.now()-lastLoadedAt>5*60*1000){
      refreshBriefing({promptIfMissing:false});
    }
  });

  refreshBriefing({promptIfMissing:true});
})();
