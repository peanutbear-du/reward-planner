import { z } from "zod";

import { todayDateSchema } from "./today";

export const addLaterRequestSchema = z.object({
  date: todayDateSchema,
  taskId: z.string().uuid(),
  priority: z.enum(["must_do", "plan"]),
}).strict();
