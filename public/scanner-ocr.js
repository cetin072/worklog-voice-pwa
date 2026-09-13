(()=>{
  const RETRY_CONFIDENCE=60;

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

  function normalizeCandidate(input={}){
    const text=normalizeOcr(input.text);
    const confidence=Math.max(0,Math.min(100,Number(input.confidence||0)));
    const meaningful=(text.match(/[0-9A-Za-z가-힣]/g)||[]).length;
    const hangul=(text.match(/[가-힣]/g)||[]).length;
    return {text,confidence,meaningful,hangul,source:String(input.source||"")};
  }

  function shouldRetry(input){
    const candidate=normalizeCandidate(input);
    return !candidate.text || candidate.confidence<RETRY_CONFIDENCE || candidate.meaningful<12;
  }

  function chooseBetter(firstInput,secondInput){
    const first=normalizeCandidate(firstInput);
    const second=normalizeCandidate(secondInput);
    if(!first.text)return second;
    if(!second.text)return first;
    if(second.confidence>=first.confidence+2)return second;
    if(second.confidence>=first.confidence-5 && second.hangul>=first.hangul+2)return second;
    if(second.confidence>=first.confidence-4 && second.meaningful>=Math.max(first.meaningful+8,Math.ceil(first.meaningful*1.2)))return second;
    return first;
  }

  function otsuThreshold(histogram,total){
    let weighted=0;
    for(let i=0;i<256;i++)weighted+=i*Number(histogram[i]||0);
    let backgroundWeight=0;
    let backgroundSum=0;
    let bestThreshold=127;
    let bestVariance=-1;
    for(let t=0;t<256;t++){
      const count=Number(histogram[t]||0);
      backgroundWeight+=count;
      if(!backgroundWeight)continue;
      const foregroundWeight=total-backgroundWeight;
      if(!foregroundWeight)break;
      backgroundSum+=t*count;
      const backgroundMean=backgroundSum/backgroundWeight;
      const foregroundMean=(weighted-backgroundSum)/foregroundWeight;
      const delta=backgroundMean-foregroundMean;
      const variance=backgroundWeight*foregroundWeight*delta*delta;
      if(variance>bestVariance){
        bestVariance=variance;
        bestThreshold=t;
      }
    }
    return bestThreshold;
  }

  window.WorklogOcrCore={RETRY_CONFIDENCE,normalizeCandidate,shouldRetry,chooseBetter,otsuThreshold};

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
  const ENHANCE_MAX_EDGE=2000;
  const ENHANCE_MAX_PIXELS=3200000;
  const ENHANCE_MAX_SCALE=2.2;
  let scriptPromise=null;
  let running=false;
  let lastPreviewSrc="";
  let ocrPass="first";

  function setStatus(message,kind=""){
    status.textContent=message;
    status.className=`scan-ocr-status ${kind}`.trim();
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
          if(Date.now()-started>12000){
            try{existing.remove();}catch{}
            return reject(new Error("OCR 엔진을 시작하지 못했습니다."));
          }
          setTimeout(wait,100);
        };
        wait();
        return;
      }
      const script=document.createElement("script");
      script.src=TESSERACT_SCRIPT;
      script.async=true;
      script.onload=()=>{
        if(window.Tesseract?.createWorker)return resolve(window.Tesseract);
        try{script.remove();}catch{}
        reject(new Error("OCR 엔진을 시작하지 못했습니다."));
      };
      script.onerror=()=>{
        try{script.remove();}catch{}
        reject(new Error("OCR 엔진 파일을 불러오지 못했습니다."));
      };
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

  async function decodeBlob(blob){
    if(typeof createImageBitmap==="function"){
      const bitmap=await createImageBitmap(blob);
      return {source:bitmap,width:bitmap.width,height:bitmap.height,close:()=>bitmap.close?.()};
    }
    const url=URL.createObjectURL(blob);
    const image=new Image();
    image.decoding="async";
    image.src=url;
    try{
      if(typeof image.decode==="function")await image.decode();
      else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error("OCR용 이미지를 준비하지 못했습니다."));});
      return {source:image,width:image.naturalWidth,height:image.naturalHeight,close:()=>URL.revokeObjectURL(url)};
    }catch(error){
      URL.revokeObjectURL(url);
      throw error;
    }
  }

  function canvasBlob(canvas){
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error("OCR용 보정 이미지를 만들지 못했습니다.")),"image/png"));
  }

  async function enhanceForOcr(blob){
    const decoded=await decodeBlob(blob);
    try{
      const width=Math.max(1,decoded.width);
      const height=Math.max(1,decoded.height);
      const edge=Math.max(width,height);
      const pixels=width*height;
      const scale=Math.max(.65,Math.min(ENHANCE_MAX_SCALE,ENHANCE_MAX_EDGE/edge,Math.sqrt(ENHANCE_MAX_PIXELS/pixels)));
      const targetWidth=Math.max(1,Math.round(width*scale));
      const targetHeight=Math.max(1,Math.round(height*scale));
      const padding=24;
      const canvas=document.createElement("canvas");
      canvas.width=targetWidth+padding*2;
      canvas.height=targetHeight+padding*2;
      const context=canvas.getContext("2d",{willReadFrequently:true});
      if(!context)throw new Error("OCR 이미지 보정을 시작하지 못했습니다.");
      context.fillStyle="#fff";
      context.fillRect(0,0,canvas.width,canvas.height);
      context.imageSmoothingEnabled=true;
      context.imageSmoothingQuality="high";
      context.filter="grayscale(1) contrast(1.6) brightness(1.05)";
      context.drawImage(decoded.source,padding,padding,targetWidth,targetHeight);
      context.filter="none";

      const imageData=context.getImageData(padding,padding,targetWidth,targetHeight);
      const histogram=new Uint32Array(256);
      let brightnessSum=0;
      const pixelCount=targetWidth*targetHeight;
      for(let i=0;i<imageData.data.length;i+=4){
        const gray=Math.max(0,Math.min(255,Math.round((imageData.data[i]+imageData.data[i+1]+imageData.data[i+2])/3)));
        histogram[gray]++;
        brightnessSum+=gray;
      }
      const threshold=otsuThreshold(histogram,pixelCount);
      const invert=brightnessSum/pixelCount<96;
      for(let i=0;i<imageData.data.length;i+=4){
        const gray=Math.round((imageData.data[i]+imageData.data[i+1]+imageData.data[i+2])/3);
        let value=gray<threshold?0:255;
        if(invert)value=255-value;
        imageData.data[i]=value;
        imageData.data[i+1]=value;
        imageData.data[i+2]=value;
        imageData.data[i+3]=255;
      }
      context.putImageData(imageData,padding,padding);
      return await canvasBlob(canvas);
    }finally{
      try{decoded.close?.();}catch{}
    }
  }

  function progressLogger(message){
    if(!message||typeof message!=="object")return;
    const progress=Number(message.progress||0);
    if(message.status==="recognizing text"){
      const percent=Math.max(0,Math.min(100,Math.round(progress*100)));
      setStatus(ocrPass==="retry"?`글자를 선명하게 보정해 다시 읽는 중… ${percent}%`:`문서 글자를 읽는 중… ${percent}%`);
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

      ocrPass="first";
      const firstResponse=await worker.recognize(blob);
      const first=normalizeCandidate({text:firstResponse?.data?.text,confidence:firstResponse?.data?.confidence,source:"first"});
      let selected=first;
      let retry=null;
      let retryAttempted=false;

      if(shouldRetry(first)){
        retryAttempted=true;
        setStatus("인식률이 낮아 글자를 확대·흑백 보정해 한 번 더 읽습니다…");
        try{
          const enhancedBlob=await enhanceForOcr(blob);
          await worker.setParameters({tessedit_pageseg_mode:"6",preserve_interword_spaces:"1"});
          workerFailure="";
          ocrPass="retry";
          const retryResponse=await worker.recognize(enhancedBlob);
          retry=normalizeCandidate({text:retryResponse?.data?.text,confidence:retryResponse?.data?.confidence,source:"retry"});
          selected=chooseBetter(first,retry);
        }catch(retryError){
          if(!first.text)throw retryError;
          selected=first;
        }
      }

      if(!selected.text)throw new Error("읽을 수 있는 글자를 찾지 못했습니다. 문서를 더 가까이 촬영해보세요.");
      textArea.value=selected.text;
      resultBox.hidden=false;
      const confidence=Math.round(selected.confidence);
      const retryUsed=selected.source==="retry";
      const retryNote=retryAttempted?(retryUsed?" · 자동 보정 재인식 적용":" · 자동 보정 결과와 비교 완료"):"";
      const kind=confidence>=RETRY_CONFIDENCE?"success":"warning";
      const guidance=confidence>=RETRY_CONFIDENCE?"아래 내용은 수정할 수 있습니다.":"정확도가 낮아 아래 내용을 꼭 확인해주세요.";
      setStatus(confidence>0
        ? `문서 읽기 완료 · 인식 신뢰도 약 ${confidence}%${retryNote} · ${guidance}`
        : `문서 읽기 완료${retryNote} · ${guidance}`,kind);
    }catch(error){
      const detail=errorText(error)||workerFailure;
      setStatus(detail ? `OCR 실패: ${detail}` : "문서 내용을 읽지 못했습니다. 새로고침 후 다시 시도해주세요.","error");
    }finally{
      try{await worker?.terminate?.();}catch{}
      ocrPass="first";
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
