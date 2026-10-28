/** Offline browser test entry; never imported by the production app.
 * Reuses the real Sidebar/Today UI without credentials or database access.
 */
import { createRoot } from "react-dom/client";
import type { TodayItem, TodayResponse } from "@reward-planner/types";
import { DesktopSidebar } from "../../src/DesktopSidebar";
import { TodayPage } from "../../src/today/TodayPage";
import { localDate } from "../../src/today/date";
import "../../src/styles.css";

const params = new URLSearchParams(location.search);
const committed = params.get("mode") === "committed";
const key = `rp-ui-02-${params.get("mode")}-${params.get("run") || "review"}`;
const date = localDate();
const titles = ["完成 Reward Planner Today 页面", "IELTS Writing Task 2", "整理音系学 presentation 资料", "健身 40 分钟", "阅读 30 分钟"];
const initial = titles.map((title, index): TodayItem => ({ id: `item-${index}`, taskId: `task-${index}`, title,
  origin: "initial", priority: index < 2 ? "must_do" : "plan", resultStatus: committed && index < 4 ? "completed" : "pending",
  plannedStartTime: index === 1 ? "16:00:00" : null, plannedEndTime: index === 1 ? "17:00:00" : null,
  completedAtOnDay: committed && index < 4 ? `${date}T01:00:00Z` : null, rescheduledToDate: null }));
const model: TodayResponse = JSON.parse(sessionStorage.getItem(key) || "null") || {
  date, timezone: "Asia/Shanghai", execution: { currentDate: date, available: committed },
  dailyPlan: { id: "fixture-plan", status: committed ? "committed" : "draft", snapshotCreatedAt: committed ? `${date}T00:00:00Z` : null },
  items: { mustDo: initial.slice(0, 2), plan: initial.slice(2), addedLater: [] },
  schedule: { timedTasks: [{ planningItemId: "planning-ielts", dailyPlanItemId: "item-1", taskId: "task-1", title: titles[1],
    startTime: "16:00:00", endTime: "17:00:00", countsTowardDaily: true }], calendarEvents: [] },
  dailyStatus: { available: false, reason: "draft" }, activeProjects: { available: false, items: [] },
};
const created = new Map<string, string>();
function updateFixtureServerStatus() {
  if (model.dailyPlan?.status !== "committed") return;
  const items = [...model.items.mustDo, ...model.items.plan, ...model.items.addedLater];
  const completedItems = items.filter((item) => item.resultStatus === "completed").length;
  const must = items.filter((item) => item.priority === "must_do");
  // This is the fixture's API double, not production qualification logic.
  const isQualified = items.length > 0 && completedItems * 100 >= items.length * 80 && must.every((item) => item.resultStatus === "completed");
  model.dailyStatus = { available: true, totalItems: items.length, completedItems, mustDoItems: must.length,
    completedMustDoItems: must.filter((item) => item.resultStatus === "completed").length,
    completionRate: items.length ? Math.trunc(completedItems * 10000 / items.length) / 100 : 0, isQualified,
    qualifiedAt: isQualified ? `${date}T01:00:00Z` : null, calculatedAt: `${date}T01:00:00Z` };
}
updateFixtureServerStatus();
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin);
  if (!url.pathname.startsWith("/api/")) throw new Error("Offline fixture forbids external requests.");
  if (url.pathname === "/api/today") {
    const requested = url.searchParams.get("date")!;
    return Response.json({ ...model, date: requested, execution: { currentDate: date,
      available: model.dailyPlan?.status === "committed" && requested === date } });
  }
  const body = JSON.parse(String(options?.body || "{}"));
  if (url.pathname.endsWith("/create")) {
    const id = `fixture-${crypto.randomUUID()}`; created.set(id, body.title);
    return Response.json({ data: { task: { id } }, effects: ["task_created"] });
  }
  if (url.pathname.endsWith("/commit")) {
    model.dailyPlan = { id: "fixture-plan", status: "committed", snapshotCreatedAt: `${date}T00:00:00Z` };
  } else if (url.pathname.endsWith("/complete") || url.pathname.endsWith("/uncomplete")) {
    const item = [...model.items.mustDo, ...model.items.plan, ...model.items.addedLater].find((item) => item.taskId === body.taskId)!;
    item.resultStatus = url.pathname.endsWith("/complete") ? "completed" : "pending";
    item.completedAtOnDay = item.resultStatus === "completed" ? `${date}T01:00:00Z` : null;
  } else {
    const old = [...model.items.mustDo, ...model.items.plan].find((item) => item.taskId === body.taskId);
    model.items.mustDo = model.items.mustDo.filter((item) => item.taskId !== body.taskId);
    model.items.plan = model.items.plan.filter((item) => item.taskId !== body.taskId);
    if (!url.pathname.endsWith("/remove-item")) {
      const item: TodayItem = old ? { ...old, priority: body.priority } : { ...initial[4], id: body.taskId,
        taskId: body.taskId, title: created.get(body.taskId)!, priority: body.priority, resultStatus: "pending", completedAtOnDay: null,
        origin: model.dailyPlan?.status === "committed" ? "added_later" : "initial" };
      model.items[model.dailyPlan?.status === "committed" ? "addedLater" : body.priority === "must_do" ? "mustDo" : "plan"].push(item);
    }
  }
  updateFixtureServerStatus(); sessionStorage.setItem(key, JSON.stringify(model));
  return Response.json({ data: {}, effects: [] });
};
createRoot(document.getElementById("root")!).render(<div className="app-shell">
  <DesktopSidebar email="visual-fixture@example.test" isSigningOut={false} signOutError={null} onSignOut={() => { location.href = "/"; }} />
  <TodayPage accessToken="offline-visual-fixture-only" />
</div>);
