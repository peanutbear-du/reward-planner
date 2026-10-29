import type { DailyPlanItemPriority, TodayItem } from "@reward-planner/types";

interface TaskItemProps {
  item: TodayItem;
  editable: boolean;
  disabled: boolean;
  executionAvailable: boolean;
  onReschedule: () => void;
  onCompletion: (completed: boolean) => void;
  onPriority: (priority: DailyPlanItemPriority) => void;
  onRemove: () => void;
}

const results = {
  pending: "待完成", completed: "已完成", rescheduled: "已改期",
  cancelled: "已取消", incomplete: "未完成",
};

export function TaskItem({ item, editable, disabled, executionAvailable, onCompletion, onPriority, onRemove, onReschedule }: TaskItemProps) {
  const resultLabel = item.resultStatus === "rescheduled" && item.rescheduledToDate
    ? `已改期 → ${item.rescheduledToDate}` : results[item.resultStatus];
  return (
    <li className={`task-item ${item.priority === "must_do" ? "task-item-must" : ""}`}>
      <input className="task-marker" type="checkbox" aria-label={`完成任务：${item.title}`}
        checked={item.resultStatus === "completed"}
        disabled={disabled || !executionAvailable || !["pending", "completed"].includes(item.resultStatus)}
        onChange={(event) => onCompletion(event.target.checked)} />
      <div className="task-copy">
        <span>{item.title}</span>
        <small>
          {item.resultStatus !== "pending" ? `${resultLabel} · ` : ""}
          {item.plannedStartTime ? `${item.plannedStartTime.slice(0, 5)}${item.plannedEndTime ? `–${item.plannedEndTime.slice(0, 5)}` : ""}` : "未安排时间"}
          {item.origin === "added_later" ? ` · ${item.priority === "must_do" ? "必须完成" : "计划"}` : ""}
        </small>
      </div>
      {item.canReschedule ? <button className="text-button" type="button" disabled={disabled}
        aria-label={`改期${item.title}`} onClick={onReschedule}>改期</button> : null}
      {editable ? <div className="task-actions">
        <select aria-label={`${item.title}的优先级`} value={item.priority}
          disabled={disabled} onChange={(event) => onPriority(event.target.value as DailyPlanItemPriority)}>
          <option value="must_do">必须完成</option><option value="plan">计划</option>
        </select>
        <button className="text-button" type="button" disabled={disabled}
          aria-label={`移除${item.title}`} onClick={onRemove}>移除</button>
      </div> : null}
    </li>
  );
}
