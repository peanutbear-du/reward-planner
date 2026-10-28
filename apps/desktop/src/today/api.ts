import {
  addLater, commitDailyPlan, createTask, getToday,
  removeDraftTodayItem, upsertDraftTodayItem, completeTask, uncompleteTask, TaskExecutionApiClientError,
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
  };
}

export function requestError(error: unknown): string {
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
