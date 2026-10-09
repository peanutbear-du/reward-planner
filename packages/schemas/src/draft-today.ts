import { z } from "zod";

import { todayDateSchema } from "./today";

export const upsertDraftTodayItemRequestSchema = z.object({
  date: todayDateSchema,
  taskId: z.string().uuid(),
  priority: z.enum(["must_do", "plan"]),
}).strict();

export const removeDraftTodayItemRequestSchema = z.object({
  date: todayDateSchema,
  taskId: z.string().uuid(),
}).strict();
