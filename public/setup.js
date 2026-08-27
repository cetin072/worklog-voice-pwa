(()=>{
  const tokenInput=document.getElementById("notionToken");
  const organizationInput=document.getElementById("organization");
  const connectButton=document.getElementById("connect");
  const result=document.getElementById("setupResult");
  let completed=false;

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
    const organization=String(organizationInput.value || "회사").trim() || "회사";

    if(!token){
      show("Notion 토큰을 먼저 붙여넣어 주세요.","error");
      tokenInput.focus();
      return;
    }

    connectButton.disabled=true;
    connectButton.textContent="Notion 설정 중…";
    show("개인 업무 공간을 만드는 중입니다.");

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
      show("✓ 설정 완료. 이제 녹음해서 바로 저장할 수 있습니다.","success");
      connectButton.textContent="업무기록 시작";
      connectButton.disabled=false;
    }catch(error){
      show(error?.message || "Notion 자동 설정에 실패했습니다.","error");
      connectButton.disabled=false;
      connectButton.textContent="4. 내 Notion 자동 설정";
    }
  });
})();
