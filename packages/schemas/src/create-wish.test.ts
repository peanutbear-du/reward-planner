import { describe, expect, it } from "vitest";
import { createWishRequestSchema } from "./create-wish";

const input = { title: "  Camera  ", target: 60 };
describe("Create Wish fields", () => {
  it.each([1, 20, 40, 60, 100, 137, 2147483647])("accepts preset/custom target %s", (target) => {
    expect(createWishRequestSchema.parse({ ...input, target })).toEqual({ title: "Camera", target, referencePrice: null, why: null });
  });
  it("normalizes optional metadata without treating price as target", () => {
    expect(createWishRequestSchema.parse({ ...input, referencePrice: 123.45, why: "  Learn photography  " }))
      .toMatchObject({ target: 60, referencePrice: 123.45, why: "Learn photography" });
    expect(createWishRequestSchema.parse({ ...input, referencePrice: 0, why: " \t " })).toMatchObject({ referencePrice: 0, why: null });
    expect(createWishRequestSchema.parse({ ...input, referencePrice: null, why: null })).toMatchObject({ referencePrice: null, why: null });
  });
  it.each([0, -1, 1.5, 2147483648, NaN, Infinity, "60", null, undefined])("rejects target %s", (target) => {
    expect(createWishRequestSchema.safeParse({ ...input, target }).success).toBe(false);
  });
  it.each(["", " \t\n ", null, 1, undefined])("rejects title %s", (title) => {
    expect(createWishRequestSchema.safeParse({ ...input, title }).success).toBe(false);
  });
  it.each([-1, NaN, Infinity, "12.50"])('rejects invalid price %s', (referencePrice) => {
    expect(createWishRequestSchema.safeParse({ ...input, referencePrice }).success).toBe(false);
  });
  it.each(["userId", "status", "coverPath", "startedAt", "amount", "progress", "id"])("rejects forged field %s", (key) => {
    expect(createWishRequestSchema.safeParse({ ...input, [key]: "forged" }).success).toBe(false);
  });
  it("rejects nontext Why", () => { expect(createWishRequestSchema.safeParse({ ...input, why: 1 }).success).toBe(false); });
});
