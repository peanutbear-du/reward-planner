import { z } from "zod";
import { todayDateSchema } from "./today";

const title = z.string().trim().min(1);
const scale = z.enum(["small", "medium", "large", "major"]);
const date = todayDateSchema.nullable();
const timestamp = z.string().datetime({ offset: true });

export const createProjectRequestSchema = z.object({
  title,
  scale,
  deadline: date.optional().default(null),
  milestones: z.array(z.object({
    title,
    dueDate: date.optional().default(null),
  }).strict()).min(1),
}).strict();

// Project persisted fields into the public response without forwarding private columns.
export const createdProjectDataSchema = z.object({
  project: z.object({
    id: z.string().uuid(),
    title,
    scale,
    status: z.literal("active"),
    rewardPool: z.number().int().positive(),
    deadline: date,
    scaleLocked: z.literal(false),
    createdAt: timestamp,
    updatedAt: timestamp,
  }),
  milestones: z.array(z.object({
    id: z.string().uuid(),
    projectId: z.string().uuid(),
    title,
    status: z.literal("pending"),
    rewardValue: z.number().int().nonnegative(),
    dueDate: date,
  })).min(1),
});
