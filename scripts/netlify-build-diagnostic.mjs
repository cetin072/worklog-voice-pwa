import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";

function run(command,args){
  const result=spawnSync(command,args,{encoding:"utf8",env:process.env});
  return {
    status: result.status,
    signal: result.signal,
    stdout: String(result.stdout||"").slice(-12000),
    stderr: String(result.stderr||"").slice(-12000)
  };
}

const prepare=run("npm",["run","prepare:ocr"]);
const test=prepare.status===0?run("npm",["test"]):{status:null,signal:null,stdout:"",stderr:"skipped because prepare:ocr failed"};
mkdirSync("public",{recursive:true});
writeFileSync("public/build-diagnostic.txt",JSON.stringify({node:process.version,platform:process.platform,prepare,test},null,2));
console.log(`diagnostic written: prepare=${prepare.status} test=${test.status}`);
process.exit(0);
