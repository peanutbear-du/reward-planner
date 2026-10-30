import {
  addLater, commitDailyPlan, createTask, getToday,
  removeDraftTodayItem, upsertDraftTodayItem, completeTask, uncompleteTask, TaskExecutionApiClientError,
  rescheduleTask, TaskRescheduleApiClientError,
  cancelDailyItem, CancelDailyItemApiClientError,
} from "@reward-planner/api-client";
import type { DailyPlanItemPriority } from "@reward-planner/types";

export function todayApi(accessToken: string) {
  // Same origin in development goes through Vite's /api proxy. A deployed
  // desktop can explicitly configure its Business API origin.
  const options = {
    accessToken,
    apiBaseUrl: import.meta.env.VITE_API_BASE_URL || window.location.origin,
  };
  return {
    get: (date: string, signal: AbortSignal) => getToday({ ...options, date, signal }),
    create: (title: string) => createTask({ ...options, input: { title, schedule: null } }),
    put: (date: string, taskId: string, priority: DailyPlanItemPriority, committed: boolean) =>
      committed
        ? addLater({ ...options, input: { date, taskId, priority } })
        : upsertDraftTodayItem({ ...options, input: { date, taskId, priority } }),
    remove: (date: string, taskId: string) => removeDraftTodayItem({ ...options, input: { date, taskId } }),
    commit: (date: string) => commitDailyPlan({ ...options, input: { date } }),
    execute: (date: string, taskId: string, completed: boolean) =>
      (completed ? completeTask : uncompleteTask)({ ...options, input: { date, taskId } }),
    reschedule: (date: string, taskId: string, targetDate: string) =>
      rescheduleTask({ ...options, input: { date, taskId, targetDate } }),
    cancel: (date: string, itemId: string) => cancelDailyItem({ ...options, input: { date, itemId } }),
  };
}

export function requestError(error: unknown): string {
  if (error instanceof CancelDailyItemApiClientError) {
    if (error.code === "DAILY_ITEM_CANCEL_NOT_ALLOWED") return "只能取消待完成的条目；此条目已完成、改期或不再允许取消，请刷新。";
    if (error.code === "DAILY_PLAN_NOT_COMMITTED") return "只有已确认计划中的条目可以取消；草稿请使用移除。";
    if (error.code === "INVALID_CANCEL_REQUEST") return "取消请求无效，请检查日期并刷新后重试。";
  }
  if (error instanceof TaskRescheduleApiClientError) {
    if (error.code === "INVALID_RESCHEDULE_DATE") return "目标日期须晚于用户时区今天及原日期，请刷新后重新选择。";
    if (error.code === "RESCHEDULE_TARGET_CONFLICT") return "目标日期已有此任务条目，无法覆盖，请选择其他日期。";
    if (error.code === "RESCHEDULE_PLANNING_CONFLICT") return "此任务已有其他日期的排期，请刷新并核对安排。";
    if (error.code === "TASK_ALREADY_RESCHEDULED") return "此条目已改期至其他日期，请刷新查看。";
    if (["TASK_RESCHEDULE_NOT_ALLOWED", "DAILY_ITEM_RESCHEDULE_NOT_ALLOWED"].includes(error.code ?? "")) return "只能改期已确认计划中待完成的普通任务，请刷新。";
    if (error.code === "INVALID_USER_TIMEZONE") return "用户时区无效，暂时无法改期。";
  }
  if (error instanceof TaskExecutionApiClientError) {
    if (error.code === "TASK_DATE_NOT_CURRENT") return "只能更新用户时区当天的执行状态，请刷新日期。";
    if (error.code === "DAILY_PLAN_NOT_COMMITTED") return "请先确认今日计划，再勾选任务。";
    if (error.code === "DAILY_ITEM_EXECUTION_NOT_ALLOWED") return "此任务已改期、取消或不再允许执行，请刷新。";
    if (error.code === "INVALID_USER_TIMEZONE") return "用户时区无效，暂时无法更新执行状态。";
  }
  const status = error && typeof error === "object" && "status" in error ? error.status : null;
  if (status === 401) return "登录已失效，请退出后重新登录。";
  if (status === 403 || status === 404) return "无法访问此任务或计划，请刷新页面。";
  if (status === 409) return "计划状态已改变，请刷新后重试。";
  if (status === 400) return "请求未被接受，请检查计划内容后重试。";
  return "请求失败，请检查网络和服务连接后重试。";
}
