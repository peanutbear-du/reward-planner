import { useEffect, useRef, useState } from "react";
import { todayDateSchema } from "@reward-planner/schemas";

export function RescheduleDialog({ title, minDate, pending, error, onCancel, onConfirm }: {
  title: string; minDate: string; pending: boolean; error: string | null;
  onCancel: () => void; onConfirm: (targetDate: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [targetDate, setTargetDate] = useState(minDate);
  const valid = todayDateSchema.safeParse(targetDate).success && targetDate >= minDate;
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  function cancel() {
    if (pending) return;
    dialog.current?.close();
    onCancel();
  }
  return <dialog ref={dialog} className="commit-dialog" aria-labelledby="reschedule-title" aria-describedby="reschedule-description"
    onCancel={(event) => { event.preventDefault(); cancel(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (valid && !pending) onConfirm(targetDate); }}>
      <h2 id="reschedule-title">改期任务</h2>
      <p id="reschedule-description" className="supporting-copy">{title}：原日期将保留改期记录，并继续计入完成率分母。</p>
      <label className="form-field">目标日期
        <input autoFocus type="date" value={targetDate} min={minDate} required disabled={pending}
          onChange={(event) => setTargetDate(event.target.value)} />
      </label>
      {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
      <div className="commit-dialog-actions">
        <button className="secondary-button" type="button" disabled={pending} onClick={cancel}>取消</button>
        <button className="primary-button" type="submit" disabled={pending || !valid}>{pending ? "正在改期…" : error ? "重试改期" : "确认改期"}</button>
      </div>
    </form>
  </dialog>;
}
