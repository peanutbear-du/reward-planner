import { z } from "zod";

import { todayDateSchema } from "./today";

export const commitDailyPlanRequestSchema = z.object({
  date: todayDateSchema,
}).strict();
