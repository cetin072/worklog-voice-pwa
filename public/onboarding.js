(()=>{
  function redirectIfUnconfigured(event){
    const target=event.target instanceof Element ? event.target.closest("#save,#typedSave") : null;
    if(!target) return;
    if(!window.WorklogAuth || window.WorklogAuth.mode()!=="unset") return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const result=document.getElementById("result");
    if(result){
      result.textContent="Notion 연결이 먼저 필요합니다. 연결 화면으로 이동합니다.";
      result.className="result error";
    }

    setTimeout(()=>{ location.href="/setup.html"; },150);
  }

  document.addEventListener("click",redirectIfUnconfigured,true);
})();
