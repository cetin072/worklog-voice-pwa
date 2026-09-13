import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import {gunzipSync} from "node:zlib";
import {createWorker} from "tesseract.js";

// Synthetic, privacy-safe 1-bit PBM fixture containing: OCR TEST 123.
// It is gzip-compressed here only to keep the repository test fixture compact.
const OCR_FIXTURE_GZIP_BASE64="H4sICFsypmoCA29jcl90ZXN0X2ZpeHR1cmVfYncucGJtAO3YQbKUMBAA0CALrL+QG4hH+FZZusw/gkfxAJZwNI7Czi1LFhSRpLtDgO4wM44Lq7o3nw/Jm5CETuD7l5dvr6+fPn99fTEaGhoaGhoaGhoaGhoaGv8srMODwk1XZVvXCVeosnU9nKgccdat5wq3BlZuXIi5DH+GUNaFcj5irQl+MdRaS8xRc/iLvmyRVDm5/sS4d7FZVbgSeGyVLxKaXq8HC7hOcNtQZOfigb8yQ9t8QWNCnZEa7jpwe9YN1/ZuiQfYmiJqVSzSBrBw8SdPbnnhdonbQFn8KXIn1q0u3D5xLfVnmboz69YX7pC4Ld4BNCbvNhfumLiOxqlO3YV17YU7bS4wNDef50IVf2hT17Fum3Hnwvde4bqG3KkK7lqpr67cybSC66+u7rSO0wjTtzfhUrj51rveo3QShrTEfmnXshXOSbxeut/g+lasrp9qIzy8vgtmA3gd3CpmnqO7/vNr785VcGdPra6vAu6CvxQGrwxuKbhB+7h3O3BHpMj1ZDhTQFIIbiG5/s+7net70ru9P8C7AneCM9jGt0vXsG53cK1vdQX3vlW53zXJKES3hLF6rjtAMbqLJ7ktuuuwzteuu9+tb3K7G1xc53qocHAN7w5Zd2bdKVYpxOd4yrjYk8UjLi6oORfyDnTZWr5J3DIOPLmwprQunTRndzI0c9FtvTvGKpXgWlpkWDfccYFFWLehvRDjLqIbhJy7baQObkN7t7zby+4ou4Pk0qPrjOwOrFvTrbBumFoXbs+6FW0tWNeRO8iuYd0i2XOdXEja+XGbeZd2jaxb0ZUHXIt/ObeOu8fx3n6ADhbchno+53a8S5t7zrU0U3LuwOYdaLDgtnEzPtLkOOSdjAvvTKxLk7MU8yTzvC2bQgviwd32MnL+PeeHJRlI3q3iqVZch+wpny3JGyfv1rGMFdfNOuNawd1yqxXX+fqU1ze3EVwb+64R9yXVA24b51Aj7qNKYd3MuVsObMR9n+S+yW6yZW7u3qf+kN1tmpF7x776p+wmQ23F94Cks/b7Enme4TR7v7nMe4voDtsqdnBhN2I+0PPGvmclk2bvztsqdnCxRt1hfuDeCxkXclHrS+xduoRvv/WI+Yx7j413dXZP68XRdZh/uffuv3Iz3wlwVkuuucllvms8xWW+w5gkUZ7d5TaX+W6Ud+fbXOY7l0kS5dmdbnOZ73JpYjy7420u8x3RJIly59ZUNu/2wnfPtN7OLWiLJbrltgk7f6c1SaLcuX6Qp6zrjemp35WZN2cNDQ0NDQ0NDQ0NDQ0NDQ0Njf80/gAbkY+XCzcAAA==";

test("self-hosted Korean+English OCR runtime recognizes a fixture",{timeout:90000},async()=>{
  const langPath=path.resolve("public/vendor/tessdata");
  assert.ok(fs.existsSync(path.join(langPath,"kor.traineddata.gz")),"missing Korean traineddata");
  assert.ok(fs.existsSync(path.join(langPath,"eng.traineddata.gz")),"missing English traineddata");

  const worker=await createWorker(["kor","eng"],1,{
    langPath,
    cacheMethod:"none",
    gzip:true,
    logger:()=>{}
  });

  try{
    const fixture=gunzipSync(Buffer.from(OCR_FIXTURE_GZIP_BASE64,"base64"));
    const {data}=await worker.recognize(fixture);
    const normalized=String(data?.text||"").replace(/\s+/g," ").trim();
    assert.match(normalized,/OCR\s+TEST\s+123/i,`unexpected OCR output: ${normalized}`);
  }finally{
    await worker.terminate();
  }
});
