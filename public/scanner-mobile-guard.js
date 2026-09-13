(()=>{
  const OPEN_CV_URL="https://docs.opencv.org/4.7.0/opencv.js";
  const JSCANIFY_URL="https://cdn.jsdelivr.net/npm/jscanify@1.4.3/src/jscanify.min.js";
  const ENGINE_TIMEOUT_MS=18000;

  const scanButton=document.getElementById("scanDocument");
  const scanInput=document.getElementById("scanInput");
  const result=document.getElementById("result");
  if(!scanButton || !scanInput) return;

  let enginePromise=null;
  let busy=false;
  const originalLabel=scanButton.textContent;

  const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  function timeout(promise,ms,message){
    let timer;
    return Promise.race([
      Promise.resolve(promise).finally(()=>clearTimeout(timer)),
      new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error(message)),ms); })
    ]);
  }

  function loadScript(src,ready){
    if(ready()) return Promise.resolve();
    const existing=[...document.scripts].find(script=>script.src===src);
    if(existing) return Promise.resolve();
    return timeout(new Promise((resolve,reject)=>{
      const script=document.createElement("script");
      script.src=src;
      script.async=true;
      script.onload=resolve;
      script.onerror=()=>reject(new Error("문서 인식 엔진 다운로드에 실패했습니다."));
      document.head.appendChild(script);
    }),ENGINE_TIMEOUT_MS,"문서 인식 엔진 다운로드 시간이 너무 오래 걸립니다.");
  }

  async function waitForOpenCv(){
    const started=Date.now();
    while(Date.now()-started<ENGINE_TIMEOUT_MS){
      if(window.cv?.Mat) return window.cv;
      if(window.cv && typeof window.cv.then==="function"){
        const remaining=Math.max(500,ENGINE_TIMEOUT_MS-(Date.now()-started));
        const resolved=await timeout(window.cv,remaining,"OpenCV 초기화 시간이 너무 오래 걸립니다.");
        if(resolved) window.cv=resolved;
        if(window.cv?.Mat) return window.cv;
      }
      await sleep(100);
    }
    throw new Error("OpenCV 초기화에 실패했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.");
  }

  function ensureEngine(){
    if(window.cv?.Mat && typeof window.jscanify==="function") return Promise.resolve();
    if(enginePromise) return enginePromise;
    enginePromise=(async()=>{
      await loadScript(OPEN_CV_URL,()=>Boolean(window.cv?.Mat));
      await waitForOpenCv();
      await loadScript(JSCANIFY_URL,()=>typeof window.jscanify==="function");
      if(typeof window.jscanify!=="function") throw new Error("문서 인식 모듈을 시작하지 못했습니다.");
    })().catch(error=>{
      enginePromise=null;
      throw error;
    });
    return enginePromise;
  }

  scanButton.addEventListener("click",async event=>{
    event.preventDefault();
    event.stopImmediatePropagation();
    if(busy) return;
    busy=true;
    scanButton.disabled=true;
    scanButton.textContent="⏳ 스캔 준비 중…";
    if(result){
      result.textContent="첫 실행은 문서 인식 엔진 준비에 몇 초 걸릴 수 있습니다.";
      result.className="result";
    }

    try{
      await ensureEngine();
      if(result?.textContent?.includes("문서 인식 엔진")) result.textContent="";
      scanButton.disabled=false;
      scanButton.textContent=originalLabel;
      scanInput.click();
    }catch(error){
      scanButton.disabled=false;
      scanButton.textContent=originalLabel;
      if(result){
        result.textContent=error?.message || "문서 스캔 준비에 실패했습니다. 다시 시도해주세요.";
        result.className="result error";
      }
    }finally{
      busy=false;
    }
  },true);
})();
