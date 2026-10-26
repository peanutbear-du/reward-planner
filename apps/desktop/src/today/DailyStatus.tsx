import type { DailyStatus as DailyStatusData } from "@reward-planner/types";

export function DailyStatus({ status, failed }: { status?: DailyStatusData; failed: boolean }) {
  return <section className="context-section daily-status" aria-label="每日完成情况">
    <h2>今日状态</h2>
    {failed ? <p className="empty-copy">每日状态加载失败，请刷新。</p> : !status ?
      <p className="empty-copy">正在加载每日状态…</p> : !status.available ?
        <p className="empty-copy">{status.reason === "draft" ? "确认计划后显示完成情况。" : "尚无每日计划。"}</p> : <>
          <div className="daily-status-numbers">
            <div><strong>{status.completedItems} / {status.totalItems}</strong><span>已完成当日任务</span></div>
            <div><strong>{status.completionRate}%</strong><span>当前完成率</span></div>
          </div>
          <div className="daily-completion-blocks" role="progressbar" aria-label="每日完成率"
            aria-valuemin={0} aria-valuemax={100} aria-valuenow={status.completionRate}>
            {Array.from({ length: 5 }, (_, index) => <span key={index} aria-hidden="true">
              <i style={{ width: `${Math.max(0, Math.min(100, (status.completionRate - index * 20) * 5))}%` }} />
            </span>)}
          </div>
          <div className="daily-qualification">
            <p>{status.isQualified ? "当日已达标" : status.totalItems === 0 ? "暂无可计入的任务" : "当日尚未达标"}</p>
            <span>必须完成 {status.completedMustDoItems} / {status.mustDoItems} · 达标需完成率 ≥ 80%</span>
          </div>
        </>}
  </section>;
}
