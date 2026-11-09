import { z } from "zod";

export const startWishRequestSchema = z.object({ wishId: z.string().uuid().transform(id => id.toLowerCase()) }).strict();
const timestamp = z.string().datetime({ offset: true });
export const wishLifecycleSchema = z.object({
  id: z.string().uuid(), title: z.string().min(1), target: z.number().int().positive().max(2147483647),
  status: z.enum(["wishlist", "unlocking", "unlocked", "redeemed"]),
  coverPath: z.string().nullable(), startedAt: timestamp.nullable(), unlockedAt: timestamp.nullable(),
  redeemedAt: timestamp.nullable(), updatedAt: timestamp, progress: z.number().int().nonnegative(),
}).refine(w => w.progress <= w.target, "Progress exceeds target");
export const startWishResponseSchema = z.object({
  data: z.object({
    changed: z.boolean(), wish: wishLifecycleSchema, previousWish: wishLifecycleSchema.nullable(),
    currentWishId: z.string().uuid().nullable(), pendingApplied: z.number().int().nonnegative().max(2147483647),
    pendingRemaining: z.string().regex(/^(0|[1-9][0-9]*)$/),
  }),
  effects: z.array(z.enum(["wish_started", "wish_resumed", "wish_switched", "pending_progress_applied", "wish_progress_changed", "wish_unlocked"])),
}).superRefine(({ data: d, effects }, ctx) => {
  const bad = (message: string) => ctx.addIssue({ code: "custom", message });
  if (!["unlocking", "unlocked"].includes(d.wish.status)) bad("Invalid target lifecycle state");
  if (d.currentWishId !== (d.wish.status === "unlocking" ? d.wish.id : null)) bad("Current Wish mismatch");
  if (d.previousWish && (d.previousWish.id === d.wish.id || d.previousWish.status !== "wishlist")) bad("Previous Wish mismatch");
  if (new Set(effects).size !== effects.length) bad("Duplicate effects");
  if (d.pendingApplied > d.wish.progress) bad("Applied progress mismatch");
  if (!d.changed && (effects.length || d.previousWish || d.pendingApplied || d.wish.status !== "unlocking")) bad("Invalid no-op");
  if (d.changed) {
    if (!d.wish.startedAt || Number(effects.includes("wish_started")) + Number(effects.includes("wish_resumed")) !== 1) bad("Missing start effect");
    if (effects.includes("wish_switched") !== (d.previousWish !== null)) bad("Switch effect mismatch");
    if (effects.includes("pending_progress_applied") !== (d.pendingApplied > 0)) bad("Pending effect mismatch");
    if (d.pendingApplied > 0 && !effects.includes("wish_progress_changed")) bad("Missing progress effect");
    if (effects.includes("wish_unlocked") !== (d.wish.status === "unlocked")) bad("Unlock effect mismatch");
    if (d.wish.status === "unlocked" && (!d.wish.unlockedAt || d.wish.progress !== d.wish.target)) bad("Invalid unlock");
  }
});
