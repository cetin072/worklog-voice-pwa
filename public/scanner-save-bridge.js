(()=>{
  const SENTINEL="\u2063";
  const followUp=document.getElementById("followUp");
  const save=document.getElementById("save");
  const mic=document.getElementById("mic");
  const typedSave=document.getElementById("typedSave");
  const removeScan=document.getElementById("scanPreviewRemove");
  if(!followUp || !save) return;

  function markSingleRecord(){
    if(window.WorklogScanner?.hasPending?.() && !followUp.value) followUp.value=SENTINEL;
  }

  save.addEventListener("click",markSingleRecord,true);
  typedSave?.addEventListener("click",markSingleRecord,true);
  mic?.addEventListener("click",()=>{
    if(mic.classList.contains("listening")) markSingleRecord();
  },true);

  followUp.addEventListener("focus",()=>{
    if(followUp.value===SENTINEL) followUp.value="";
  });
  removeScan?.addEventListener("click",()=>{
    if(followUp.value===SENTINEL) followUp.value="";
  });

  const previousFetch=window.fetch.bind(window);
  window.fetch=(input,init={})=>{
    const url=typeof input==="string" ? input : String(input?.url || "");
    const method=String(init?.method || (input instanceof Request ? input.method : "GET")).toUpperCase();
    if(!url.includes("/api/worklog") || method!=="POST" || typeof init?.body!=="string"){
      return previousFetch(input,init);
    }

    let body;
    try{ body=JSON.parse(init.body); }
    catch{ return previousFetch(input,init); }
    if(body?.followUp!==SENTINEL) return previousFetch(input,init);

    body.followUp="";
    return previousFetch(input,{...init,body:JSON.stringify(body)});
  };
})();
