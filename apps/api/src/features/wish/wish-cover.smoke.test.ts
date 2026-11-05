import { randomBytes,randomUUID } from "node:crypto";
import { readFileSync,writeFileSync } from "node:fs";
import { describe,expect,it } from "vitest";
import { cleanupRun, snapshotRewards, type RunManifest } from "./wish-cover-smoke-support";

// Opt-in only after Migration Review/application and server-key configuration.
describe.skipIf(!process.env.WISH_COVER_SMOKE_API_BASE_URL)("RP-M3-03 private cover Smoke",()=>{
  it("uploads/associates/reads privately and removes real objects before accounts",async()=>{
    const need=(k:string)=>{const v=process.env[k];if(!v)throw Error(`Missing ${k}`);return v;};
    const db=need("SUPABASE_URL"),anon=need("SUPABASE_ANON_KEY"),secret=need("SUPABASE_SECRET_KEY"),api=need("WISH_COVER_SMOKE_API_BASE_URL");
    const ref=readFileSync("supabase/.temp/project-ref","utf8").trim();expect(JSON.parse(readFileSync("supabase/.temp/linked-project.json","utf8"))).toMatchObject({ref,name:"reward-planner-dev"});expect(new URL(db).hostname).toBe(`${ref}.supabase.co`);expect(["127.0.0.1","localhost"].includes(new URL(api).hostname)).toBe(true);
    const apiEnv=readFileSync("apps/api/.env.local","utf8");expect(/^SUPABASE_SERVICE_ROLE_KEY\s*=\s*\S+/m.test(apiEnv)).toBe(true);expect(/^SUPABASE_URL\s*=\s*["']?([^\s"']+)/m.exec(apiEnv)?.[1]).toBe(db);
    const jpeg=new Uint8Array(readFileSync(new URL("../../../../../supabase/tests/fixtures/wish-cover.jpg",import.meta.url)));
    const runId=randomUUID(),deadline=Date.now()+180000,owners:{id:string;email:string;token:string}[]=[],emails:string[]=[],paths=new Set<string>(),passed:string[]=[],cleanup:Record<string,unknown>[]=[],evidence:Record<string,unknown>={};
    type Owner=typeof owners[number];type Row=Record<string,unknown>;
    const reportPath=`.env.m3-wish-cover-${runId}-result.json`;
    let uncertainRequests=false,cleanupDeadline=0;
    const manifest=():RunManifest=>({runId,owners:owners.map(({id,email})=>({id,email})),attemptedEmails:[...emails],attemptedPaths:[...paths],smokePid:process.pid,uncertainRequests});
    const checkpoint=()=>writeFileSync(reportPath,JSON.stringify({...manifest(),smokeFinished:false},null,2));
    checkpoint();console.info(`M3-03 run report: ${reportPath}`);
    const admin={apikey:secret,Authorization:`Bearer ${secret}`},auth=(o:Owner)=>({apikey:anon,Authorization:`Bearer ${o.token}`});let stage="preflight",failed=false;
    async function send(base:string,path:string,init:RequestInit={},clean=false){const ms=clean?Math.min(10000,cleanupDeadline-Date.now()):Math.min(12000,deadline-Date.now());if(ms<=0)throw Error("Smoke deadline");try{const response=await fetch(new URL(path,base),{...init,signal:AbortSignal.timeout(ms),cache:"no-store"});if(init.method==="POST"&&response.status>=500)uncertainRequests=true;return response;}catch{uncertainRequests=true;throw Error("Request outcome unknown");}}
    async function json<T>(base:string,path:string,init:RequestInit={}):Promise<T>{const r=await send(base,path,{...init,headers:{"Content-Type":"application/json",...init.headers}});if(!r.ok)throw Error(`HTTP ${r.status} at ${stage}`);try{const t=await r.text();return(t?JSON.parse(t):null)as T;}catch{if(init.method==="POST")uncertainRequests=true;throw Error("Response body not confirmed");}}
    async function owner(label:string){const email=`rp-m3-03-${runId}-${label}@example.test`,password=randomBytes(24).toString("base64url")+"aA1!";emails.push(email);checkpoint();const u=await json<{id:string}>(db,"/auth/v1/admin/users",{method:"POST",headers:admin,body:JSON.stringify({email,password,email_confirm:true,user_metadata:{purpose:"RP-M3-03 Smoke",run_id:runId}})});expect(u.id).toMatch(/^[0-9a-f-]{36}$/);const o={id:u.id,email,token:""};owners.push(o);checkpoint();o.token=(await json<{access_token:string}>(db,"/auth/v1/token?grant_type=password",{method:"POST",headers:{apikey:anon},body:JSON.stringify({email,password})})).access_token;return o;}
    const rows=(o:Owner)=>json<Row[]>(db,`/rest/v1/wishes?select=*&user_id=eq.${o.id}&order=id`,{headers:auth(o)});
    async function wish(o:Owner,title:string){const r=await json<{wish:Row}>(db,"/rest/v1/rpc/create_wish",{method:"POST",headers:auth(o),body:JSON.stringify({p_title:title,p_target:60})});const id=r.wish.id as string;expect(id).toMatch(/^[0-9a-f-]{36}$/);paths.add(`${o.id}/${id}.jpg`);return id;}
    const upload=(o:Owner|null,id:string,bytes:Uint8Array=jpeg,type="image/jpeg")=>{const form=new FormData();form.set("wishId",id);form.set("file",new Blob([Uint8Array.from(bytes)],{type}),"ignored.png");return send(api,"/api/commands/wish/cover-upload",{method:"POST",headers:o?{Authorization:`Bearer ${o.token}`}:{},body:form});};
    const read=(o:Owner,id:string)=>send(api,`/api/wishes/cover?wishId=${id}`,{headers:{Authorization:`Bearer ${o.token}`}});
    async function check(name:string,fn:()=>Promise<void>){stage=name;await fn();passed.push(name);}
    const rewards=()=>snapshotRewards(manifest(),(path,init={})=>send(db,path,{...init,headers:admin}));
    let rewardsBefore:Awaited<ReturnType<typeof snapshotRewards>>|undefined;
    try{
      await check("Actual private JPEG-only 5 MiB bucket settings",async()=>{const bucket=await json<{id:string;public:boolean;file_size_limit:number|string;allowed_mime_types:string[]}>(db,"/storage/v1/bucket/wish-covers",{headers:admin});expect(bucket.id).toBe("wish-covers");expect(bucket.public).toBe(false);expect(Number(bucket.file_size_limit)).toBe(5242880);expect(bucket.allowed_mime_types).toEqual(["image/jpeg"]);});
      const a=await owner("a"),b=await owner("b"),id=await wish(a,"Cover success"),race=await wish(a,"Cover race"),bid=await wish(b,"Other owner");
      const before=(await rows(a)).find(w=>w.id===id)!;
      rewardsBefore=await rewards();evidence.rewardsBefore=rewardsBefore;
      await check("Valid JPEG upload, fixed object name and preserved Wish fields",async()=>{const r=await upload(a,id);expect(r.status).toBe(201);expect(await r.json()).toEqual({data:{wishId:id,coverPath:`${a.id}/${id}.jpg`},effects:["wish_cover_uploaded"]});const after=(await rows(a)).find(w=>w.id===id)!;const strip=(w:Row)=>Object.fromEntries(Object.entries(w).filter(([k])=>!["cover_path","updated_at"].includes(k)));expect(strip(after)).toEqual(strip(before));expect(after.cover_path).toBe(`${a.id}/${id}.jpg`);evidence.cover={wishId:id,path:after.cover_path};});
      await check("Private signed read preserves exact bytes; cross-owner access denied",async()=>{const r=await read(a,id);expect(r.status).toBe(200);const body=await r.json();expect(body.data.expiresIn).toBe(300);const image=await send(body.data.signedUrl,"");expect(image.ok).toBe(true);expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);expect((await read(b,id)).status).toBe(404);const publicRead=await send(db,`/storage/v1/object/public/wish-covers/${a.id}/${id}.jpg`);expect(publicRead.ok).toBe(false);});
      await check("Existing cover/duplicate POST cannot overwrite",async()=>{expect((await upload(a,id)).status).toBe(409);expect((await rows(a)).find(w=>w.id===id)?.cover_path).toBe(`${a.id}/${id}.jpg`);});
      await check("Auth, ownership, UUID, bytes, MIME and size rejection",async()=>{expect((await upload(null,bid)).status).toBe(401);expect((await upload(b,id)).status).toBe(404);expect((await upload(a,"../path")).status).toBe(400);expect((await upload(b,bid,new Uint8Array())).status).toBe(400);expect((await upload(b,bid,jpeg,"image/png")).status).toBe(400);expect((await upload(b,bid,new Uint8Array([137,80,78,71,0,0,0,0,0,0,0,0]))).status).toBe(400);expect((await upload(b,bid,new Uint8Array(5242881))).status).toBe(413);expect((await rows(b)).find(w=>w.id===bid)?.cover_path).toBeNull();});
      await check("Direct Storage/RPC bypass and arbitrary paths denied",async()=>{for(const path of [`${b.id}/${bid}.jpg`,`${a.id}/${bid}.jpg`,`${b.id}/arbitrary.jpg`]){paths.add(path);const r=await send(db,`/storage/v1/object/wish-covers/${path}`,{method:"POST",headers:{...auth(b),"Content-Type":"image/jpeg","x-upsert":"false"},body:Uint8Array.from(jpeg)});expect(r.ok).toBe(false);}const r=await send(db,"/rest/v1/rpc/attach_wish_cover",{method:"POST",headers:{...auth(a),"Content-Type":"application/json"},body:JSON.stringify({p_wish_id:bid,p_user_id:b.id})});expect(r.ok).toBe(false);expect(await r.json()).toMatchObject({code:"42501"});});
      await check("Client Storage UPDATE/DELETE cannot replace or remove an associated cover",async()=>{const update=await send(db,`/storage/v1/object/wish-covers/${a.id}/${id}.jpg`,{method:"PUT",headers:{...auth(a),"Content-Type":"image/jpeg"},body:Uint8Array.from(jpeg)});expect(update.ok).toBe(false);await send(db,"/storage/v1/object/wish-covers",{method:"DELETE",headers:{...auth(a),"Content-Type":"application/json"},body:JSON.stringify({prefixes:[`${a.id}/${id}.jpg`]})});const r=await read(a,id);expect(r.status).toBe(200);const body=await r.json();const image=await send(body.data.signedUrl,"");expect(image.ok).toBe(true);expect(new Uint8Array(await image.arrayBuffer())).toEqual(jpeg);});
      await check("Concurrent uploads: one new object/association winner",async()=>{const replies=await Promise.allSettled([upload(a,race),upload(a,race)]);expect(replies.every(r=>r.status==="fulfilled")).toBe(true);const statuses=replies.map(r=>(r as PromiseFulfilledResult<Response>).value.status).sort();expect(statuses).toEqual([201,409]);expect((await rows(a)).find(w=>w.id===race)?.cover_path).toBe(`${a.id}/${race}.jpg`);evidence.raceStatuses=statuses;});
    }catch(error){failed=true;evidence.failure={stage,reason:error instanceof Error?error.message.slice(0,500):"Unknown"};}
    finally{
      // Scope/ownership checks precede every destructive operation. A failed
      // owner's cleanup must not skip the other owner or lose the run report.
      cleanupDeadline=Date.now()+90000;
      // Capture the after-state even when an earlier upload assertion failed,
      // before cascading account cleanup can erase evidence of side effects.
      if(rewardsBefore){
        try{await check("Both run users' Reward Events and Allocations remain unchanged",async()=>{const after=await snapshotRewards(manifest(),(path,init={})=>send(db,path,{...init,headers:admin},true));evidence.rewardsAfter=after;expect(after).toEqual(rewardsBefore);});}
        catch{failed=true;evidence.rewardInvariant="FAIL or UNCONFIRMED";}
      }else{evidence.rewardInvariant="NOT TESTED: baseline unavailable";}
      let finalOwners=manifest().owners,discoveryComplete=false;
      try{
        const result=await cleanupRun(manifest(),(path,init={})=>send(db,path,{...init,headers:{...admin,"Content-Type":"application/json"}},true));
        finalOwners=result.owners;discoveryComplete=result.discoveryComplete;cleanup.push(...result.entries);
        if(!result.pass)failed=true;
      }catch{failed=true;cleanup.push({pass:false,reason:"Cleanup scope or request not confirmed"});}
      if(uncertainRequests)failed=true;
      writeFileSync(reportPath,JSON.stringify({...manifest(),owners:finalOwners,smokeFinished:true,finishedAt:new Date().toISOString(),discoveryComplete,failed,passed,evidence,cleanup,independentCleanup:"NOT TESTED"},null,2));
      expect(failed,`Cover Smoke failed at ${stage}; inspect non-secret report`).toBe(false);
    }
  },300000);
});
