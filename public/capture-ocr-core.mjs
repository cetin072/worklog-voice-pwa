export const RETRY_CONFIDENCE=60;

export function normalizeOcr(value){
  return String(value||"").replace(/\r/g,"").split("\n").map(line=>line.replace(/[\t ]+/g," ").trim()).filter((line,index,lines)=>line||(index>0&&lines[index-1])).join("\n").replace(/\n{3,}/g,"\n\n").trim();
}

export function normalizeCandidate(input={}){
  const text=normalizeOcr(input.text);
  const confidence=Math.max(0,Math.min(100,Number(input.confidence||0)));
  const meaningful=(text.match(/[0-9A-Za-z가-힣]/g)||[]).length;
  const hangul=(text.match(/[가-힣]/g)||[]).length;
  return {text,confidence,meaningful,hangul,source:String(input.source||"")};
}

export function shouldRetry(input){
  const candidate=normalizeCandidate(input);
  return !candidate.text||candidate.confidence<RETRY_CONFIDENCE||candidate.meaningful<12;
}

export function chooseBetter(firstInput,secondInput){
  const first=normalizeCandidate(firstInput),second=normalizeCandidate(secondInput);
  if(!first.text)return second;if(!second.text)return first;
  if(second.confidence>=first.confidence+2)return second;
  if(second.confidence>=first.confidence-5&&second.hangul>=first.hangul+2)return second;
  if(second.confidence>=first.confidence-4&&second.meaningful>=Math.max(first.meaningful+8,Math.ceil(first.meaningful*1.2)))return second;
  return first;
}

export function otsuThreshold(histogram,total){
  let weighted=0;for(let i=0;i<256;i++)weighted+=i*Number(histogram[i]||0);
  let backgroundWeight=0,backgroundSum=0,bestThreshold=127,bestVariance=-1;
  for(let t=0;t<256;t++){
    const count=Number(histogram[t]||0);backgroundWeight+=count;if(!backgroundWeight)continue;
    const foregroundWeight=total-backgroundWeight;if(!foregroundWeight)break;backgroundSum+=t*count;
    const backgroundMean=backgroundSum/backgroundWeight,foregroundMean=(weighted-backgroundSum)/foregroundWeight,delta=backgroundMean-foregroundMean,variance=backgroundWeight*foregroundWeight*delta*delta;
    if(variance>bestVariance){bestVariance=variance;bestThreshold=t;}
  }
  return bestThreshold;
}
