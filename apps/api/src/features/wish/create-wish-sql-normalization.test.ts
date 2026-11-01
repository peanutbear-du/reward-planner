import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createWishRequestSchema } from "@reward-planner/schemas";

const migration = readFileSync(new URL("../../../../../supabase/migrations/20261101000000_add_create_wish_command.sql", import.meta.url), "utf8");

describe("Create Wish SQL/TypeScript normalization contract (static, not SQL execution)", () => {
  it("declares exactly the ECMAScript trim set, independently of database locale", () => {
    const literal = /v_trim_chars constant text := U&'([^']+)'/.exec(migration)?.[1];
    expect(literal).toBeDefined();
    const codes = [...literal!.matchAll(/\\([0-9A-F]{4})/g)].map((m) => parseInt(m[1], 16));
    const expected = Array.from({ length: 65536 }, (_, code) => code).filter((code) => String.fromCharCode(code).trim() === "");
    expect(codes).toEqual(expected);
    expect(migration).toContain("pg_catalog.btrim(p_title, v_trim_chars)");
    expect(migration).toContain("nullif(pg_catalog.btrim(p_why, v_trim_chars), '')");
    for (const code of codes) {
      const c = String.fromCharCode(code);
      expect(createWishRequestSchema.parse({ title: `${c}Title${c}`, target: 1, why: `${c}Why${c}` }))
        .toMatchObject({ title: "Title", why: "Why" });
      expect(createWishRequestSchema.parse({ title: "Title", target: 1, why: c }).why).toBeNull();
    }
  });
  it("retains internal whitespace and non-ECMAScript trim characters", () => {
    expect(createWishRequestSchema.parse({ title: " A\tB ", target: 1, why: " C\nD " })).toMatchObject({ title: "A\tB", why: "C\nD" });
    for (const code of [0x85, 0x180e, 0x200b]) {
      const text = `${String.fromCharCode(code)}Title${String.fromCharCode(code)}`;
      expect(createWishRequestSchema.parse({ title: text, target: 1 }).title).toBe(text);
    }
  });
});
