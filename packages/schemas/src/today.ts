import { z } from "zod";

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;

export const todayDateSchema = z
  .string()
  .regex(isoDatePattern, "date must use YYYY-MM-DD")
  .refine(isValidCalendarDate, "date must be a valid calendar date");

export const todayQuerySchema = z
  .object({
    date: todayDateSchema,
  })
  .strict();

export type TodayQuery = z.infer<typeof todayQuerySchema>;

function isValidCalendarDate(value: string) {
  const match = isoDatePattern.exec(value);

  if (!match) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (year < 1 || month < 1 || month > 12 || day < 1) {
    return false;
  }

  const daysInMonth = [
    31,
    isLeapYear(year) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];

  return day <= daysInMonth[month - 1];
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
