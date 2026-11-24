import { z } from "zod";

export const projectsQuerySchema = z.object({
  status: z.enum(["active", "paused", "completed"]).optional(),
  cursor: z.string().uuid().optional(),
  limit: z.string().regex(/^[1-9][0-9]?$/).transform(Number)
    .pipe(z.number().max(50)).optional().transform(value => value ?? 20),
}).strict();

export type ProjectsQuery = z.infer<typeof projectsQuerySchema>;
