import {mkdir,rm,copyFile,access,readdir} from "node:fs/promises";
import path from "node:path";

const root=process.cwd();
const out=path.join(root,"public","vendor");
const tessOut=path.join(out,"tesseract");
const coreOut=path.join(out,"tesseract-core");
const langOut=path.join(out,"tessdata");

async function copyRequired(from,to){
  await access(from);
  await mkdir(path.dirname(to),{recursive:true});
  await copyFile(from,to);
}

await rm(out,{recursive:true,force:true});
await mkdir(tessOut,{recursive:true});
await mkdir(coreOut,{recursive:true});
await mkdir(langOut,{recursive:true});

await copyRequired(
  path.join(root,"node_modules","tesseract.js","dist","tesseract.min.js"),
  path.join(tessOut,"tesseract.min.js")
);
await copyRequired(
  path.join(root,"node_modules","tesseract.js","dist","worker.min.js"),
  path.join(tessOut,"worker.min.js")
);

// Tesseract.js selects the best core at runtime (SIMD / relaxed SIMD / LSTM).
// Each *.wasm.js loader also fetches a sibling *.wasm binary, so both must be deployed.
const coreSource=path.join(root,"node_modules","tesseract.js-core");
const coreFiles=(await readdir(coreSource)).filter(file=>
  /^tesseract-core.*\.wasm(?:\.js)?$/.test(file)
);
if(!coreFiles.some(file=>file.endsWith(".wasm.js")) || !coreFiles.some(file=>file.endsWith(".wasm"))){
  throw new Error("Tesseract core runtime files are incomplete");
}
for(const file of coreFiles){
  await copyRequired(path.join(coreSource,file),path.join(coreOut,file));
}

await copyRequired(
  path.join(root,"node_modules","@tesseract.js-data","kor","4.0.0_best_int","kor.traineddata.gz"),
  path.join(langOut,"kor.traineddata.gz")
);
await copyRequired(
  path.join(root,"node_modules","@tesseract.js-data","eng","4.0.0_best_int","eng.traineddata.gz"),
  path.join(langOut,"eng.traineddata.gz")
);

console.log(`Prepared self-hosted OCR assets (${coreFiles.length} core files) in public/vendor`);
