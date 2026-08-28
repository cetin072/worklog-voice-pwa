(()=>{
  const wrap=document.getElementById("kakaoDelivery");
  const button=document.getElementById("kakaoBriefingAction");
  const statusText=document.getElementById("kakaoBriefingStatus");
  if(!wrap || !button || !statusText) return;

  let status=null;
  let busy=false;

  function ownerHeaders({promptOwner=false}={}){
    if(window.WorklogAuth?.mode?.()==="personal") return {};
    if(window.WorklogAuth?.getHeaders){
      const headers=window.WorklogAuth.getHeaders({promptOwner});
      return headers?.["x-worklog-key"] ? {"x-worklog-key":headers["x-worklog-key"]} : {};
    }
    let key=localStorage.getItem("worklogAccessKey") || "";
    if(!key && promptOwner){
      key=(window.prompt("개인 접근키를 입력하세요.") || "").trim();
      if(key) localStorage.setItem("worklogAccessKey",key);
    }
    return key ? {"x-worklog-key":key} : {};
  }

  function render(){
    if(window.WorklogAuth?.mode?.()==="personal"){
      wrap.hidden=true;
      return;
    }
    wrap.hidden=false;

    if(!status){
      button.disabled=busy;
      button.textContent=busy ? "확인 중…" : "카카오 연결";
      statusText.textContent="내 카카오톡으로 브리핑을 받을 수 있습니다.";
      return;
    }
    if(!status.production){
      button.disabled=true;
      button.textContent="운영판에서 연결";
      statusText.textContent="카카오 계정 연결은 운영판에서 진행합니다.";
      return;
    }
    if(!status.configured){
      button.disabled=true;
      button.textContent="카카오 설정 필요";
      statusText.textContent="카카오 Developers 앱 키 설정이 필요합니다.";
      return;
    }
    if(status.linked){
      button.disabled=busy;
      button.textContent=busy ? "전송 중…" : "카톡으로 보내기";
      statusText.textContent=status.autoSend
        ? "연결됨 · 오전/오후 브리핑 자동 전송"
        : "연결됨";
      return;
    }
    button.disabled=busy;
    button.textContent=busy ? "연결 준비 중…" : "카카오 연결";
    statusText.textContent="한 번 연결하면 오전/오후 브리핑도 자동 전송됩니다.";
  }

  function showMessage(message,isError=false){
    statusText.textContent=message;
    statusText.classList.toggle("is-error",Boolean(isError));
  }

  async function loadStatus({promptOwner=false}={}){
    const headers=ownerHeaders({promptOwner});
    if(!Object.keys(headers).length){
      status=null;
      render();
      return null;
    }
    busy=true;
    render();
    try{
      const res=await fetch("/api/kakao",{method:"GET",headers,cache:"no-store"});
      const data=await res.json().catch(()=>({}));
      if(!res.ok) throw new Error(data.error || "카카오 상태를 확인하지 못했습니다.");
      status=data;
      statusText.classList.remove("is-error");
      return data;
    }catch(error){
      status=null;
      showMessage(error?.message || "카카오 상태를 확인하지 못했습니다.",true);
      return null;
    }finally{
      busy=false;
      render();
    }
  }

  async function postAction(action){
    const headers=ownerHeaders({promptOwner:true});
    if(!Object.keys(headers).length) throw new Error("개인 접근키가 필요합니다.");
    const res=await fetch("/api/kakao",{
      method:"POST",
      headers:{...headers,"content-type":"application/json"},
      body:JSON.stringify({action}),
      cache:"no-store"
    });
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.error || "카카오 요청에 실패했습니다.");
    return data;
  }

  async function handleClick(){
    if(busy) return;
    statusText.classList.remove("is-error");
    if(!status){
      await loadStatus({promptOwner:true});
      if(!status) return;
    }
    if(!status.production || !status.configured) return;

    busy=true;
    render();
    try{
      if(status.linked){
        await postAction("send_current");
        showMessage("현재 브리핑을 내 카카오톡으로 보냈습니다.");
      }else{
        const data=await postAction("authorize");
        if(!data.authorizeUrl) throw new Error("카카오 연결 주소를 만들지 못했습니다.");
        window.location.assign(data.authorizeUrl);
        return;
      }
    }catch(error){
      showMessage(error?.message || "카카오톡 처리에 실패했습니다.",true);
    }finally{
      busy=false;
      render();
    }
  }

  const params=new URLSearchParams(window.location.search);
  const kakaoResult=params.get("kakao");
  if(kakaoResult){
    if(kakaoResult==="connected") showMessage("카카오 연결 완료 · 오전/오후 자동 전송이 켜졌습니다.");
    else showMessage("카카오 연결에 실패했습니다. 다시 시도해주세요.",true);
    params.delete("kakao");
    const next=`${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    history.replaceState(null,"",next);
  }

  button.addEventListener("click",handleClick);
  if(window.WorklogAuth?.mode?.()==="personal") render();
  else loadStatus({promptOwner:false});
})();
