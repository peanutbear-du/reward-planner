import { describe, expect, it, vi } from "vitest";
import { cleanupRun, discoverRunOwners, snapshotRewards, validateManifest, verifyCleanup, type AdminRequest, type RunManifest } from "./wish-cover-smoke-support";

const runId="10000000-0000-4000-8000-000000000001";
const ids=["20000000-0000-4000-8000-000000000001","20000000-0000-4000-8000-000000000002"];
const owners=ids.map((id,i)=>({id,email:`rp-m3-03-${runId}-${i===0?"a":"b"}@example.test`}));
const authUser=(i:number)=>({...owners[i],user_metadata:{run_id:runId,purpose:"RP-M3-03 Smoke"}});
const manifest=():RunManifest=>({runId,owners:[...owners],attemptedEmails:owners.map(o=>o.email),attemptedPaths:ids.map(id=>`${id}/30000000-0000-4000-8000-000000000001.jpg`),smokeFinished:true});
const json=(body:unknown,status=200)=>Response.json(body,{status});
function fixture(options:{missing?:boolean;badMetadata?:boolean;failOwner?:boolean;lookupFails?:boolean;objectsRemain?:boolean}={}){
  const present=new Set(options.missing?[]:ids);
  const calls:{path:string;method:string;body?:Record<string,unknown>}[]=[];
  const request:AdminRequest=vi.fn(async(path,init={})=>{
    const method=init.method??"GET",body=init.body?JSON.parse(String(init.body)):undefined;calls.push({path,method,body});
    if(path.startsWith("/auth/v1/admin/users?")){
      if(options.lookupFails)throw Error("offline lookup failure");
      if(new URL(path,"https://offline.test").searchParams.get("page")!=="1")return json({users:[]});
      return json({users:[...ids.flatMap((id,i)=>present.has(id)?[authUser(i)]:[]),{id:"foreign",email:"existing@example.test",user_metadata:{}}]});
    }
    if(path.startsWith("/auth/v1/admin/users/")){
      const id=path.split("/").at(-1)!,i=ids.indexOf(id);
      if(!present.has(id))return json({},404);
      if(method==="DELETE"){if(options.failOwner&&i===0)return json({},500);present.delete(id);return json({});}
      return json(options.badMetadata&&i===0?{...authUser(i),user_metadata:{run_id:"foreign"}}:authUser(i));
    }
    if(path==="/storage/v1/object/list/wish-covers")return json(options.objectsRemain?[{name:"orphan.jpg"}]:[]);
    if(path==="/storage/v1/object/wish-covers"&&method==="DELETE")return json([]);
    if(path.startsWith("/rest/v1/"))return json([]);
    throw Error("Unexpected offline URL");
  });
  return{request,calls,present};
}
describe("M3-03 acceptance safety (offline only)",()=>{
  it("snapshots all reward fields for exactly the two run owners",async()=>{
    const s=fixture(),before=await snapshotRewards(manifest(),s.request),after=await snapshotRewards(manifest(),s.request);
    expect(after).toEqual(before);expect(s.calls).toHaveLength(8);
    for(const c of s.calls){expect(c.path).toMatch(/\/rest\/v1\/reward_(events|allocations)\?select=\*&user_id=eq\./);expect(ids.some(id=>c.path.includes(`user_id=eq.${id}&`))).toBe(true);}
  });
  it.each(["insert","update","delete"])("reward snapshot detects %s without modifying rewards",async(change)=>{
    let phase=0;
    const request:AdminRequest=vi.fn(async path=>{const user_id=new URL(path,"https://offline.test").searchParams.get("user_id")!.slice(3);return json(phase===0?[{id:"event",user_id,amount:1,status:"active"}]:change==="insert"?[{id:"event",user_id,amount:1,status:"active"},{id:"extra",user_id}]:change==="update"?[{id:"event",user_id,amount:1,status:"reversed"}]:[]);});
    const before=await snapshotRewards(manifest(),request);phase=1;expect(await snapshotRewards(manifest(),request)).not.toEqual(before);
  });
  it("finds an unknown create outcome using exact email plus run metadata",async()=>{
    const s=fixture(),m=manifest();m.owners=[];m.attemptedPaths=[];
    const result=await cleanupRun(m,s.request);expect(result.pass).toBe(true);expect(result.owners).toEqual(owners);
    expect(s.calls.filter(c=>c.method==="DELETE"&&c.path.startsWith("/auth"))).toHaveLength(2);
    expect(s.calls.some(c=>c.path.includes("foreign"))).toBe(false);
  });
  it("cleans real objects through Storage API before deleting their owner",async()=>{
    const s=fixture();expect((await cleanupRun(manifest(),s.request)).pass).toBe(true);
    for(const id of ids){const objectDelete=s.calls.findIndex(c=>c.method==="DELETE"&&Array.isArray(c.body?.prefixes)&&(c.body!.prefixes as string[]).every(p=>p.startsWith(`${id}/`)));const accountDelete=s.calls.findIndex(c=>c.method==="DELETE"&&c.path===`/auth/v1/admin/users/${id}`);expect(objectDelete).toBeGreaterThanOrEqual(0);expect(accountDelete).toBeGreaterThan(objectDelete);}
  });
  it("continues with the second owner when the first cleanup fails",async()=>{
    const s=fixture({failOwner:true}),r=await cleanupRun(manifest(),s.request);expect(r.pass).toBe(false);expect(r.entries).toEqual([{userId:ids[0],pass:false},{userId:ids[1],pass:true}]);
  });
  it("does not claim success when run-tag discovery is unavailable",async()=>{const s=fixture({lookupFails:true});expect((await cleanupRun(manifest(),s.request)).pass).toBe(false);});
  it("cleanup remains unconfirmed after an unknown request even if current reads are empty",async()=>{const s=fixture({missing:true}),m=manifest();m.uncertainRequests=true;expect((await cleanupRun(m,s.request)).pass).toBe(false);});
  it("refuses deletion when live owner metadata does not match the run",async()=>{const s=fixture({badMetadata:true});expect((await cleanupRun(manifest(),s.request)).pass).toBe(false);expect(s.calls.filter(c=>c.method==="DELETE").every(c=>!c.path.endsWith(ids[0])&&!(c.body?.prefixes as string[]|undefined)?.some(p=>p.startsWith(ids[0])))).toBe(true);});
  it("preserves accounts if Storage listing still contains objects",async()=>{const s=fixture({objectsRemain:true});expect((await cleanupRun(manifest(),s.request)).pass).toBe(false);expect(s.calls.some(c=>c.method==="DELETE"&&c.path.startsWith("/auth"))).toBe(false);});
  it.each(["path","owner","email"])("rejects foreign %s before requests",async(field)=>{
    const m=manifest();if(field==="path")m.attemptedPaths.push("foreign/object.jpg");if(field==="owner")m.owners[0]={...m.owners[0],id:"foreign"};if(field==="email")m.attemptedEmails.push("existing@example.test");
    const s=fixture();await expect(cleanupRun(m,s.request)).rejects.toThrow();expect(s.calls).toHaveLength(0);
  });
  it("rejects duplicate identities",()=>{const m=manifest();m.owners=[owners[0],owners[0]];expect(()=>validateManifest(m)).toThrow();});
  it("independently verifies Auth 404, empty prefixes and all nine tables",async()=>{
    const s=fixture({missing:true});expect((await verifyCleanup(manifest(),s.request)).pass).toBe(true);expect(s.calls.filter(c=>c.path.startsWith("/rest"))).toHaveLength(18);expect(s.calls.every(c=>c.method==="GET"||c.path==="/storage/v1/object/list/wish-covers")).toBe(true);
  });
  it("independent check rejects existing run accounts",async()=>{const s=fixture();await expect(verifyCleanup(manifest(),s.request)).rejects.toThrow("still exists");});
  it("independent check rejects residual objects",async()=>{const s=fixture({missing:true,objectsRemain:true});await expect(verifyCleanup(manifest(),s.request)).rejects.toThrow("prefix");});
  it("independent check rejects residual rows",async()=>{
    const s=fixture({missing:true});const request:AdminRequest=(p,i)=>p.includes("/rest/v1/wishes?")?Promise.resolve(json([{id:"residual"}])):s.request(p,i);
    await expect(verifyCleanup(manifest(),request)).rejects.toThrow("wishes");
  });
  it("an empty instant snapshot cannot prove an uncertain request settled",async()=>{const m=manifest();m.uncertainRequests=true;await expect(verifyCleanup(m,fixture({missing:true}).request)).rejects.toThrow("Unknown request");});
  it("does not verify a run without a completed Smoke report",async()=>{const m=manifest();m.smokeFinished=false;await expect(verifyCleanup(m,fixture().request)).rejects.toThrow("completion");});
  it("rejects foreign reward rows rather than treating them as a valid baseline",async()=>{await expect(snapshotRewards(manifest(),async()=>json([{user_id:"foreign"}]))).rejects.toThrow("foreign reward");});
  it("bounded run lookup fails closed instead of claiming that no user exists",async()=>{const request:AdminRequest=vi.fn(async()=>json({users:[{email:"foreign@example.test"}]}));await expect(discoverRunOwners(manifest(),request)).rejects.toThrow("incomplete");expect(request).toHaveBeenCalledTimes(100);});
  it("paginates run lookup and stops without claiming success on malformed data",async()=>{
    const request:AdminRequest=vi.fn(async()=>json({users:[]})).mockResolvedValueOnce(json({users:Array.from({length:50},()=>({email:"foreign@example.test"}))})).mockResolvedValueOnce(json({users:[authUser(1)]}));
    expect(await discoverRunOwners(manifest(),request)).toEqual([owners[1]]);expect(request).toHaveBeenCalledTimes(3);
    await expect(discoverRunOwners(manifest(),async()=>json({}))).rejects.toThrow("Malformed");
  });
});
