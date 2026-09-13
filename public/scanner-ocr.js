(()=>{
  const $=id=>document.getElementById(id);
  const previewImage=$("scanPreviewImage");
  const previewRemove=$("scanPreviewRemove");
  const readButton=$("scanOcrRead");
  const status=$("scanOcrStatus");
  const resultBox=$("scanOcrResult");
  const textArea=$("scanOcrText");
  const useButton=$("scanOcrUse");
  const clearButton=$("scanOcrClear");
  const workText=$("text");
  const entryCard=$("entryCard");
  if(!previewImage||!readButton||!status||!resultBox||!textArea||!useButton||!clearButton||!workText)return;

  const TESSERACT_SCRIPT="/vendor/tesseract/tesseract.min.js";
  const WORKER_PATH="/vendor/tesseract/worker.min.js";
  const CORE_PATH="/vendor/tesseract-core";
  const LANG_PATH="/vendor/tessdata";
  let scriptPromise=null;
  let running=false;
  let lastPreviewSrc="";

  function setStatus(message,kind=""){
    status.textContent=message;
    status.className=`scan-ocr-status ${kind}`.trim();
  }

  function normalizeOcr(value){
    return String(value||"")
      .replace(/\r/g,"")
      .split("\n")
      .map(line=>line.replace(/[\t ]+/g," ").trim())
      .filter((line,index,lines)=>line || (index>0 && lines[index-1]))
      .join("\n")
      .replace(/\n{3,}/g,"\n\n")
      .trim();
  }

  function errorText(error){
    if(error instanceof Error && error.message)return error.message;
    if(typeof error==="string" && error.trim())return error.trim();
    try{
      const value=String(error?.message||error||"").trim();
      return value && value!=="[object Object]" ? value : "";
    }catch{return "";}
  }

  function resetOcr(message="스캔 이미지를 휴대폰에서 읽습니다. OCR API 비용은 없습니다."){
    textArea.value="";
    resultBox.hidden=true;
    setStatus(message);
    readButton.disabled=false;
    readButton.textContent="🔎 문서 내용 읽기";
  }

  function loadTesseract(){
    if(window.Tesseract?.createWorker)return Promise.resolve(window.Tesseract);
    if(scriptPromise)return scriptPromise;
    scriptPromise=new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(script=>script.src.endsWith(TESSERACT_SCRIPT));
      if(existing){
        const started=Date.now();
        const wait=()=>{
          if(window.Tesseract?.createWorker)return resolve(window.Tesseract);
          if(Date.now()-started>12000)return reject(new Error("OCR 엔진을 시작하지 못했습니다."));
          setTimeout(wait,100);
        };
        wait();
        return;
      }
      const script=document.createElement("script");
      script.src=TESSERACT_SCRIPT;
      script.async=true;
      script.onload=()=>window.Tesseract?.createWorker
        ? resolve(window.Tesseract)
        : reject(new Error("OCR 엔진을 시작하지 못했습니다."));
      script.onerror=()=>reject(new Error("OCR 엔진 파일을 불러오지 못했습니다."));
      document.head.appendChild(script);
    }).catch(error=>{
      scriptPromise=null;
      throw error;
    });
    return scriptPromise;
  }

  async function previewBlob(){
    const src=previewImage.currentSrc||previewImage.src;
    if(!src)throw new Error("먼저 문서를 스캔해주세요.");
    const response=await fetch(src);
    if(!response.ok)throw new Error("스캔 이미지를 읽지 못했습니다.");
    return response.blob();
  }

  function progressLogger(message){
    if(!message||typeof message!=="object")return;
    const progress=Number(message.progress||0);
    if(message.status==="recognizing text"){
      const percent=Math.max(0,Math.min(100,Math.round(progress*100)));
      setStatus(`문서 글자를 읽는 중… ${percent}%`);
    }else if(String(message.status||"").includes("language")){
      setStatus("한글 OCR 데이터를 준비하는 중입니다…");
    }else if(String(message.status||"").includes("core") || String(message.status||"").includes("initializing")){
      setStatus("OCR 엔진을 준비하는 중입니다…");
    }
  }

  async function recognize(){
    if(running)return;
    running=true;
    readButton.disabled=true;
    readButton.textContent="읽는 중…";
    resultBox.hidden=true;
    setStatus("OCR 엔진을 준비하는 중입니다…");
    let worker=null;
    let workerFailure="";
    try{
      const Tesseract=await loadTesseract();
      const blob=await previewBlob();
      worker=await Tesseract.createWorker(["kor","eng"],1,{
        workerPath:WORKER_PATH,
        corePath:CORE_PATH,
        langPath:LANG_PATH,
        workerBlobURL:false,
        logger:progressLogger,
        errorHandler:error=>{workerFailure=errorText(error);}
      });
      const response=await worker.recognize(blob);
      const text=normalizeOcr(response?.data?.text);
      if(!text)throw new Error("읽을 수 있는 글자를 찾지 못했습니다. 문서를 더 가까이 촬영해보세요.");
      textArea.value=text;
      resultBox.hidden=false;
      const confidence=Math.round(Number(response?.data?.confidence||0));
      setStatus(confidence>0
        ? `문서 읽기 완료 · 인식 신뢰도 약 ${confidence}% · 아래 내용은 수정할 수 있습니다.`
        : "문서 읽기 완료 · 아래 내용은 수정할 수 있습니다.","success");
    }catch(error){
      const detail=errorText(error)||workerFailure;
      setStatus(detail ? `OCR 실패: ${detail}` : "문서 내용을 읽지 못했습니다. 새로고침 후 다시 시도해주세요.","error");
    }finally{
      try{await worker?.terminate?.();}catch{}
      running=false;
      readButton.disabled=false;
      readButton.textContent=textArea.value?"🔄 다시 읽기":"🔎 문서 내용 읽기";
    }
  }

  function useOcrText(){
    const ocr=normalizeOcr(textArea.value);
    if(!ocr){
      setStatus("업무 내용에 넣을 OCR 글자가 없습니다.","error");
      return;
    }
    const current=String(workText.value||"").trim();
    const combined=current ? `${current}\n\n[문서 내용]\n${ocr}` : ocr;
    if(combined.length>1800){
      workText.value=combined.slice(0,1800);
      setStatus("업무 내용 저장 한도 때문에 1,800자까지만 넣었습니다. 전체 OCR 원문은 이 칸에 남아 있습니다.","warning");
    }else{
      workText.value=combined;
      setStatus("OCR 내용을 업무 내용에 넣었습니다. 저장 전에 한번 확인해주세요.","success");
    }
    workText.dispatchEvent(new Event("input",{bubbles:true}));
    entryCard?.scrollIntoView?.({behavior:"smooth",block:"start"});
    setTimeout(()=>workText.focus({preventScroll:true}),350);
  }

  readButton.addEventListener("click",recognize);
  useButton.addEventListener("click",useOcrText);
  clearButton.addEventListener("click",()=>resetOcr());
  previewRemove?.addEventListener("click",()=>resetOcr("문서를 다시 스캔하면 OCR을 사용할 수 있습니다."));
  previewImage.addEventListener("load",()=>{
    const src=previewImage.currentSrc||previewImage.src;
    if(src && src!==lastPreviewSrc){
      lastPreviewSrc=src;
      resetOcr();
    }
  });
  window.addEventListener("pagehide",()=>{running=false;});
})();
