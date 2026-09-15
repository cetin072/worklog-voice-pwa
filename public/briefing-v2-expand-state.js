(()=>{
  const root=document.getElementById("briefingV2");
  if(!root) return;

  const MAX_VISIBLE=3;
  const PREF_KEY="worklogUiPreferencesV1";
  const expandedSections=new Set();
  const collapsedSections=new Set();

  function prefersExpanded(){
    try{
      return JSON.parse(localStorage.getItem(PREF_KEY) || "{}")?.briefingExpanded===true;
    }catch{
      return false;
    }
  }

  function applyExpandedState(){
    const expandByDefault=prefersExpanded();
    root.querySelectorAll(".briefing-v2-section").forEach(section=>{
      const kind=section.dataset.section || "";
      if(!kind) return;

      const toggle=section.querySelector(".briefing-v2-more-toggle");
      if(!toggle) return;

      const shouldExpand=expandedSections.has(kind) || (expandByDefault && !collapsedSections.has(kind));
      if(!shouldExpand) return;

      const rows=[...section.querySelectorAll(".briefing-v2-list > li")];
      rows.forEach((row,index)=>{
        if(index>=MAX_VISIBLE) row.hidden=false;
      });
      toggle.setAttribute("aria-expanded","true");
      toggle.textContent="접기";
    });
  }

  root.addEventListener("click",event=>{
    const button=event.target.closest?.(".briefing-v2-more-toggle");
    if(!button || !root.contains(button)) return;

    const kind=button.dataset.sectionToggle || "";
    if(!kind) return;

    if(button.getAttribute("aria-expanded")==="true"){
      expandedSections.add(kind);
      collapsedSections.delete(kind);
    }else{
      expandedSections.delete(kind);
      collapsedSections.add(kind);
    }
  });

  window.addEventListener("worklog:ui-preferences-changed",()=>{
    expandedSections.clear();
    collapsedSections.clear();
    applyExpandedState();
  });

  const observer=new MutationObserver(()=>applyExpandedState());
  observer.observe(root,{childList:true});
})();
