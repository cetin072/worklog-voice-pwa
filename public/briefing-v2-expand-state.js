(()=>{
  const card=document.getElementById("briefingCard");
  const toggle=document.getElementById("briefingCardToggle");
  if(!card || !toggle) return;

  const PREF_KEY="worklogUiPreferencesV1";

  function prefersCollapsed(){
    try{
      const fromApi=window.WorklogUiPreferences?.read?.();
      if(fromApi && typeof fromApi.briefingCollapsed==="boolean") return fromApi.briefingCollapsed;
      return JSON.parse(localStorage.getItem(PREF_KEY) || "{}")?.briefingCollapsed===true;
    }catch{
      return false;
    }
  }

  function setCollapsed(collapsed){
    card.classList.toggle("is-collapsed",collapsed);
    toggle.setAttribute("aria-expanded",String(!collapsed));
    toggle.textContent=collapsed ? "펼치기" : "접기";
  }

  toggle.addEventListener("click",()=>{
    setCollapsed(!card.classList.contains("is-collapsed"));
  });

  window.addEventListener("worklog:ui-preferences-changed",event=>{
    const next=event?.detail?.briefingCollapsed;
    setCollapsed(typeof next==="boolean" ? next : prefersCollapsed());
  });

  setCollapsed(prefersCollapsed());
})();
