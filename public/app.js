const $ = (id) => document.getElementById(id);
const els = {
  mic:$("mic"), micText:$("micText"), hint:$("hint"), text:$("text"),
  institution:$("institution"), status:$("status"), type:$("type"),
  amount:$("amount"), assignee:$("assignee"), dueDate:$("dueDate"),
  followUp:$("followUp"), save:$("save"), clear:$("clear"),
  result:$("result"), health:$("health")
};

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null;
let recognitionActive = false;
let keepListening = false;
let restartTimer = null;
let persistentText = "";

function result(msg="", kind=""){
  els.result.textContent = msg;
  els.result.className = `result ${kind}`.trim();
}

function infer(text){
  const s = text.trim();
  if(s.includes("태장")) els.institution.value = "태장";
  else if(s.includes("미래원") || s.includes("미래여성가족")) els.institution.value = "미래여성가족진흥원";

  const done = /(완료|마무리|처리했|보냈|전달했|확인했|송금했|끝냈|했음|하였음)/.test(s);
  const future = /(내일|해야|예정|필요|확인해야|요청해야|추후|다음 주|다음주)/.test(s);

  els.status.value = done ? "완료" : future ? "대기" : "진행중";

  if (/(송금|지출|세금|원천징수|비용|결제)/.test(s)) els.type.value = "지출·세무";
  else if (/(회의|미팅|통화|전화)/.test(s)) els.type.value = "회의·통화";
  else if (/(요청|지시|위임)/.test(s)) els.type.value = "지시·위임";
  else if (/(아이디어|생각|검토안)/.test(s)) els.type.value = "아이디어";
  else if (/(문제|오류|누수|확인해야)/.test(s)) els.type.value = "문제·확인";
  else if (done) els.type.value = "완료업무";
  else if (future) els.type.value = "할 일";
  else els.type.value = "기타";
}

function getAccessKey(){
  let key = localStorage.getItem("worklogAccessKey") || "";
  if(!key){
    key = (prompt("개인 접근키를 한 번 입력하세요.") || "").trim();
    if(key) localStorage.setItem("worklogAccessKey", key);
  }
  return key;
}

function setListeningUI(){
  els.mic.classList.add("listening");
  els.micText.textContent="중지하기";
  els.hint.textContent="천천히 말씀하세요. 잠시 말이 없어도 계속 기다립니다.";
}

function setStoppedUI(){
  recognitionActive=false;
  els.mic.classList.remove("listening");
  els.micText.textContent="말하기";
  els.hint.textContent="버튼을 누르면 다시 누를 때까지 계속 듣습니다.";
}

function cancelRestart(){
  if(restartTimer){
    clearTimeout(restartTimer);
    restartTimer=null;
  }
}

function startRecognition(){
  if(!recognition || !keepListening || recognitionActive) return;
  if(document.visibilityState !== "visible"){
    els.hint.textContent="앱으로 돌아오면 계속 듣습니다.";
    return;
  }

  cancelRestart();
  try{
    recognition.start();
  }catch(error){
    if(error?.name === "InvalidStateError") return;
    keepListening=false;
    setStoppedUI();
    result("음성인식을 다시 시작하지 못했습니다. 말하기 버튼을 다시 눌러주세요.", "error");
  }
}

function scheduleRestart(){
  if(!keepListening || restartTimer) return;
  restartTimer=setTimeout(()=>{
    restartTimer=null;
    startRecognition();
  }, 450);
}

if(SpeechRecognition){
  recognition = new SpeechRecognition();
  recognition.lang="ko-KR";
  recognition.interimResults=true;
  recognition.continuous=true;

  recognition.onstart=()=>{
    recognitionActive=true;
    setListeningUI();
    result();
  };

  recognition.onresult=(event)=>{
    let finalChunk="";
    let interim="";

    for(let i=event.resultIndex;i<event.results.length;i++){
      const t=event.results[i][0].transcript.trim();
      if(!t) continue;
      if(event.results[i].isFinal) finalChunk += `${t} `;
      else interim += `${t} `;
    }

    if(finalChunk.trim()){
      persistentText = [persistentText, finalChunk.trim()].filter(Boolean).join(" ").trim();
    }

    const displayText=[persistentText, interim.trim()].filter(Boolean).join(" ").trim();
    if(displayText){
      els.text.value=displayText;
      infer(displayText);
    }
  };

  recognition.onerror=(event)=>{
    recognitionActive=false;

    if(event.error === "no-speech"){
      els.hint.textContent="계속 듣는 중입니다. 편하게 이어서 말씀하세요.";
      return;
    }

    if(event.error === "aborted" && !keepListening) return;

    const fatalErrors = new Set([
      "not-allowed",
      "service-not-allowed",
      "audio-capture",
      "language-not-supported"
    ]);

    if(fatalErrors.has(event.error)){
      keepListening=false;
      cancelRestart();
      setStoppedUI();
      result(`음성인식 오류: ${event.error}. 마이크 권한을 확인해주세요.`, "error");
      return;
    }

    if(event.error === "network"){
      keepListening=false;
      cancelRestart();
      setStoppedUI();
      result("음성인식 네트워크 오류가 발생했습니다. 말하기 버튼을 다시 눌러주세요.", "error");
    }
  };

  recognition.onend=()=>{
    recognitionActive=false;
    if(keepListening){
      els.hint.textContent="계속 듣는 중입니다. 잠시 쉬었다가 말씀하셔도 됩니다.";
      scheduleRestart();
    }else{
      setStoppedUI();
    }
  };

  els.mic.onclick=()=>{
    if(keepListening){
      keepListening=false;
      cancelRestart();
      try{
        if(recognitionActive) recognition.stop();
      }catch{}
      setStoppedUI();
      els.hint.textContent="인식 결과를 확인하고 저장하세요.";
      return;
    }

    persistentText=els.text.value.trim();
    keepListening=true;
    setListeningUI();
    startRecognition();
  };

  document.addEventListener("visibilitychange",()=>{
    if(document.visibilityState === "visible" && keepListening && !recognitionActive){
      scheduleRestart();
    }
  });
}else{
  els.hint.textContent="브라우저 직접 음성인식이 없어 키보드 음성입력을 사용합니다.";
  els.mic.onclick=()=>els.text.focus();
}

els.text.addEventListener("input",()=>{
  if(!keepListening) persistentText=els.text.value.trim();
  if(els.text.value.trim()) infer(els.text.value);
});

els.clear.onclick=()=>{
  keepListening=false;
  cancelRestart();
  try{
    if(recognitionActive) recognition?.stop();
  }catch{}
  persistentText="";
  setStoppedUI();
  els.text.value=""; els.amount.value=""; els.assignee.value="";
  els.dueDate.value=""; els.followUp.value="";
  els.institution.value="기타"; els.status.value="진행중"; els.type.value="기타";
  result("");
};

els.save.onclick=async()=>{
  const transcript=els.text.value.trim();
  if(!transcript){ result("먼저 업무 내용을 말하거나 입력하세요.","error"); return; }

  if(keepListening){
    keepListening=false;
    cancelRestart();
    try{
      if(recognitionActive) recognition?.stop();
    }catch{}
    setStoppedUI();
  }

  const key=getAccessKey();
  if(!key){ result("개인 접근키가 필요합니다.","error"); return; }

  els.save.disabled=true;
  els.save.textContent="저장 중…";
  result("");

  try{
    const res=await fetch("/api/worklog",{
      method:"POST",
      headers:{"content-type":"application/json","x-worklog-key":key},
      body:JSON.stringify({
        transcript,
        institution:els.institution.value,
        status:els.status.value,
        type:els.type.value,
        amount:els.amount.value ? Number(els.amount.value) : null,
        assignee:els.assignee.value.trim(),
        dueDate:els.dueDate.value || null,
        followUp:els.followUp.value.trim(),
        recordedAt:new Date().toISOString()
      })
    });
    const data=await res.json().catch(()=>({}));
    if(res.status===401){
      localStorage.removeItem("worklogAccessKey");
      throw new Error("개인 접근키가 맞지 않습니다. 다시 저장하면 새로 입력할 수 있습니다.");
    }
    if(!res.ok) throw new Error(data.error || "저장에 실패했습니다.");

    result("✓ Notion에 저장 완료","success");
    persistentText="";
    els.text.value=""; els.amount.value=""; els.assignee.value="";
    els.dueDate.value=""; els.followUp.value="";
    els.institution.value="기타"; els.status.value="진행중"; els.type.value="기타";
  }catch(e){
    result(e.message || "저장에 실패했습니다.","error");
  }finally{
    els.save.disabled=false;
    els.save.textContent="Notion에 저장";
  }
};

(async()=>{
  try{
    const res=await fetch("/api/worklog");
    const data=await res.json();
    els.health.textContent = data.ok ? "연결 준비" : "설정 필요";
  }catch{
    els.health.textContent="확인 필요";
  }
})();

if("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
