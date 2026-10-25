import { useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { createTaskRequestSchema } from "@reward-planner/schemas";
import type { DailyPlanItemPriority, TodayItem } from "@reward-planner/types";

import divider from "../assets/plan-divider.svg";
import taskAccent from "../assets/task-accent.svg";
import { todayApi, requestError } from "./api";
import { formatDate, localDate, shiftDate } from "./date";
import { TaskItem } from "./TaskItem";

export function TodayPage({ accessToken }: { accessToken: string }) {
  // This cache is discarded on sign out / user change with the page instance.
  const [client] = useState(() => new QueryClient({ defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false },
  } }));
  const [date, setDate] = useState(localDate);
  return <QueryClientProvider client={client}>
    <TodayContent key={date} accessToken={accessToken} date={date} onDate={setDate} />
  </QueryClientProvider>;
}

function TodayContent({ accessToken, date, onDate }: {
  accessToken: string; date: string; onDate: (date: string) => void;
}) {
  const api = todayApi(accessToken);
  const query = useQuery({ queryKey: ["today", date], queryFn: ({ signal }) => api.get(date, signal) });
  const [notice, setNotice] = useState("");
  const [createdTaskId, setCreatedTaskId] = useState<string | null>(null);
  const [isAdding, setIsAdding] = useState(false);
  const form = useForm<{ title: string; priority: DailyPlanItemPriority }>({
    defaultValues: { title: "", priority: "plan" },
  });
  const committed = query.data?.dailyPlan?.status === "committed";
  const mutation = useMutation({
    mutationFn: async (action: () => Promise<unknown>) => { await action(); },
    onSuccess: async () => { await query.refetch(); },
  });
  const busy = mutation.isPending || query.isFetching;
  const locked = busy || query.isError || !query.data;

  function run(action: () => Promise<unknown>) {
    setNotice("");
    mutation.mutate(action);
  }

  const submit = form.handleSubmit(({ title, priority }) => {
    run(async () => {
      // A failed relation command can be retried without creating another Task.
      let taskId = createdTaskId;
      if (!taskId) {
        const created = await api.create(title.trim());
        taskId = created.data.task.id;
        setCreatedTaskId(taskId);
      }
      await api.put(date, taskId, priority, committed);
      setCreatedTaskId(null);
      form.reset();
      setIsAdding(false);
      setNotice(committed ? "任务已加入稍后新增。" : "任务已加入计划草稿。");
    });
  });

  function taskSection(title: string, items: TodayItem[], empty: string) {
    return <section className="task-section" aria-label={title}>
      <h2>{title}<span className="count">{items.length}</span></h2>
      {items.length ? <ul className="task-list">{items.map((item) => <TaskItem
        key={item.id} item={item} editable={!committed} disabled={locked || !!createdTaskId}
        executionAvailable={query.data?.execution.available === true}
        onCompletion={(completed) => run(async () => {
          await api.execute(date, item.taskId, completed);
          setNotice(completed ? "任务已完成。" : "已取消任务完成状态。");
        })}
        onPriority={(priority) => run(() => api.put(date, item.taskId, priority, false))}
        onRemove={() => run(() => api.remove(date, item.taskId))}
      />)}</ul> : <p className="empty-copy">{empty}</p>}
    </section>;
  }

  return <main className="main-content">
    <header className="page-header">
      <div><h1>{date === localDate() ? "今天" : "每日计划"}</h1><p className="date-caption">{formatDate(date)}</p></div>
      <div className="date-navigator" aria-label="日期切换">
        <button type="button" disabled={busy || !!createdTaskId} aria-label="前一天" onClick={() => onDate(shiftDate(date, -1))}>‹</button>
        <button type="button" disabled={busy || !!createdTaskId} onClick={() => onDate(localDate())}>今天</button>
        <button type="button" disabled={busy || !!createdTaskId} aria-label="后一天" onClick={() => onDate(shiftDate(date, 1))}>›</button>
        <input type="date" aria-label="选择日期" value={date} disabled={busy || !!createdTaskId}
          onChange={(event) => { if (event.target.value) onDate(event.target.value); }} />
      </div>
    </header>
    <div className="today-layout">
      <div className="primary-column">
        <div className="plan-toolbar">
          <div className="plan-context">
            <span className="plan-state">{query.data ? committed ? "计划已确认" : "计划草稿" : "每日计划"}</span>
            <span className="operation-status" role="status">{mutation.isPending ? "正在保存…" : query.isFetching && !query.isPending ? "正在刷新…" : notice || (query.data ? committed ? "新增任务单独记录" : "编辑后确认初始计划" : "")}</span>
          </div>
          <button type="button" className="secondary-button" disabled={busy}
            onClick={() => { void query.refetch(); }}>刷新</button>
          {!committed ? <button type="button" className="primary-button"
            disabled={locked || !!createdTaskId || !query.data || query.data.items.mustDo.length + query.data.items.plan.length === 0}
            onClick={() => run(async () => { await api.commit(date); setNotice("计划已确认，初始快照已保存。"); })}>
            完成今日计划
          </button> : null}
        </div>
        {query.isPending ? <p role="status">正在加载每日计划…</p> : null}
        {query.isError ? <p className="form-message form-message-error" role="alert">{requestError(query.error)} 请点击刷新。</p> : null}
        {mutation.isError ? <p className="form-message form-message-error" role="alert">{requestError(mutation.error)}</p> : null}
        {query.data ? <>
          {taskSection("必须完成", query.data.items.mustDo, "还没有必须完成的任务。")}
          <div className="plan-divider"><img src={divider} alt="" /></div>
          {taskSection("计划", query.data.items.plan, "计划中还没有任务。")}
          {taskSection("稍后新增", query.data.items.addedLater, committed ? "确认计划后新增的任务会显示在这里。" : "确认计划后，可继续加入稍后新增任务。")}
          <button className="add-task-entry" type="button" aria-expanded={isAdding}
            aria-controls="create-task-form" disabled={locked || !!createdTaskId}
            onClick={() => setIsAdding(!isAdding)}>
            {isAdding ? "收起添加" : "＋ 添加任务"}
          </button>
          {isAdding ? <form id="create-task-form" className="create-task-form" onSubmit={submit} aria-label="新增任务">
            <fieldset disabled={locked}>
              <label className="form-field">任务名称
                <input {...form.register("title", { validate: (title) =>
                  createTaskRequestSchema.safeParse({ title, schedule: null }).success || "请输入任务名称。" })}
                  autoFocus readOnly={!!createdTaskId} placeholder="添加一项可执行的任务" />
              </label>
              <div className="create-task-actions">
                <label>加入分组 <select {...form.register("priority")} disabled={!!createdTaskId || locked}>
                  <option value="plan">计划</option><option value="must_do">必须完成</option>
                </select></label>
                <button className="primary-button" type="submit" disabled={locked}>{createdTaskId ? "重试加入此任务" : committed ? "创建并稍后新增" : "创建并加入草稿"}</button>
              </div>
            </fieldset>
            {form.formState.errors.title ? <p className="form-message form-message-error" role="alert">{form.formState.errors.title.message}</p> : null}
            {createdTaskId ? <p className="supporting-copy">任务已创建，尚待确认加入。重试将复用此任务；请完成加入后切换日期。</p> : null}
          </form> : null}
          <section className="schedule-section" aria-label="日程">
            <h2>日程</h2><p className="section-caption">日历事件不计入今日完成率</p>
            {query.data.schedule.timedTasks.length ? <ul className="schedule-list">{query.data.schedule.timedTasks.map((task) =>
              <li className="schedule-item" key={task.planningItemId}>
                <time>{task.startTime.slice(0, 5)}</time>
                <div className="schedule-task"><img className="schedule-accent" src={taskAccent} alt="" />
                  <span>{task.title}</span><small>{task.startTime.slice(0, 5)}{task.endTime ? `–${task.endTime.slice(0, 5)}` : ""} · {task.countsTowardDaily ? "今日任务" : "定时任务 · 未加入每日计划"}</small>
                </div>
              </li>)}</ul> : <p className="empty-copy">当天没有定时任务。</p>}
            <p className="section-caption">日历事件尚未接入。</p>
          </section>
        </> : null}
      </div>
      <aside className="context-rail" aria-label="每日概览">
        <section className="context-section"><h2>今日状态</h2><p className="empty-copy">尚未实现</p><p className="section-caption">每日达标状态将在后续阶段提供。</p></section>
        <section className="context-section"><h2>当前项目</h2><p className="empty-copy">尚未实现</p><p className="section-caption">项目接入后，将在这里显示相关项目。</p></section>
      </aside>
    </div>
  </main>;
}
