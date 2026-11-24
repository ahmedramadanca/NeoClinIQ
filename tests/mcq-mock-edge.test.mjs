import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {pathToFileURL} from "node:url";
import assert from "node:assert/strict";
import {test} from "node:test";

test("Edge authenticates and passes only server-resolved account identity to private exam RPC",async ()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"mcq-mock-edge-"));
 const file=path.join(dir,"test-edge.mts");
 const src=fs.readFileSync(new URL("../supabase/functions/website-mcq-mock/index.ts",import.meta.url),"utf8");
 fs.writeFileSync(file,src.replace(/^import .*;/m,"const createClient=globalThis.testMockCreateClient;"));
 const site="https://neocliniq.maplecanadaramadan.ca";
 const id="10000000-0000-0000-0000-000000000001";
 const other="10000000-0000-0000-0000-000000000002";
 let handler, calls=[];
 globalThis.Deno={serve(fn){handler=fn},env:{get:(key)=>({
   SUPABASE_URL:"https://fixture.invalid",SUPABASE_ANON_KEY:"test-public",SUPABASE_SERVICE_ROLE_KEY:"test-private",
 })[key]}};
 globalThis.testMockCreateClient=(_url,key)=>key==="test-public"?{
   auth:{getUser:async token=>token==="valid"?{data:{user:{id}}}:{data:{user:null},error:{message:"expired"}}}
 }:{rpc:async (name,args)=>{calls.push([name,args]);return {data:{status:200,body:{state:"available"}}}}};
 try{
  await import(pathToFileURL(file).href);
  const run=(payload,token="valid",origin=site,ctype="application/json")=>handler(new Request("https://fixture.invalid/mcq",{
    method:"POST",headers:{Origin:origin,"Content-Type":ctype,...(token?{Authorization:"Bearer "+token}:{})},body:JSON.stringify(payload)
  }));
  assert.equal((await run({action:"start"},"")).status,401);
  assert.equal((await run({action:"start"},"expired")).status,401);
  assert.equal((await run({action:"start"},"valid","https://other.invalid")).status,403);
  assert.equal((await run({action:"submit",attempt_id:id,answers:[]})).status,400);
  assert.equal((await run({action:"start",attempt_id:"invalid"})).status,400);
  assert.equal((await run({action:"status",padding:"q".repeat(66000)})).status,400);
  assert.equal((await run({action:"status"},"valid",site,"text/plain")).status,415);
  assert.equal(calls.length,0);
  const result=await run({action:"status",compact:true,user_id:other,p_user_id:other});
  assert.equal(result.status,200);
  assert.equal(result.headers.get("Cache-Control"),"private, no-store");
  assert.deepEqual(await result.json(),{state:"available"});
  assert.deepEqual(calls,[["website_mcq_mock_action",{
    p_user_id:id,p_action:"status",p_attempt_id:null,p_answers:[],p_flags:[],p_compact:true
  }]]);
 }finally{delete globalThis.Deno;delete globalThis.testMockCreateClient;fs.rmSync(dir,{recursive:true,force:true})}
});
