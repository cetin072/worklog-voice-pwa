(()=>{
  const tracked=["institution","status","type"]
    .map(id=>document.getElementById(id))
    .filter(Boolean);

  if(!tracked.length) return;

  function reset(){
    tracked.forEach(el=>delete el.dataset.userTouched);
  }

  tracked.forEach(el=>{
    el.addEventListener("change",()=>{ el.dataset.userTouched="1"; });
  });

  const baseInfer=window.infer;
  if(typeof baseInfer==="function"){
    window.infer=(text)=>{
      const preserved=new Map();
      tracked.forEach(el=>{
        // Institution is never auto-confirmed. Until a visible user control exists,
        // keep the current value rather than letting legacy inference assign it.
        if(el.id==="institution" || el.dataset.userTouched==="1") preserved.set(el,el.value);
      });
      baseInfer(text);
      preserved.forEach((value,el)=>{ el.value=value; });
    };
  }

  const nativeFetch=window.fetch?.bind(window);
  if(typeof nativeFetch==="function"){
    window.fetch=async(input,init)=>{
      const requestMethod=typeof Request!=="undefined" && input instanceof Request ? input.method : "GET";
      const method=String(init?.method || requestMethod).toUpperCase();
      const url=typeof input==="string" ? input : String(input?.url || "");
      const isWorklogPost=method==="POST" && /(?:^|\/)api\/worklog(?:$|[?#])/.test(url);
      if(!isWorklogPost || typeof init?.body!=="string") return nativeFetch(input,init);

      try{
        const payload=JSON.parse(init.body);
        if(payload && typeof payload==="object" && !Array.isArray(payload)){
          const institution=document.getElementById("institution");
          const userSelected=institution?.dataset.userTouched==="1";
          payload.institution=userSelected ? String(payload.institution || "").trim() : "";
          payload.institutionSource=userSelected ? "user_selected" : "unverified";
          return nativeFetch(input,{...init,body:JSON.stringify(payload)});
        }
      }catch{}
      return nativeFetch(input,init);
    };
  }

  const clear=document.getElementById("clear");
  clear?.addEventListener("click",()=>queueMicrotask(reset));

  const result=document.getElementById("result");
  if(result){
    const observer=new MutationObserver(()=>{
      if(result.classList.contains("success")) reset();
    });
    observer.observe(result,{attributes:true,attributeFilter:["class"],childList:true,subtree:true});
  }

  window.WorklogInferenceGuard={
    isTouched:(id)=>document.getElementById(id)?.dataset.userTouched==="1",
    fieldSource:(id)=>document.getElementById(id)?.dataset.userTouched==="1" ? "user_selected" : "unverified",
    reset
  };
})();
