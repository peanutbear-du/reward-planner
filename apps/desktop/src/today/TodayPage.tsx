import { useRef, useState } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { createTaskRequestSchema } from "@reward-planner/schemas";
import type { DailyPlanItemPriority, TodayItem } from "@reward-planner/types";

import divider from "../assets/plan-divider.svg";
import taskAccent from "../assets/task-accent.svg";
import { todayApi, requestError } from "./api";
import { formatDate, localDate, shiftDate } from "./date";
import { TaskItem } from "./TaskItem";
import { DailyStatus } from "./DailyStatus";
import { CommitConfirmation } from "./CommitConfirmation";
import { RescheduleDialog } from "./RescheduleDialog";
import { CancelDailyItemConfirmation } from "./CancelDailyItemConfirmation";

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
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [rescheduling, setRescheduling] = useState<TodayItem | null>(null);
  const [cancellingItem, setCancellingItem] = useState<TodayItem | null>(null);
  const addEntry = useRef<HTMLButtonElement>(null);
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
  const canCommit = !locked && !createdTaskId && !committed && !isAdding && !!query.data &&
    query.data.items.mustDo.length + query.data.items.plan.length > 0;

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

  function taskSection(title: string, items: TodayItem[], empty: string, actions = false) {
    return <section className="task-section" aria-label={title}>
      <div className="task-section-header">
        <h2>{title}{actions || title === "稍后新增" ? <span className="count">{items.length}</span> : null}</h2>
        {actions ? <div className="today-actions">
          <span className="plan-state">{query.data ? committed ? "计划已确认" : "计划草稿" : "每日计划"}</span>
          <div className="plan-action-icons" role="group" aria-label="今日计划操作">
            <button className="icon-button" type="button" aria-label="新增任务" title={isAdding ? "收起新增任务" : "新增任务"}
              aria-expanded={isAdding} aria-controls="create-task-form" disabled={locked || !!createdTaskId}
              onClick={() => setIsAdding(!isAdding)}>+</button>
            <button className="icon-button" type="button" aria-label="编辑计划草稿" aria-pressed={isEditing && !committed}
              title={committed ? "初始计划已确认，不可编辑" : isEditing ? "收起草稿编辑" : "编辑计划草稿"}
              disabled={locked || committed || !!createdTaskId} onClick={() => setIsEditing(!isEditing)}>✎</button>
            {!committed ? <button className="icon-button icon-button-primary" type="button" aria-label="确认今日计划"
              title={isAdding ? "请先完成或收起新增任务" : "确认今日计划"} disabled={!canCommit}
              onClick={() => { mutation.reset(); setIsConfirming(true); }}>✓</button> :
              <span className="confirmed-mark" title="计划已确认，初始计划已保存" aria-hidden="true">✓</span>}
          </div>
        </div> : null}
      </div>
      {items.length ? <ul className="task-list">{items.map((item) => <TaskItem
        key={item.id} item={item} editable={!committed && isEditing} disabled={locked || !!createdTaskId}
        executionAvailable={query.data?.execution.available === true}
        cancelAvailable={committed && item.resultStatus === "pending"}
        onCompletion={(completed) => run(async () => {
          await api.execute(date, item.taskId, completed);
          setNotice(completed ? "任务已完成。" : "已取消任务完成状态。");
        })}
        onPriority={(priority) => run(() => api.put(date, item.taskId, priority, false))}
        onRemove={() => run(() => api.remove(date, item.taskId))}
        onReschedule={() => { mutation.reset(); setRescheduling(item); }}
        onCancelItem={() => { mutation.reset(); setCancellingItem(item); }}
      />)}</ul> : <p className="empty-copy">{empty}</p>}
    </section>;
  }

  return <main className="main-content" aria-busy={busy}>
    <header className="page-header">
      <div className="page-title"><h1>{date === localDate() ? "今天" : "每日计划"}</h1>
        <div className="date-caption">
          <details className="date-picker">
            <summary title="选择日期">{formatDate(date)}</summary>
            <label className="date-picker-panel">选择日期
              <input type="date" aria-label="选择日期" value={date} disabled={busy || !!createdTaskId}
                onChange={(event) => { if (event.target.value) onDate(event.target.value); }} />
            </label>
          </details>
          <button type="button" className="refresh-button" aria-label="刷新" title="刷新每日计划" disabled={busy}
            onClick={() => { void query.refetch(); }}>↻</button>
        </div>
      </div>
      <div className="header-controls">
        <div className="view-switcher" role="group" aria-label="计划视图">
          <button type="button" aria-current="page" title="每日计划">日</button>
          <button type="button" disabled title="周视图尚未开放">周</button>
          <button type="button" disabled title="月视图尚未开放">月</button>
        </div>
        <div className="date-navigator" aria-label="日期切换">
          <button type="button" disabled={busy || !!createdTaskId} aria-label="前一天" title="前一天" onClick={() => onDate(shiftDate(date, -1))}>‹</button>
          <button type="button" disabled={busy || !!createdTaskId} onClick={() => onDate(localDate())}>今天</button>
          <button type="button" disabled={busy || !!createdTaskId} aria-label="后一天" title="后一天" onClick={() => onDate(shiftDate(date, 1))}>›</button>
        </div>
      </div>
    </header>
    <div className="today-layout">
      <div className="primary-column">
        {query.isPending ? <p role="status">正在加载每日计划…</p> : null}
        {query.isError ? <p className="form-message form-message-error" role="alert">{requestError(query.error)} 请点击刷新。</p> : null}
        {mutation.isError && !isConfirming && !rescheduling && !cancellingItem ? <p className="form-message form-message-error" role="alert">{requestError(mutation.error)}</p> : null}
        {notice || mutation.isPending || query.isFetching && !query.isPending ?
          <p className="operation-status" role="status">{mutation.isPending ? "正在保存…" : query.isFetching ? "正在刷新…" : notice}</p> : null}
        {query.data ? <>
          <div className="daily-plan">
            {taskSection("必须完成", query.data.items.mustDo, "还没有必须完成的任务。", true)}
            <div className="plan-divider"><img src={divider} alt="" /></div>
            {taskSection("计划", query.data.items.plan, "计划中还没有任务。")}
            {query.data.items.addedLater.length ? taskSection("稍后新增", query.data.items.addedLater, "") : null}
            <button ref={addEntry} className="add-task-entry" type="button" aria-label={isAdding ? "收起添加" : "添加任务"}
              aria-expanded={isAdding} aria-controls="create-task-form" disabled={locked || !!createdTaskId}
              onClick={() => setIsAdding(!isAdding)}>
              <span aria-hidden="true">{isAdding ? "−" : "+"}</span>
              {isAdding ? "收起添加" : committed ? "稍后新增任务会显示在这里，并计入今日完成率" : "添加任务，确认后可继续加入稍后新增任务"}
            </button>
            {isAdding ? <form id="create-task-form" className="create-task-form" onSubmit={submit} aria-label="新增任务"
              onKeyDown={(event) => { if (event.key === "Escape" && !createdTaskId && !busy) { setIsAdding(false); addEntry.current?.focus(); } }}>
              <fieldset disabled={locked}>
                <label className="sr-only" htmlFor="new-task-title">任务名称</label>
                <input id="new-task-title" {...form.register("title", { validate: (title) =>
                  createTaskRequestSchema.safeParse({ title, schedule: null }).success || "请输入任务名称。" })}
                  autoFocus readOnly={!!createdTaskId} placeholder="添加一项可执行的任务" />
                <label className="sr-only" htmlFor="new-task-priority">加入分组</label>
                <select id="new-task-priority" {...form.register("priority")} disabled={!!createdTaskId || locked}>
                  <option value="plan">计划</option><option value="must_do">必须完成</option>
                </select>
                <button className="icon-button icon-button-primary" type="submit" disabled={locked}
                  aria-label={createdTaskId ? "重试加入此任务" : committed ? "创建并稍后新增" : "创建并加入草稿"}
                  title={createdTaskId ? "重试加入此任务" : committed ? "创建并稍后新增" : "创建并加入草稿"}>✓</button>
                <button className="icon-button" type="button" aria-label="取消添加" title="取消添加" disabled={locked || !!createdTaskId}
                  onClick={() => { setIsAdding(false); addEntry.current?.focus(); }}>×</button>
              </fieldset>
              {form.formState.errors.title ? <p className="form-message form-message-error" role="alert">{form.formState.errors.title.message}</p> : null}
              {createdTaskId ? <p className="supporting-copy">任务已创建，尚待确认加入。重试将复用此任务；请完成加入后切换日期。</p> : null}
            </form> : null}
          </div>
          <section className="schedule-section" aria-label="日程">
            <div className="schedule-header"><h2>日程</h2><p className="section-caption">日历事件不计入今日完成率</p></div>
            {query.data.schedule.timedTasks.length ? <ul className="schedule-list">{query.data.schedule.timedTasks.map((task) =>
              <li className="schedule-item" key={task.planningItemId}>
                <time>{task.startTime.slice(0, 5)}</time>
                <div className="schedule-task"><img className="schedule-accent" src={taskAccent} alt="" />
                  <span>{task.title}</span><small>{task.startTime.slice(0, 5)}{task.endTime ? `–${task.endTime.slice(0, 5)}` : ""} · {task.countsTowardDaily ? "今日任务" : "定时任务 · 未加入每日计划"}</small>
                </div>
              </li>)}</ul> : <p className="empty-copy">当天没有定时任务。</p>}
            <p className="section-caption unavailable-caption">日历事件尚未接入。</p>
          </section>
        </> : null}
      </div>
      <aside className="context-rail" aria-label="每日概览">
        <DailyStatus status={query.data?.dailyStatus} failed={query.isError}
          isToday={date === (query.data?.execution.currentDate ?? localDate())} />
        <section className="context-section project-focus" aria-label="当前项目"><h2>当前项目</h2>
          <p className="empty-copy">尚未实现</p><p className="section-caption">项目接入后，将在这里显示相关项目。</p>
        </section>
      </aside>
    </div>
    {cancellingItem ? <CancelDailyItemConfirmation title={cancellingItem.title} date={date} pending={busy}
      error={mutation.isError ? requestError(mutation.error) : null}
      onDismiss={() => { setCancellingItem(null); mutation.reset(); }}
      onConfirm={() => run(async () => {
        await api.cancel(date, cancellingItem.id);
        setCancellingItem(null); setNotice("已取消此日期的条目，历史记录已保留。");
      })} /> : null}
    {rescheduling ? <RescheduleDialog title={rescheduling.title}
      minDate={shiftDate(query.data!.execution.currentDate, 1)} pending={busy}
      error={mutation.isError ? requestError(mutation.error) : null}
      onCancel={() => { setRescheduling(null); mutation.reset(); }}
      onConfirm={(targetDate) => run(async () => {
        await api.reschedule(date, rescheduling.taskId, targetDate);
        setRescheduling(null); setNotice(`任务已改期至 ${targetDate}。`);
      })} /> : null}
    {isConfirming ? <CommitConfirmation disabled={!canCommit} pending={mutation.isPending}
      error={mutation.isError ? requestError(mutation.error) : null}
      onCancel={() => setIsConfirming(false)} onConfirm={() => { if (canCommit) run(async () => {
        await api.commit(date); setIsConfirming(false); setIsEditing(false); setNotice("计划已确认，初始快照已保存。");
      }); }} /> : null}
  </main>;
}
