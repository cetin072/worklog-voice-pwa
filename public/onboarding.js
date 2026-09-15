(()=>{
  function hasPlatformSession(){
    const session=window.WorklogPlatformAuth?.readSession?.();
    return Boolean(session?.access_token);
  }

  function guideUnauthenticatedSave(event){
    const target=event.target instanceof Element ? event.target.closest("#save,#typedSave") : null;
    if(!target) return;

    if(window.WorklogAuth && window.WorklogAuth.mode()!=="unset") return;
    if(hasPlatformSession()) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const result=document.getElementById("result");
    if(result){
      result.textContent="먼저 무료로 시작하거나 로그인해주세요. 가입하면 개인 업무공간이 자동으로 만들어집니다.";
      result.className="result error";
    }

    const card=document.getElementById("platformAuthCard");
    card?.scrollIntoView({behavior:"smooth",block:"center"});
    setTimeout(()=>document.getElementById("platformAuthEmail")?.focus(),350);
  }

  document.addEventListener("click",guideUnauthenticatedSave,true);
})();
