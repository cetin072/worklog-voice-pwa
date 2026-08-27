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
    error:$("briefingError"),
    result:$("result")
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

  function formatDate(day){
    if(!day) return "";
    const [y,m,d]=day.split("-");
    return `${Number(m)}/${Number(d)}`;
  }

  function itemHtml(item,{showDate=false}={}){
    const due=showDate && item.dueDate ? `<span class="briefing-date">${escapeHtml(formatDate(item.dueDate))}</span>` : "";
    const institution=`<span class="briefing-tag">${escapeHtml(institutionLabel(item.institution))}</span>`;
    const reason=item.reason ? `<small>${escapeHtml(item.reason)}</small>` : "";
    return `<li>${due}<div><strong>${escapeHtml(item.title)}</strong><div class="briefing-sub">${institution}${reason}</div></div></li>`;
  }

  function renderList(target,items,emptyText,options={}){
    if(!target) return;
    if(!items?.length){
      target.innerHTML=`<li class="briefing-empty">${escapeHtml(emptyText)}</li>`;
      return;
    }
    target.innerHTML=items.map(item=>itemHtml(item,options)).join("");
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
    const counts=data.counts || {};
    els.title.textContent=data.top?.length ? "오늘 먼저 할 일" : "오늘 우선 업무 없음";

    const meta=[];
    if(Number.isFinite(counts.totalOpen)) meta.push(`미완료 ${counts.totalOpen}건`);
    if(counts.overdue) meta.push(`기한 지남 ${counts.overdue}건`);
    if(counts.today) meta.push(`오늘 일정 ${counts.today}건`);
    if(counts.checking) meta.push(`확인 필요 ${counts.checking}건`);
    els.meta.textContent=meta.join(" · ") || "Notion 최신 업무 기준";

    renderList(els.top,data.top,"지금 우선 처리할 미완료 업무가 없습니다.");
    renderList(els.today,data.todayItems,"오늘 기한으로 잡힌 일정이 없습니다.",{showDate:true});
    renderList(els.upcoming,data.upcoming,"14일 안에 잡힌 일정이 없습니다.",{showDate:true});
    els.error.textContent="";
    els.card.classList.remove("has-error");
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

  if(els.result){
    const observer=new MutationObserver(()=>{
      if(els.result.textContent.includes("Notion에 저장 완료")){
        setTimeout(()=>refreshBriefing({promptIfMissing:false}),500);
      }
    });
    observer.observe(els.result,{childList:true,characterData:true,subtree:true});
  }

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState==="visible" && Date.now()-lastLoadedAt>5*60*1000){
      refreshBriefing({promptIfMissing:false});
    }
  });

  refreshBriefing({promptIfMissing:true});
})();
