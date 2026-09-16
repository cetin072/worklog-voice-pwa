import {execFileSync,spawnSync} from "node:child_process";
import {copyFileSync,existsSync,mkdtempSync,mkdirSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {createWorker} from "tesseract.js";
import {normalizeCandidate,shouldRetry,chooseBetter} from "../public/capture-ocr-core.mjs";

function findChrome(){
  for(const candidate of ["google-chrome","google-chrome-stable","chromium","chromium-browser"]){
    try{const path=execFileSync("sh",["-lc",`command -v ${candidate}`],{encoding:"utf8"}).trim();if(path)return path;}catch{}
  }
  throw new Error("UAR_OCR_CHROME_NOT_FOUND");
}

function esc(value){return String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");}

const cases=[
  {name:"kakao-light",theme:"light",kind:"chat",text:"내일 오후 2시에 삼현 미팅 가능하세요?",keys:["내일","오후 2시","삼현","미팅"]},
  {name:"kakao-dark",theme:"dark",kind:"chat",text:"금요일 오후 4시 보험 고객 상담 잡아주세요.",keys:["금요일","오후 4시","보험 고객","상담"]},
  {name:"sms",theme:"light",kind:"sms",text:"[Web발신]\n9/20(일) 14:30 보험 상담 예약이 확정되었습니다.\n장소: 수원시청역 3번 출구",keys:["9/20","14:30","보험 상담","예약","수원시청역"]},
  {name:"email",theme:"light",kind:"email",text:"회의 일정 안내\n9월 24일(목) 오후 3:30\n장소: 본사 2층 회의실\n안건: 4분기 사업계획 검토",keys:["9월 24일","오후 3:30","본사 2층 회의실","4분기 사업계획"]}
];

function pageHtml(item){
  const dark=item.theme==="dark";
  const background=dark?"#25292e":item.kind==="chat"?"#b8d2db":"#f8f9fa";
  const bubble=dark?"#4a4f56":item.kind==="chat"?"#ffffff":"#e8ebef";
  const color=dark?"#fafafa":"#191919";
  const lines=item.text.split("\n").map(line=>`<div>${esc(line)}</div>`).join("");
  return `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}html,body{margin:0;width:720px;height:980px;overflow:hidden;font-family:"Noto Sans CJK KR","Noto Sans KR","Noto Sans",sans-serif;background:${background};color:${color}}header{height:90px;padding:25px 32px;font-size:28px;font-weight:800;background:${dark?"#1f2227":"#fae000"}}main{padding:78px 54px}.sender{font-size:18px;font-weight:700;margin-bottom:10px}.bubble{display:inline-block;max-width:610px;padding:22px 24px;border-radius:22px;background:${bubble};font-size:${item.kind==="email"?"24px":"25px"};line-height:1.55}.time{display:inline-block;margin-left:8px;font-size:14px;color:${dark?"#d0d0d0":"#666"};vertical-align:bottom}</style><header>${item.kind==="email"?"메일":item.kind==="sms"?"메시지":"채팅"}</header><main><div class="sender">김대리</div><div class="bubble">${lines}</div>${item.kind==="chat"?'<span class="time">오후 3:21</span>':''}</main>`;
}

function renderPng(chrome,temp,item){
  const htmlPath=join(temp,`${item.name}.html`),pngPath=join(temp,`${item.name}.png`);
  writeFileSync(htmlPath,pageHtml(item),"utf8");
  const result=spawnSync(chrome,["--headless=new","--no-sandbox","--disable-gpu","--hide-scrollbars","--window-size=720,980",`--screenshot=${pngPath}`,`file://${htmlPath}`],{encoding:"utf8",timeout:20000});
  if(result.error||result.status!==0||!existsSync(pngPath))throw new Error(`UAR_OCR_RENDER_FAILED:${item.name}:${String(result.stderr||result.error||"").slice(-500)}`);
  return pngPath;
}

function compact(value){return String(value||"").replace(/\s+/g,"");}
function keyRecall(text,keys){const value=compact(text);return keys.filter(key=>value.includes(compact(key))).length/keys.length;}

const chrome=findChrome();
const temp=mkdtempSync(join(tmpdir(),"worklog-ocr-quality-"));
const langPath=join(temp,"lang");mkdirSync(langPath,{recursive:true});
copyFileSync(resolve("node_modules/@tesseract.js-data/kor/4.0.0_best_int/kor.traineddata.gz"),join(langPath,"kor.traineddata.gz"));
copyFileSync(resolve("node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz"),join(langPath,"eng.traineddata.gz"));

let worker;
try{
  worker=await createWorker(["kor","eng"],1,{langPath,cacheMethod:"none",gzip:true,logger:()=>{}});
  const results=[];
  for(const item of cases){
    const image=renderPng(chrome,temp,item);
    await worker.setParameters({tessedit_pageseg_mode:"3",preserve_interword_spaces:"1"});
    const firstResponse=await worker.recognize(image);
    const first=normalizeCandidate({text:firstResponse?.data?.text,confidence:firstResponse?.data?.confidence,source:"first"});
    let selected=first;
    if(shouldRetry(first)){
      await worker.setParameters({tessedit_pageseg_mode:"6",preserve_interword_spaces:"1"});
      const retryResponse=await worker.recognize(image);
      selected=chooseBetter(first,{text:retryResponse?.data?.text,confidence:retryResponse?.data?.confidence,source:"retry"});
    }
    const recall=keyRecall(selected.text,item.keys);
    results.push({name:item.name,confidence:Number(selected.confidence.toFixed(1)),source:selected.source||"first",recall:Number(recall.toFixed(3)),text:selected.text.replace(/\s+/g," ").slice(0,240)});
  }
  const mean=results.reduce((sum,row)=>sum+row.recall,0)/results.length;
  for(const row of results)console.log(`UAR_OCR_SAMPLE ${row.name} recall=${row.recall} confidence=${row.confidence} source=${row.source} text=${JSON.stringify(row.text)}`);
  console.log(`UAR_OCR_QUALITY_SUMMARY samples=${results.length} mean_key_recall=${mean.toFixed(3)}`);
  const weak=results.filter(row=>row.recall<0.75);
  if(mean<0.85||weak.length)throw new Error(`UAR_OCR_QUALITY_BELOW_GATE:mean=${mean.toFixed(3)} weak=${weak.map(row=>`${row.name}:${row.recall}`).join(",")}`);
  console.log("UAR_OCR_QUALITY_PASS");
}finally{
  try{await worker?.terminate?.();}catch{}
  rmSync(temp,{recursive:true,force:true});
}
