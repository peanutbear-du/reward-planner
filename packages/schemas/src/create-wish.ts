import { z } from "zod";

const title = z.string().trim().min(1);
const target = z.number().int().positive().max(2147483647);
const price = z.number().finite().nonnegative();
const why = z.string().trim().transform((value) => value || null);

export const createWishRequestSchema = z.object({
  title,
  target,
  referencePrice: price.nullable().optional().default(null),
  why: why.nullable().optional().default(null),
}).strict();

// Parse and project database results; do not forward private/unknown columns.
export const createdWishSchema = z.object({
  id: z.string().uuid(), title, target,
  status: z.literal("wishlist"), coverPath: z.null(),
  startedAt: z.null(), unlockedAt: z.null(), redeemedAt: z.null(),
  referencePrice: price.nullable(), why: z.string().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
