import { useEffect, useRef } from "react";

export function CancelDailyItemConfirmation({ title, date, pending, error, onDismiss, onConfirm }: {
  title: string; date: string; pending: boolean; error: string | null;
  onDismiss: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  function dismiss() {
    if (pending) return;
    dialog.current?.close();
    onDismiss();
  }
  return <dialog ref={dialog} className="commit-dialog" aria-labelledby="cancel-item-title" aria-describedby="cancel-item-description"
    onCancel={(event) => { event.preventDefault(); dismiss(); }}>
    <h2 id="cancel-item-title">取消此日期的条目？</h2>
    <p id="cancel-item-description">「{title}」在 {date} 的记录将保留为已取消，仍计入完成率。不会取消全局任务；仅清除仍排在该日期的安排。</p>
    {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
    <div className="commit-dialog-actions">
      <button autoFocus className="secondary-button" type="button" disabled={pending} onClick={dismiss}>保留条目</button>
      <button className="primary-button" type="button" disabled={pending} onClick={onConfirm}>{pending ? "正在取消…" : error ? "重试取消" : "确认取消"}</button>
    </div>
  </dialog>;
}
