import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";

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
const results=[];
if(prepare.status===0){
  for(const file of readdirSync("tests").filter(name=>name.endsWith(".test.mjs")).sort()){
    const result=run(process.execPath,["--test",`tests/${file}`]);
    results.push({file,...result});
  }
}
const failed=prepare.status!==0?"prepare-ocr":results.find(item=>item.status!==0)?.file.replace(/\.test\.mjs$/,"" )||"all-pass";
const safe=failed.replace(/[^a-z0-9-]/gi,"-").toLowerCase().slice(0,60);
mkdirSync("public",{recursive:true});
mkdirSync("netlify/functions",{recursive:true});
writeFileSync("public/build-diagnostic.txt",JSON.stringify({node:process.version,platform:process.platform,prepare,results},null,2));
writeFileSync(`netlify/functions/diag-${safe}.mjs`,`export default async()=>new Response(${JSON.stringify(failed)});\n`);
console.log(`diagnostic written: ${failed}`);
process.exit(0);
