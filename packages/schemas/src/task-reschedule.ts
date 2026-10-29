import { z } from "zod";
import { todayDateSchema } from "./today";

// Relative-to-Today checks belong to SQL with the authenticated user's timezone.
export const taskRescheduleRequestSchema = z.object({
  date: todayDateSchema,
  taskId: z.string().uuid(),
  targetDate: todayDateSchema,
}).strict().refine((input) => input.targetDate > input.date, {
  message: "targetDate must be later than date", path: ["targetDate"],
});
