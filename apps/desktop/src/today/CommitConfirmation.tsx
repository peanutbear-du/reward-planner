import { useEffect, useRef } from "react";

export function CommitConfirmation({ disabled, pending, error, onCancel, onConfirm }: {
  disabled: boolean; pending: boolean; error: string | null; onCancel: () => void; onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    return () => element.close();
  }, []);
  function cancel() {
    if (pending) return;
    // Close while still mounted so the browser can restore the trigger's focus.
    dialog.current?.close();
    onCancel();
  }
  return <dialog ref={dialog} className="commit-dialog" aria-labelledby="commit-title" aria-describedby="commit-description"
    onCancel={(event) => { event.preventDefault(); cancel(); }}>
    <h2 id="commit-title">确认今日计划？</h2>
    <p id="commit-description">确认后将保存初始计划，之后新增的任务会单独记录。</p>
    {error ? <p className="form-message form-message-error" role="alert">{error}</p> : null}
    <div className="commit-dialog-actions">
      <button autoFocus className="secondary-button" type="button" disabled={pending} onClick={cancel}>返回编辑</button>
      <button className="primary-button" type="button" disabled={disabled} onClick={onConfirm}>{pending ? "正在确认…" : "确认并保存"}</button>
    </div>
  </dialog>;
}
