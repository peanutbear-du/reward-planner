import type { DailyPlanItemPriority, TodayItem } from "@reward-planner/types";

interface TaskItemProps {
  item: TodayItem;
  editable: boolean;
  disabled: boolean;
  onPriority: (priority: DailyPlanItemPriority) => void;
  onRemove: () => void;
}

const results = {
  pending: "待完成", completed: "已完成", rescheduled: "已改期",
  cancelled: "已取消", incomplete: "未完成",
};

export function TaskItem({ item, editable, disabled, onPriority, onRemove }: TaskItemProps) {
  return (
    <li className={`task-item ${item.priority === "must_do" ? "task-item-must" : ""}`}>
      <span className="task-marker" aria-hidden="true" />
      <div className="task-copy">
        <span>{item.title}</span>
        <small>
          {results[item.resultStatus]}
          {item.plannedStartTime ? ` · ${item.plannedStartTime.slice(0, 5)}` : ""}
          {item.origin === "added_later" ? ` · ${item.priority === "must_do" ? "必须完成" : "计划"}` : ""}
          {item.rescheduledToDate ? ` → ${item.rescheduledToDate}` : ""}
        </small>
      </div>
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
