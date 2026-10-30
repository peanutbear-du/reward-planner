import { z } from "zod";
import { todayDateSchema } from "./today";

// The action targets a day relation, not a global Task or client-written result.
export const cancelDailyItemRequestSchema = z.object({
  date: todayDateSchema,
  itemId: z.string().uuid(),
}).strict();
