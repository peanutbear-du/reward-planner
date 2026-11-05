import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach,describe,expect,it,vi } from "vitest";
import { coverWriter,createCoverReader,createServerCoverWriter } from "./supabase-wish-cover";
import { uploadWishCover } from "./wish-cover";

const mockCreateClient=vi.hoisted(()=>vi.fn());
vi.mock("@supabase/supabase-js",()=>({createClient:mockCreateClient}));
const id="70000000-0000-4000-8000-000000000101",userId="00000000-0000-4000-8000-000000000101",path=`${userId}/${id}.jpg`;
function setup(){const bucket={upload:vi.fn(async()=>({data:{path},error:null})),remove:vi.fn(async()=>({error:null})),createSignedUrl:vi.fn(async()=>({data:{signedUrl:"signed"},error:null}))};const rpc=vi.fn(async()=>({data:{wishId:id,coverPath:path},error:null}));const s={storage:{from:vi.fn(()=>bucket)},rpc};return{bucket,rpc,s:s as unknown as SupabaseClient,from:s.storage.from};}
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks()});
describe("Wish cover Supabase boundaries",()=>{
  it("uploads without upsert then uses narrow owner-checked RPC, never direct Wish UPDATE",async()=>{const s=setup(),w=coverWriter(s.s),bytes=new Uint8Array([255,216]);await w.upload(path,bytes);await w.attach({id,userId,coverPath:null});expect(s.from).toHaveBeenCalledWith("wish-covers");expect(s.bucket.upload).toHaveBeenCalledExactlyOnceWith(path,bytes,{contentType:"image/jpeg",upsert:false});expect(s.rpc).toHaveBeenCalledExactlyOnceWith("attach_wish_cover",{p_wish_id:id,p_user_id:userId});});
  it("deletes bytes only via Storage API",async()=>{const s=setup();await coverWriter(s.s).remove(path);expect(s.bucket.remove).toHaveBeenCalledExactlyOnceWith([path]);expect(s.rpc).not.toHaveBeenCalled();});
  it.each([409,400])("recognizes duplicate Storage refusal %s without retry",async(status)=>{const s=setup();s.bucket.upload.mockResolvedValue({data:null,error:{statusCode:String(status),message:"The resource already exists"}} as never);await expect(coverWriter(s.s).upload(path,new Uint8Array())).rejects.toMatchObject({definite:true,conflict:true});expect(s.bucket.upload).toHaveBeenCalledTimes(1);});
  it.each([0,408,499,500])("does not treat uncertain Storage %s as definitely absent",async(status)=>{const s=setup();s.bucket.upload.mockResolvedValue({data:null,error:{statusCode:String(status),message:"failure"}} as never);await expect(coverWriter(s.s).upload(path,new Uint8Array())).rejects.toMatchObject({definite:false});});
  it("rejects a mismatched upload path as uncertain",async()=>{const s=setup();s.bucket.upload.mockResolvedValue({data:{path:"other"},error:null});await expect(coverWriter(s.s).upload(path,new Uint8Array())).rejects.toMatchObject({definite:false});});
  it.each([["P0001",true],["P0002",true],["22023",true],["42501",true],["23503",false],["40003",false],["08006",false],["PGRST000",false],["",false]])("classifies RPC outcome %s",async(code,definite)=>{const s=setup();s.rpc.mockResolvedValue({data:null,error:{code,message:"private detail"}} as never);await expect(coverWriter(s.s).attach({id,userId,coverPath:null})).rejects.toMatchObject({definite});});
  it.each(["408","499","40003"])("never deletes after uncertain adapter outcome %s",async(code)=>{
    const s=setup(),writer=coverWriter(s.s),wish={id,userId,coverPath:null};
    if(code==="40003")s.rpc.mockResolvedValue({data:null,error:{code,message:"unknown completion"}} as never);
    else s.bucket.upload.mockResolvedValue({data:null,error:{statusCode:code,message:"timeout"}} as never);
    const bytes=new Uint8Array([255,216,255,0,0,0,0,0,0,0,255,217]),audit=vi.fn();
    await expect(uploadWishCover({wishId:id,bytes,mimeType:"image/jpeg"},{wish:async()=>wish,signedUrl:async()=>"unused"},()=>writer,audit)).rejects.toMatchObject({code:"COVER_CLEANUP_UNCONFIRMED",cleanup:"unconfirmed"});
    expect(s.bucket.remove).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledExactlyOnceWith({event:"wish_cover_cleanup_unconfirmed",wishId:id,coverPath:path,stage:code==="40003"?"association":"upload"});
  });
  it("rejects malformed attachment result without assuming rollback",async()=>{const s=setup();s.rpc.mockResolvedValue({data:{wishId:id,coverPath:"bad"},error:null});await expect(coverWriter(s.s).attach({id,userId,coverPath:null})).rejects.toMatchObject({definite:false});});
  it("does not claim delete succeeded on Storage error",async()=>{const s=setup();s.bucket.remove.mockResolvedValue({error:{message:"failure"}} as never);await expect(coverWriter(s.s).remove(path)).rejects.toThrow("not confirmed");});
  it("constructs privileged client only from server configuration",()=>{vi.stubEnv("SUPABASE_URL","https://dev.example.test");vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","server-only-test-key");const s=setup();mockCreateClient.mockReturnValue(s.s);createServerCoverWriter();expect(mockCreateClient).toHaveBeenCalledExactlyOnceWith("https://dev.example.test","server-only-test-key",{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});});
  it("fails closed with missing server config",()=>{vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY","");expect(()=>createServerCoverWriter()).toThrow("configuration unavailable");expect(mockCreateClient).not.toHaveBeenCalled();});
  it("reads Wish with the user client/RLS and signs for only 300 seconds",async()=>{const s=setup(),single=vi.fn(async()=>({data:{id,user_id:userId,cover_path:path},error:null})),eq=vi.fn(()=>({maybeSingle:single})),select=vi.fn(()=>({eq})),from=vi.fn(()=>({select}));const client={...s.s,from} as unknown as SupabaseClient;const r=createCoverReader(client);expect(await r.wish(id)).toEqual({id,userId,coverPath:path});expect(eq).toHaveBeenCalledWith("id",id);expect(await r.signedUrl(path)).toBe("signed");expect(s.bucket.createSignedUrl).toHaveBeenCalledExactlyOnceWith(path,300);});
  it.each([{data:null,error:null},{data:null,error:{message:"private"}},{data:{id,user_id:null,cover_path:null},error:null}])("handles missing/error/malformed owned read %#",async(result)=>{const single=vi.fn(async()=>result);const client={from:()=>({select:()=>({eq:()=>({maybeSingle:single})})})} as unknown as SupabaseClient;const r=createCoverReader(client);if(result.data===null&&!result.error)expect(await r.wish(id)).toBeNull();else await expect(r.wish(id)).rejects.toThrow();});
});
