import { z } from "zod";
import { todayDateSchema } from "./today";

// The endpoint selects the action; callers cannot supply owner, status or time.
export const taskExecutionRequestSchema = z.object({
  taskId: z.string().uuid(),
  date: todayDateSchema,
}).strict();
