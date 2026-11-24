import { useState } from "react";
import { QueryClient, QueryClientProvider, useInfiniteQuery } from "@tanstack/react-query";
import { getProjects } from "@reward-planner/api-client";
import type { ProjectOverview, ProjectStatus } from "@reward-planner/types";
import "./project-overview.css";

const statuses = [
  { value: "active", label: "进行中" },
  { value: "paused", label: "已暂停" },
  { value: "completed", label: "已完成" },
] as const;

const scales = { small: "小型", medium: "中型", large: "大型", major: "重大" } as const;

export function ProjectOverviewPage({ accessToken }: { accessToken: string }) {
  // App remounts this provider when the authenticated user changes.
  const [client] = useState(() => new QueryClient({ defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  } }));
  return <QueryClientProvider client={client}>
    <ProjectOverviewContent accessToken={accessToken} />
  </QueryClientProvider>;
}

function ProjectOverviewContent({ accessToken }: { accessToken: string }) {
  const [status, setStatus] = useState<ProjectStatus>("active");
  const query = useInfiniteQuery({
    queryKey: ["projects", status],
    queryFn: ({ pageParam, signal }) => getProjects({
      apiBaseUrl: import.meta.env.VITE_API_BASE_URL || window.location.origin,
      accessToken,
      status,
      cursor: pageParam,
      signal,
    }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: page => page.nextCursor ?? undefined,
  });

  const projects = query.data?.pages.flatMap(page => page.projects) ?? [];

  return <main className="main-content project-overview">
    <header className="page-header projects-header">
      <div>
        <h1>项目</h1>
        <p>把重要事情拆成下一步行动</p>
      </div>
    </header>
    <section className="project-list" aria-label="项目列表" aria-busy={query.isFetching}>
      <div className="project-filters" role="group" aria-label="按项目状态筛选">
        {statuses.map(option => <button key={option.value} type="button"
          aria-pressed={status === option.value} onClick={() => setStatus(option.value)}>
          {option.label}
        </button>)}
      </div>
      {query.isPending && <p className="project-list-message" role="status">正在加载项目…</p>}
      {!query.isPending && !query.isError && projects.length === 0 &&
        <p className="project-list-message">暂无{statuses.find(option => option.value === status)?.label}的项目。</p>}
      {projects.length > 0 && <ul className="project-grid">
        {projects.map(project => <ProjectCard key={project.id} project={project} />)}
      </ul>}
      {query.isError && <div className="project-list-message" role="alert">
        <p>{query.isFetchNextPageError ? "暂时无法加载更多项目。" : "暂时无法读取项目。"}</p>
        <button className="secondary-button" type="button" disabled={query.isFetching}
          onClick={() => void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())}>重试</button>
      </div>}
      {query.hasNextPage && !query.isError && <button className="secondary-button project-more" type="button"
        disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
        {query.isFetchingNextPage ? "正在加载…" : "加载更多"}
      </button>}
    </section>
  </main>;
}

function ProjectCard({ project }: { project: ProjectOverview }) {
  return <li className="project-card">
    <h2>{project.title}</h2>
    <div className="project-card-meta">
      <span className="project-scale">{scales[project.scale]} · +{project.rewardPool}</span>
      <span>截止 · {project.deadline ? <ProjectDate value={project.deadline} /> : "未设置"}</span>
    </div>
    <dl className="project-card-next">
      <div>
        <dt>下一里程碑</dt>
        <dd>{project.nextMilestone?.title ?? "暂无待完成里程碑"}
          {project.nextMilestone?.dueDate && <small> · <ProjectDate value={project.nextMilestone.dueDate} /></small>}
        </dd>
      </div>
      <div>
        <dt>下一行动</dt>
        <dd>{project.nextAction?.title ?? "未设置"}</dd>
      </div>
    </dl>
    <p className="project-activity">活动记录待接入</p>
  </li>;
}

function ProjectDate({ value }: { value: string }) {
  const [year, month, day] = value.split("-");
  return <time dateTime={value}>{year}年{Number(month)}月{Number(day)}日</time>;
}
