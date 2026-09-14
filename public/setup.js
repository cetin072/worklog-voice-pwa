(()=>{
  const tokenInput=document.getElementById("notionToken");
  const organizationInput=document.getElementById("organization");
  const connectButton=document.getElementById("connect");
  const result=document.getElementById("setupResult");
  const completeNote=document.getElementById("completeNote");
  const alreadyConnected=document.getElementById("alreadyConnected");
  let completed=false;

  if(window.WorklogAuth?.hasPersonal?.() && alreadyConnected){
    alreadyConnected.classList.add("show");
  }

  function show(message,kind=""){
    result.textContent=message;
    result.className=`setup-result ${kind}`.trim();
  }

  connectButton.addEventListener("click",async()=>{
    if(completed){
      location.href="/";
      return;
    }

    const token=String(tokenInput.value || "").trim();
    const organization=String(organizationInput.value || "").trim();

    if(!token){
      show("1번에서 만든 Notion 토큰을 먼저 붙여넣어 주세요.","error");
      tokenInput.focus();
      return;
    }
    if(!organization){
      show("기본 기관명을 입력해 주세요. 회사 업무면 회사·기관 이름, 개인용이면 ‘개인’이라고 입력하면 됩니다.","error");
      organizationInput.focus();
      return;
    }

    connectButton.disabled=true;
    connectButton.textContent="Notion 연결 중…";
    show("📒 업무수첩 상위 페이지와 그 안의 업무 기록 DB를 만드는 중입니다. 잠시만 기다려 주세요.");

    try{
      const res=await fetch("/api/setup",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token,organization})
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "Notion 자동 설정에 실패했습니다.");

      window.WorklogAuth.savePersonal({
        token,
        dataSourceId:data.dataSourceId,
        briefingPageId:data.briefingPageId,
        organization:data.organization || organization
      });

      tokenInput.value="";
      completed=true;
      show("✓ Notion 연결 완료. 📒 업무수첩 아래에 업무 기록 DB를 만들었습니다.","success");
      if(completeNote) completeNote.classList.add("show");
      if(alreadyConnected) alreadyConnected.classList.add("show");
      connectButton.textContent="업무수첩 시작";
      connectButton.disabled=false;
    }catch(error){
      show(`${error?.message || "Notion 연결에 실패했습니다."} 토큰·워크스페이스·Notion API 권한을 확인한 뒤 다시 시도해 주세요.`,"error");
      connectButton.disabled=false;
      connectButton.textContent="4. 연결하고 업무수첩 만들기";
    }
  });
})();
