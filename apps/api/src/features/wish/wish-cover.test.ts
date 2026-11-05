import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { uploadWishCover, getWishCoverUrl, validateCover, MAX_COVER_BYTES, CoverLinkError, StorageUploadError, type CoverReader, type CoverWriter } from "./wish-cover";

const id = "70000000-0000-4000-8000-000000000101", userId = "00000000-0000-4000-8000-000000000101";
const path = `${userId}/${id}.jpg`, w = { id, userId, coverPath: null };
const jpeg = new Uint8Array(readFileSync(new URL("../../../../../supabase/tests/fixtures/wish-cover.jpg", import.meta.url)));
const input = { wishId: id, bytes: jpeg, mimeType: "image/jpeg" };
function setup() {
  const reader: CoverReader = { wish: vi.fn(async () => w), signedUrl: vi.fn(async () => "https://example.test/private?token=test") };
  const writer: CoverWriter = { upload: vi.fn(async () => {}), attach: vi.fn(async () => {}), remove: vi.fn(async () => {}) };
  return { reader, writer, factory: vi.fn(() => writer), audit: vi.fn() };
}
describe("Wish cover domain", () => {
  it("validates JPEG and associates only a canonical path, no client path/filename", async () => {
    const s = setup(); expect(await uploadWishCover(input, s.reader, s.factory, s.audit)).toEqual({ data: { wishId: id, coverPath: path }, effects: ["wish_cover_uploaded"] });
    expect(s.writer.upload).toHaveBeenCalledExactlyOnceWith(path, jpeg); expect(s.writer.attach).toHaveBeenCalledExactlyOnceWith(w);
    expect(s.writer.remove).not.toHaveBeenCalled();
  });
  it.each([
    { bytes: new Uint8Array(), mimeType: "image/jpeg" }, { bytes: jpeg, mimeType: "image/png" },
    { bytes: new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]), mimeType: "image/jpeg" },
    { bytes: jpeg.slice(0,-2), mimeType: "image/jpeg" }, { bytes: new Uint8Array([255,216,255,217]), mimeType: "image/jpeg" },
  ])("rejects empty/spoofed MIME/signature/truncated input %# before any writer", async (file) => {
    const s = setup(); await expect(uploadWishCover({ ...input, ...file }, s.reader, s.factory, s.audit)).rejects.toMatchObject({ code: "INVALID_JPEG" });
    expect(s.factory).not.toHaveBeenCalled(); expect(s.reader.wish).not.toHaveBeenCalled();
  });
  it("enforces actual 5 MiB limit with an inclusive boundary", () => {
    const bytes = new Uint8Array(MAX_COVER_BYTES); bytes.set(jpeg.subarray(0,3)); bytes.set([255,217],bytes.length-2);
    expect(() => validateCover(bytes,"image/jpeg")).not.toThrow(); expect(() => validateCover(new Uint8Array(MAX_COVER_BYTES+1),"image/jpeg")).toThrow("FILE_TOO_LARGE");
  });
  it("rejects missing/foreign Wish before constructing privileged writer", async () => {
    const s = setup(); vi.mocked(s.reader.wish).mockResolvedValue(null);
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({ code: "WISH_NOT_FOUND" }); expect(s.factory).not.toHaveBeenCalled();
  });
  it("rejects an existing cover without uploading or deleting", async () => {
    const s = setup(); vi.mocked(s.reader.wish).mockResolvedValue({ ...w, coverPath: path });
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({ code: "WISH_COVER_EXISTS" }); expect(s.factory).not.toHaveBeenCalled();
  });
  it("refuses malformed owned lookup identity", async () => {
    const s = setup(); vi.mocked(s.reader.wish).mockResolvedValue({ ...w,id:"other" });
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toThrow("Invalid owned Wish"); expect(s.factory).not.toHaveBeenCalled();
  });
  it("does not attach/delete after a duplicate Storage conflict", async () => {
    const s = setup(); vi.mocked(s.writer.upload).mockRejectedValue(new StorageUploadError(true,true));
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({ code:"COVER_UPLOAD_CONFLICT", cleanup:"not_required" });
    expect(s.writer.attach).not.toHaveBeenCalled(); expect(s.writer.remove).not.toHaveBeenCalled();
  });
  it("reports a confirmed upload refusal without cleanup or retry", async () => {
    const s=setup(); vi.mocked(s.writer.upload).mockRejectedValue(new StorageUploadError(true));
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({code:"COVER_UPLOAD_FAILED"}); expect(s.writer.upload).toHaveBeenCalledTimes(1);
  });
  it("does not claim cleanup or delete on an uncertain upload outcome", async () => {
    const s=setup(); vi.mocked(s.writer.upload).mockRejectedValue(Error("network"));
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({code:"COVER_CLEANUP_UNCONFIRMED",cleanup:"unconfirmed"});
    expect(s.writer.remove).not.toHaveBeenCalled(); expect(s.audit).toHaveBeenCalledWith({event:"wish_cover_cleanup_unconfirmed",wishId:id,coverPath:path,stage:"upload"});
  });
  it("removes only its newly uploaded object after a definite association rejection", async () => {
    const s=setup(); vi.mocked(s.writer.attach).mockRejectedValue(new CoverLinkError(true));
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({code:"COVER_LINK_FAILED",cleanup:"removed"});
    expect(s.writer.remove).toHaveBeenCalledExactlyOnceWith(path);
  });
  it("recognizes committed association after a lost response and never deletes it", async () => {
    const s=setup(); vi.mocked(s.writer.attach).mockRejectedValue(new CoverLinkError(false));
    vi.mocked(s.reader.wish).mockResolvedValueOnce(w).mockResolvedValueOnce({...w,coverPath:path});
    expect((await uploadWishCover(input,s.reader,s.factory,s.audit)).data.coverPath).toBe(path); expect(s.writer.remove).not.toHaveBeenCalled();
  });
  it.each(["uncertain", "readback", "remove"])("records unconfirmed cleanup at %s failure", async (failure) => {
    const s=setup(); vi.mocked(s.writer.attach).mockRejectedValue(new CoverLinkError(failure!=="uncertain"));
    if(failure==="readback")vi.mocked(s.reader.wish).mockResolvedValueOnce(w).mockRejectedValueOnce(Error("network"));
    if(failure==="remove")vi.mocked(s.writer.remove).mockRejectedValue(Error("network"));
    await expect(uploadWishCover(input,s.reader,s.factory,s.audit)).rejects.toMatchObject({code:"COVER_CLEANUP_UNCONFIRMED",cleanup:"unconfirmed"});
    expect(s.audit).toHaveBeenCalledExactlyOnceWith({event:"wish_cover_cleanup_unconfirmed",wishId:id,coverPath:path,stage:"association"});
    if(failure!=="remove")expect(s.writer.remove).not.toHaveBeenCalled();
  });
  it("makes concurrent requests compete through non-upsert upload, never deleting the winner", async () => {
    const s=setup(); vi.mocked(s.writer.upload).mockImplementationOnce(async()=>{}).mockRejectedValueOnce(new StorageUploadError(true,true));
    const r=await Promise.allSettled([uploadWishCover(input,s.reader,s.factory,s.audit),uploadWishCover(input,s.reader,s.factory,s.audit)]);
    expect(r.filter(x=>x.status==="fulfilled")).toHaveLength(1); expect(s.writer.attach).toHaveBeenCalledTimes(1); expect(s.writer.remove).not.toHaveBeenCalled();
  });
  it("provides an expiring private read using the user-scoped reader", async () => {
    const s=setup(); vi.mocked(s.reader.wish).mockResolvedValue({...w,coverPath:path});
    expect((await getWishCoverUrl(id,s.reader)).data).toMatchObject({wishId:id,expiresIn:300}); expect(s.reader.signedUrl).toHaveBeenCalledExactlyOnceWith(path);
  });
  it.each([null,"https://example.test/cover.jpg","other/path.jpg"])("rejects absent/noncanonical cover %s", async (coverPath) => {
    const s=setup(); vi.mocked(s.reader.wish).mockResolvedValue({...w,coverPath});
    await expect(getWishCoverUrl(id,s.reader)).rejects.toMatchObject({code:coverPath===null?"COVER_NOT_FOUND":"COVER_READ_FAILED"}); expect(s.reader.signedUrl).not.toHaveBeenCalled();
  });
  it("hides signed URL service failure", async()=>{const s=setup();vi.mocked(s.reader.wish).mockResolvedValue({...w,coverPath:path});vi.mocked(s.reader.signedUrl).mockRejectedValue(Error("secret"));await expect(getWishCoverUrl(id,s.reader)).rejects.toMatchObject({code:"COVER_READ_FAILED"});});
});
