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
        if(el.dataset.userTouched==="1") preserved.set(el,el.value);
      });
      baseInfer(text);
      preserved.forEach((value,el)=>{ el.value=value; });
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
    reset
  };
})();
