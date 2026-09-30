import { z } from "zod";

import { todayDateSchema } from "./today";

export const taskTimeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "time must use HH:mm");

export const createTaskScheduleSchema = z
  .object({
    plannedDate: todayDateSchema,
    startTime: taskTimeSchema.nullable(),
    endTime: taskTimeSchema.nullable(),
  })
  .strict()
  .superRefine((schedule, context) => {
    if (schedule.endTime !== null && schedule.startTime === null) {
      context.addIssue({
        code: "custom",
        message: "endTime requires startTime",
        path: ["endTime"],
      });
      return;
    }

    if (
      schedule.startTime !== null &&
      schedule.endTime !== null &&
      schedule.endTime <= schedule.startTime
    ) {
      context.addIssue({
        code: "custom",
        message: "endTime must be later than startTime",
        path: ["endTime"],
      });
    }
  });

export const createTaskRequestSchema = z
  .object({
    title: z.string().transform((title) => title.trim()).pipe(z.string().min(1)),
    schedule: createTaskScheduleSchema.nullable(),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskRequestSchema>;
