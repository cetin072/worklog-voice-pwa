(()=>{
  const wrap=document.getElementById("kakaoDelivery");
  const button=document.getElementById("kakaoBriefingAction");
  const statusText=document.getElementById("kakaoBriefingStatus");
  if(!wrap || !button || !statusText) return;

  let status=null;
  let busy=false;
  let notice=null;

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

  function formatRunTime(value){
    if(!value) return "";
    try{
      return new Intl.DateTimeFormat("ko-KR",{
        timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"
      }).format(new Date(value));
    }catch{ return ""; }
  }

  function runReasonLabel(reason){
    const labels={
      "period-mismatch":"브리핑 종류 불일치",
      stale:"브리핑 생성 지연",
      "not-linked":"카카오 연결 필요",
      "auto-disabled":"자동전송 꺼짐",
      BRIEFING_NOT_READY:"브리핑 준비 안 됨",
      KAKAO_REFRESH_FAILED:"카카오 연결 갱신 실패",
      KAKAO_SEND_FAILED:"카카오 전송 실패"
    };
    return labels[reason] || "전송 실패";
  }

  function latestRun(){
    const runs=status?.lastRuns || {};
    const entries=[
      ["오전",runs.morning],
      ["오후",runs.afternoon]
    ].filter(([,run])=>run?.attemptedAt);
    entries.sort((a,b)=>Date.parse(b[1].attemptedAt)-Date.parse(a[1].attemptedAt));
    return entries[0] || null;
  }

  function automaticStatusText(){
    const latest=latestRun();
    if(!latest) return {text:"연결됨 · 하루 2회 브리핑 자동 전송",error:false};
    const [label,run]=latest;
    const when=formatRunTime(run.attemptedAt);
    if(run.status==="sent"){
      return {text:`연결됨 · 최근 ${label} ${when} 전송 완료`,error:false};
    }
    return {text:`연결됨 · ⚠ 최근 ${label} 자동전송 ${runReasonLabel(run.reason)}${when ? ` · ${when}` : ""}`,error:true};
  }

  function render(){
    if(window.WorklogAuth?.mode?.()==="personal"){
      wrap.hidden=true;
      return;
    }
    wrap.hidden=false;

    let text="";
    let error=false;

    if(!status){
      button.disabled=busy;
      button.textContent=busy ? "확인 중…" : "카카오 연결";
      text="내 카카오톡으로 브리핑을 받을 수 있습니다.";
    }else if(!status.production){
      button.disabled=true;
      button.textContent="운영판에서 연결";
      text="카카오 계정 연결과 전송은 운영판에서 진행합니다.";
    }else if(!status.configured){
      button.disabled=true;
      button.textContent="카카오 설정 필요";
      text="카카오 Developers 앱 키 설정이 필요합니다.";
    }else if(status.linked){
      button.disabled=busy;
      button.textContent=busy ? "전송 중…" : "카톡으로 보내기";
      if(status.autoSend){
        const summary=automaticStatusText();
        text=summary.text;
        error=summary.error;
      }else{
        text="연결됨";
      }
    }else{
      button.disabled=busy;
      button.textContent=busy ? "연결 준비 중…" : "카카오 연결";
      text="한 번 연결하면 오전 8시·오후 2시 브리핑도 자동 전송됩니다.";
    }

    if(notice){
      text=notice.message;
      error=notice.isError;
    }
    statusText.textContent=text;
    statusText.classList.toggle("is-error",Boolean(error));
  }

  function showMessage(message,isError=false){
    notice={message,isError:Boolean(isError)};
    render();
  }

  async function loadStatus({promptOwner=false,preserveNotice=false}={}){
    const headers=ownerHeaders({promptOwner});
    if(!Object.keys(headers).length){
      status=null;
      if(!preserveNotice) notice=null;
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
      if(!preserveNotice) notice=null;
      return data;
    }catch(error){
      status=null;
      notice={message:error?.message || "카카오 상태를 확인하지 못했습니다.",isError:true};
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
    notice=null;
    if(!status){
      await loadStatus({promptOwner:true});
      if(!status) return;
    }
    if(!status.production || !status.configured) return;

    busy=true;
    render();
    try{
      if(status.linked){
        const result=await postAction("send_current");
        const count=Number(result?.messageCount || 1);
        showMessage(count>1
          ? `현재 브리핑을 카카오톡 ${count}개 메시지로 나눠 보냈습니다.`
          : "현재 브리핑을 내 카카오톡으로 보냈습니다.");
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
    if(kakaoResult==="connected") notice={message:"카카오 연결 완료 · 하루 2회 자동 전송이 켜졌습니다.",isError:false};
    else notice={message:"카카오 연결에 실패했습니다. 다시 시도해주세요.",isError:true};
    params.delete("kakao");
    const next=`${window.location.pathname}${params.toString() ? `?${params}` : ""}${window.location.hash}`;
    history.replaceState(null,"",next);
  }

  button.addEventListener("click",handleClick);
  if(window.WorklogAuth?.mode?.()==="personal") render();
  else loadStatus({promptOwner:false,preserveNotice:Boolean(kakaoResult)});
})();