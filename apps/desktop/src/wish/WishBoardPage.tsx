import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { QueryClient, QueryClientProvider, useMutation, useQuery } from "@tanstack/react-query";
import { createWish, getWishBoard, getWishCoverUrl, startWish, switchWish } from "@reward-planner/api-client";
import { createWishRequestSchema } from "@reward-planner/schemas";
import type { CreateWishRequest, WishBoardResponse, WishBoardWish } from "@reward-planner/types";
import "./wish-board.css";

const queryKey = ["wish-board"] as const;
const shortDate = new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" });
const detailDate = new Intl.DateTimeFormat("zh-CN", { dateStyle: "long" });
const targetPresets = [20, 40, 60, 100, "custom"] as const;

function useWishCover(wish: WishBoardWish | undefined, options: { accessToken: string; apiBaseUrl: string }) {
  return useQuery({
    queryKey: ["wish-cover", wish?.id],
    queryFn: ({ signal }) => getWishCoverUrl({ ...options, wishId: wish!.id, signal }),
    enabled: !!wish?.hasCover,
    staleTime: 240_000,
  }).data?.data.signedUrl;
}

type Action = { kind: "create"; input: CreateWishRequest } | { kind: "start" | "switch"; wishId: string };

export function WishBoardPage({ accessToken }: { accessToken: string }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
    mutations: { retry: false },
  } }));
  return <QueryClientProvider client={client}><WishBoardContent accessToken={accessToken} /></QueryClientProvider>;
}

function WishBoardContent({ accessToken }: { accessToken: string }) {
  const options = { accessToken, apiBaseUrl: import.meta.env.VITE_API_BASE_URL || window.location.origin };
  const board = useQuery({ queryKey, queryFn: ({ signal }) => getWishBoard({ ...options, signal }) });
  const [creating, setCreating] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const mutation = useMutation({
    mutationFn: async (action: Action) => {
      if (action.kind === "create") {
        await createWish({ ...options, input: action.input });
      } else {
        await (action.kind === "start" ? startWish : switchWish)({ ...options, input: { wishId: action.wishId } });
      }
    },
    onSuccess: async () => {
      setCreating(false);
      setSwitching(false);
      await board.refetch();
    },
    onError: async error => {
      const status = "status" in error ? error.status : undefined;
      if (status !== 400) setCreating(false);
      setMessage(status === 401 ? "登录已失效，请重新登录。"
        : status === 400 ? "请求未被接受，请检查愿望内容。"
        : "操作未能确认，请刷新后核对愿望状态。");
      await board.refetch();
    },
  });
  const busy = board.isFetching || mutation.isPending;
  const current = board.data?.wishes.find(wish => wish.status === "unlocking");
  const wishlist = board.data?.wishes.filter(wish => wish.status === "wishlist") ?? [];
  const completed = board.data?.wishes.filter(wish => wish.status === "unlocked" || wish.status === "redeemed") ?? [];
  const detailWish = completed.find(wish => wish.id === detailId);
  const currentCover = useWishCover(current, options);
  const detailCover = useWishCover(detailWish, options);

  function run(action: Action) {
    setMessage("");
    mutation.mutate(action);
  }

  return <main className="main-content wish-board">
    <header className="page-header wish-page-header">
      <div>
        <h1>愿望板</h1>
        <p>把长期目标变成看得见的进度</p>
      </div>
      <button type="button" className="primary-button" disabled={busy || board.isError || !board.data}
        onClick={() => { setMessage(""); setCreating(true); }}>＋ 新建愿望</button>
    </header>
    {message && !creating && !switching ? <p className="form-message form-message-error" role="alert">{message}</p> : null}
    {board.isPending ? <p role="status" className="wish-panel wish-state">正在加载愿望…</p>
      : board.isError ? <div className="wish-panel wish-state" role="alert">
        <p>暂时无法读取愿望板。</p>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void board.refetch()}>重新加载</button>
      </div> : <>
        {current ? <CurrentWish wish={current} recentRewards={board.data.recentDailyRewards}
          coverUrl={currentCover} canSwitch={wishlist.length > 0 && !busy}
          onSwitch={() => { setMessage(""); setSwitching(true); }} />
          : <section className="wish-panel wish-state" aria-label="当前愿望">
            <h2>还没有正在解锁的愿望</h2>
            <p>{wishlist.length ? "从下方愿望清单选择一个愿望开始。" : "新建一个愿望，让每天的进度有个去处。"}</p>
            <RewardRules />
            <RecentRewards rewards={board.data.recentDailyRewards} />
          </section>}
        <div className="wish-panel wish-library">
          <section aria-labelledby="wish-list-title">
            <div className="wish-list-header"><h2 id="wish-list-title">愿望清单</h2><span>{wishlist.length}</span></div>
            {wishlist.length ? <ul>{wishlist.map(wish => <li className="wish-row" key={wish.id}>
              <WishRowCopy wish={wish} description={wish.why} />
              <div className="wish-row-status">
                <span>{wish.startedAt ? `${wish.progress} / ${wish.target}` : `目标 ${wish.target}`}</span>
                <button type="button" className="wish-pill" disabled={busy} aria-label={`${current ? "切换到" : "开始解锁"}${wish.title}`}
                  onClick={() => run({ kind: current ? "switch" : "start", wishId: wish.id })}>
                  {current ? "切换愿望" : wish.startedAt ? "继续解锁" : "开始解锁"}
                </button>
              </div>
            </li>)}</ul> : <p className="empty-copy">愿望清单是空的。</p>}
          </section>
          <section aria-labelledby="wish-completed-title">
            <div className="wish-list-header"><h2 id="wish-completed-title">已完成</h2><span>{completed.length}</span></div>
            {completed.length ? <ul>{completed.map(wish => {
              const label = wish.status === "redeemed" ? "已兑换" : "已解锁";
              const date = wish.status === "redeemed" ? wish.redeemedAt : wish.unlockedAt;
              return <li className="wish-row" key={wish.id}>
                <WishRowCopy wish={wish} description={date ? `${shortDate.format(new Date(date))} ${label}` : label} />
                <div className="wish-row-status wish-completed-actions">
                  <span>{wish.progress} / {wish.target}</span><small>{label}</small>
                  <button type="button" className="wish-pill" aria-label={`查看详情：${wish.title}`}
                    onClick={() => setDetailId(wish.id)}>查看详情</button>
                </div>
              </li>;
            })}</ul> : <p className="empty-copy">还没有已完成的愿望。</p>}
          </section>
        </div>
      </>}
    {creating ? <CreateWishDialog pending={busy} message={message} onCancel={() => setCreating(false)}
      onCreate={input => run({ kind: "create", input })} /> : null}
    {switching ? <WishDialog title="切换愿望" pending={mutation.isPending} onCancel={() => setSwitching(false)}>
      <p>当前愿望会回到愿望清单，已有进度会保留。</p>
      {message ? <p className="form-message form-message-error" role="alert">{message}</p> : null}
      <ul className="wish-switch-list">{wishlist.map(wish => <li key={wish.id}>
        <button type="button" className="secondary-button" disabled={busy || board.isError}
          onClick={() => run({ kind: "switch", wishId: wish.id })}>{wish.title}</button>
      </li>)}</ul>
      <button type="button" className="secondary-button" disabled={mutation.isPending} onClick={() => setSwitching(false)}>取消</button>
    </WishDialog> : null}
    {detailWish ? <CompletedWishDialog wish={detailWish} coverUrl={detailCover}
      onClose={() => setDetailId(null)} /> : null}
  </main>;
}

function WishRowCopy({ wish, description }: { wish: WishBoardWish; description: string | null }) {
  return <div className="wish-row-copy">
    <h3>{wish.title}</h3>
    {description ? <p>{description}</p> : null}
  </div>;
}

function CurrentWish({ wish, recentRewards, coverUrl, canSwitch, onSwitch }: {
  wish: WishBoardWish;
  recentRewards: WishBoardResponse["recentDailyRewards"];
  coverUrl?: string;
  canSwitch: boolean;
  onSwitch: () => void;
}) {
  const progress = Math.min(wish.target, Math.max(0, wish.progress));
  const cells = Math.floor(progress * 60 / wish.target);
  const percent = Math.floor(progress * 100 / wish.target);
  return <section className="wish-panel wish-current" aria-labelledby="current-wish-title">
    <header className="wish-current-header">
      <div className="wish-identity">
        {coverUrl ? <img className="wish-cover" src={coverUrl} alt="" />
          : <span className="wish-cover wish-cover-placeholder" aria-hidden="true"><i /><i /><i /><i /></span>}
        <div><p className="wish-label wish-accent">正在解锁</p><h2 id="current-wish-title">{wish.title}</h2></div>
      </div>
      <button type="button" className="secondary-button wish-switch-button" disabled={!canSwitch} onClick={onSwitch}>
        <span aria-hidden="true">⇄</span> 切换愿望
      </button>
    </header>
    <div className="wish-hero">
      <div className="wish-summary">
        <p className="wish-label">当前愿望进度</p>
        <p className="wish-amount"><strong>{wish.progress}</strong> <span>/ {wish.target}</span></p>
        <p className="wish-remaining">还差 {Math.max(0, wish.target - wish.progress)} 点进度解锁</p>
        <RewardRules />
        {wish.why ? <div className="wish-reason"><p className="wish-label">为什么想实现</p><p>{wish.why}</p></div> : null}
        <RecentRewards rewards={recentRewards} />
      </div>
      <div className="wish-grid-area">
        <div className="wish-grid-caption"><span className="wish-label">60 格</span><span>{percent}% 已解锁</span></div>
        <div className="wish-grid" role="img" aria-label={`愿望进度 ${wish.progress} / ${wish.target}，${percent}%`}>
          {Array.from({ length: 60 }, (_, index) => <span key={index} className={index < cells ? "is-filled" : undefined} />)}
        </div>
      </div>
    </div>
  </section>;
}

function RecentRewards({ rewards }: { rewards: WishBoardResponse["recentDailyRewards"] }) {
  return <section className="wish-rewards" aria-labelledby="wish-rewards-title">
    <h3 id="wish-rewards-title">近期账户奖励</h3>
    {rewards.length ? <>
      <p className="wish-rewards-note">此处记录全账户奖励，当前愿望进度以实际分配为准。</p>
      <ul>{rewards.map(reward => <li key={reward.id}>
      <strong>+{reward.amount}</strong>
      <time dateTime={reward.createdAt}>{shortDate.format(new Date(reward.createdAt))}</time>
      <span>合格日奖励</span>
      {reward.destinations?.length ? <span className="wish-reward-destination">
        {reward.destinations.map(destination => destination.kind === "wish"
          ? `已分配给「${destination.title}」` : "待分配进度").join("、")}
      </span> : null}
    </li>)}</ul></> : <p className="empty-copy">暂无合格日奖励。</p>}
  </section>;
}

function RewardRules() {
  return <div className="wish-explainer">
    <p>合格日 +1</p>
    <p>完成项目里程碑可获得额外进度（后续接入）</p>
  </div>;
}

function CompletedWishDialog({ wish, coverUrl, onClose }: {
  wish: WishBoardWish; coverUrl?: string; onClose: () => void;
}) {
  return <WishDialog title={wish.title} pending={false} onCancel={onClose}>
    {coverUrl ? <img className="wish-detail-cover" src={coverUrl} alt="愿望封面" /> : null}
    <dl className="wish-detail-fields">
      <div><dt>状态</dt><dd>{wish.status === "redeemed" ? "已兑换" : "已解锁"}</dd></div>
      <div><dt>进度</dt><dd>{wish.progress} / {wish.target}</dd></div>
      <div><dt>目标</dt><dd>{wish.target}</dd></div>
      {wish.why ? <div><dt>许愿理由</dt><dd>{wish.why}</dd></div> : null}
      {wish.unlockedAt ? <div><dt>解锁日期</dt><dd>{detailDate.format(new Date(wish.unlockedAt))}</dd></div> : null}
      {wish.redeemedAt ? <div><dt>兑换日期</dt><dd>{detailDate.format(new Date(wish.redeemedAt))}</dd></div> : null}
    </dl>
    <div className="commit-dialog-actions">
      <button className="secondary-button" type="button" onClick={onClose}>关闭</button>
    </div>
  </WishDialog>;
}

function WishDialog({ title, pending, onCancel, children }: {
  title: string; pending: boolean; onCancel: () => void; children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current!;
    const trigger = document.activeElement;
    element.showModal();
    return () => {
      element.close();
      if (trigger instanceof HTMLElement && trigger.isConnected) trigger.focus();
    };
  }, []);
  return <dialog ref={dialog} className="commit-dialog wish-dialog" aria-labelledby="wish-dialog-title"
    onCancel={event => { event.preventDefault(); if (!pending) onCancel(); }}>
    <h2 id="wish-dialog-title">{title}</h2>
    {children}
  </dialog>;
}

function CreateWishDialog({ pending, message, onCancel, onCreate }: {
  pending: boolean; message: string; onCancel: () => void; onCreate: (input: CreateWishRequest) => void;
}) {
  const [validation, setValidation] = useState("");
  const [target, setTarget] = useState<typeof targetPresets[number]>(60);
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const parsed = createWishRequestSchema.safeParse({
      title: form.get("title"), target: target === "custom" ? Number(form.get("customTarget")) : target,
      why: form.get("why"),
    });
    if (!parsed.success) { setValidation("请输入愿望名称和有效的进度目标。"); return; }
    setValidation("");
    onCreate(parsed.data);
  }
  return <WishDialog title="新建愿望" pending={pending} onCancel={onCancel}>
    <form className="wish-form" onSubmit={submit}>
      <label>愿望名称<input name="title" required /></label>
      <fieldset className="wish-target">
        <legend>进度目标</legend>
        <div className="wish-target-options">{targetPresets.map(preset => (
          <label key={preset}>
            <input type="radio" name="targetPreset" checked={target === preset} onChange={() => setTarget(preset)} />
            <span>{preset === "custom" ? "自定义" : preset}</span>
          </label>
        ))}</div>
        {target === "custom" ? <label className="wish-custom-target">自定义进度目标
          <input name="customTarget" type="number" min="1" max="2147483647" step="1" required />
        </label> : null}
      </fieldset>
      <label>为什么想实现 <span>（选填）</span><textarea name="why" rows={3} /></label>
      {validation || message ? <p className="form-message form-message-error" role="alert">{validation || message}</p> : null}
      <div className="commit-dialog-actions">
        <button className="secondary-button" type="button" disabled={pending} onClick={onCancel}>取消</button>
        <button className="primary-button" type="submit" disabled={pending}>{pending ? "正在保存…" : "创建愿望"}</button>
      </div>
    </form>
  </WishDialog>;
}
