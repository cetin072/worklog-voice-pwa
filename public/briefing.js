(()=>{
  const $=(id)=>document.getElementById(id);
  const els={
    card:$("briefingCard"),
    title:$("briefingTitle"),
    meta:$("briefingMeta"),
    top:$("briefingTop"),
    today:$("briefingToday"),
    upcoming:$("briefingUpcoming"),
    refresh:$("briefingRefresh"),
    error:$("briefingError")
  };

  if(!els.card) return;

  let loading=false;
  let lastLoadedAt=0;

  function getAccessKey({promptIfMissing=true}={}){
    let key=localStorage.getItem("worklogAccessKey") || "";
    if(!key && promptIfMissing){
      key=(prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
      if(key) localStorage.setItem("worklogAccessKey",key);
    }
    return key;
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

  function priorityHtml(item){
    const institution=item.institution ? `<span class="briefing-tag">${escapeHtml(institutionLabel(item.institution))}</span>` : "";
    const note=item.note ? `<small>${escapeHtml(item.note)}</small>` : "";
    return `<li><div><strong>${escapeHtml(item.title)}</strong><div class="briefing-sub">${institution}${note}</div></div></li>`;
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

  function setLoading(active){
    loading=active;
    els.card.classList.toggle("loading",active);
    if(els.refresh){
      els.refresh.disabled=active;
      els.refresh.textContent=active ? "불러오는 중" : "새로고침";
    }
  }

  function render(data){
    if(!data.ready){
      els.title.textContent="첫 브리핑 준비 중";
      els.meta.textContent=data.message || "오전 8시 또는 오후 12시 30분 브리핑 후 표시됩니다.";
      renderList(els.top,[],"아직 확정된 브리핑이 없습니다.",priorityHtml);
      renderList(els.today,[],"아직 확정된 일정이 없습니다.",scheduleHtml);
      renderList(els.upcoming,[],"아직 확정된 일정이 없습니다.",scheduleHtml);
      els.error.textContent="";
      els.card.classList.remove("has-error");
      return;
    }

    const briefing=data.briefing || {};
    els.title.textContent=briefing.period ? `${briefing.period} 브리핑` : "오늘 브리핑";
    const generated=formatGeneratedAt(briefing.generatedAt);
    els.meta.textContent=[generated,briefing.meta].filter(Boolean).join(" · ") || "예약 업무가 확정한 최신 브리핑";

    renderList(els.top,briefing.top,"오늘 우선 업무가 없습니다.",priorityHtml);
    renderList(els.today,briefing.today,"오늘 확정 일정이 없습니다.",scheduleHtml);
    renderList(els.upcoming,briefing.upcoming,"다가오는 일정이 없습니다.",scheduleHtml);

    if(Array.isArray(briefing.checking) && briefing.checking.length){
      els.error.textContent=`확인 필요: ${briefing.checking.join(" · ")}`;
      els.card.classList.add("has-error");
    }else{
      els.error.textContent="";
      els.card.classList.remove("has-error");
    }
  }

  async function refreshBriefing({promptIfMissing=true}={}){
    if(loading) return;
    const key=getAccessKey({promptIfMissing});
    if(!key){
      els.error.textContent="브리핑을 보려면 개인 접근키가 필요합니다.";
      els.card.classList.add("has-error");
      return;
    }

    setLoading(true);
    try{
      const res=await fetch("/api/briefing",{
        method:"GET",
        headers:{"x-worklog-key":key},
        cache:"no-store"
      });
      const data=await res.json().catch(()=>({}));
      if(res.status===401){
        localStorage.removeItem("worklogAccessKey");
        throw new Error("개인 접근키가 맞지 않습니다. 새로고침을 눌러 다시 입력하세요.");
      }
      if(!res.ok) throw new Error(data.error || "브리핑을 불러오지 못했습니다.");
      render(data);
      lastLoadedAt=Date.now();
    }catch(error){
      els.error.textContent=error?.message || "브리핑을 불러오지 못했습니다.";
      els.card.classList.add("has-error");
    }finally{
      setLoading(false);
    }
  }

  els.refresh?.addEventListener("click",()=>refreshBriefing({promptIfMissing:true}));

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && Date.now()-lastLoadedAt>30*60*1000){
      refreshBriefing({promptIfMissing:false});
    }
  });

  refreshBriefing({promptIfMissing:true});
})();
