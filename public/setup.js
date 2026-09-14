(()=>{
  const tokenInput=document.getElementById("notionToken");
  const organizationInput=document.getElementById("organization");
  const connectButton=document.getElementById("connect");
  const result=document.getElementById("setupResult");
  const completeNote=document.getElementById("completeNote");
  const alreadyConnected=document.getElementById("alreadyConnected");
  let completed=false;

  function show(message,kind=""){
    result.textContent=message;
    result.className=`setup-result ${kind}`.trim();
  }

  if(window.WorklogAuth?.hasPersonal?.() && alreadyConnected){
    alreadyConnected.classList.add("show");
  }

  connectButton.addEventListener("click",async()=>{
    if(completed){
      location.href="/";
      return;
    }

    const token=String(tokenInput.value || "").trim();
    const organization=String(organizationInput.value || "회사").trim() || "회사";

    if(!token){
      show("1번에서 만든 Notion 토큰을 먼저 붙여넣어 주세요.","error");
      tokenInput.focus();
      return;
    }

    connectButton.disabled=true;
    connectButton.textContent="Notion 연결 중…";
    show("업무 저장 공간을 만드는 중입니다. 화면을 닫지 말고 잠시 기다려 주세요.");

    try{
      const res=await fetch("/api/setup",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({token,organization})
      });
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "Notion 연결에 실패했습니다. 토큰과 Notion API 권한을 확인한 뒤 다시 시도해 주세요.");

      window.WorklogAuth.savePersonal({
        token,
        dataSourceId:data.dataSourceId,
        briefingPageId:data.briefingPageId,
        organization:data.organization || organization
      });

      tokenInput.value="";
      completed=true;
      show("✓ 내 Notion 연결이 완료되었습니다.","success");
      if(completeNote) completeNote.classList.add("show");
      if(alreadyConnected) alreadyConnected.classList.remove("show");
      connectButton.textContent="업무수첩 시작";
      connectButton.disabled=false;
    }catch(error){
      show(error?.message || "Notion 연결에 실패했습니다. 토큰과 Notion API 권한을 확인한 뒤 다시 시도해 주세요.","error");
      connectButton.disabled=false;
      connectButton.textContent="4. 연결하고 업무수첩 만들기";
    }
  });
})();
