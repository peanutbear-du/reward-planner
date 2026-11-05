import { describe,expect,it } from "vitest";
import { wishCoverRequestSchema } from "./wish-cover";
const id="70000000-0000-4000-8000-000000000ABC";
describe("Wish cover identity",()=>{
  it("normalizes UUID filename identity",()=>expect(wishCoverRequestSchema.parse({wishId:id})).toEqual({wishId:id.toLowerCase()}));
  it.each([{}, {wishId:"../path"},{wishId:"https://example.test/file.jpg"},{wishId:null},{wishId:id,path:"other"},{wishId:id,userId:id}])("rejects arbitrary paths and owner fields %#",(v)=>expect(wishCoverRequestSchema.safeParse(v).success).toBe(false));
});
