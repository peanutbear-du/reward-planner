# RP-UI-02 — Today Desktop Figma Fidelity & Interaction

状态：IN PROGRESS，等待 Review；未 commit/push，未标记 DONE。

参考：[Figma Today Desktop，node 13:2](https://www.figma.com/design/5X75okFQHqHNHf0wentYKk/Reward-Planner-Design?node-id=13-2)。实施基于 `d8fd4f3`，开始时工作区 clean。参考图通过 Figma MCP 直接读取并保存，未作为产品图片使用。

## 对比与修正

修改前的主要差异：独立计划工具栏把任务下推；Draft 永久显示下拉框和移除按钮；空 Added Later 分组及新增表单占据额外空间；Header 日期输入过宽；Sidebar 的待开放标签、账号信息和退出按钮增加视觉噪声；任务间距、日程标题、副信息和右栏细节尚未对齐。

现已按节点尺寸与样式修正 Sidebar、Header、任务、Schedule、Daily Status 和 Project Focus。复用已有颜色 tokens、SVG、TaskItem、DailyStatus 和请求逻辑，未增加依赖或重新搭建应用。Sidebar 从 App 中提取为同一份组件，供真实应用和离线浏览器验证共同使用；Auth/session restore/sign out 逻辑不变。

| 几何项 | Figma / 最终浏览器 |
|---|---|
| 画板 / 视口 | 1440 × 1024，100% 缩放；浏览器 DPR=1、visualViewport.scale=1 |
| Sidebar | 宽 220，高 1024，padding 28 / 20 / 24 |
| Header | x=264、y=36、1132 × 80 |
| 任务列 / 右栏 / 列间距 | 748 / 360 / 24 |
| Daily Plan | x=264、y=132、748 × 520 |
| 任务行 | 内部宽 732、高 64；y=180、256、384、460、536 |
| Schedule | x=264、y=672；标题与说明同行 |
| Committed Daily Status | x=1036、y=132、360 × 290 |
| 达标说明 / 奖励占位槽 | 高 61 / 39 |
| Committed Project Focus 起点 | x=1036、y=438 |
| 主题标识色块 | x=30、y=972、12 × 12 |

已完成截图后的第二轮修正：每日状态说明行改为明确的块级行高、奖励不可用槽调整为 39px、主题色块从居中对齐改为顶端对齐、确认后的图标保持 Figma 蓝色标识。原有分隔 SVG 保持 732×1，Schedule accent 保持 3×64，两者都已核对完整加载及实际几何尺寸。

数字使用本地提供的 Inter SemiBold（官方 Google Fonts 原始字体，326048 bytes）；OFL 文本随 `public/font-licenses/Inter-OFL.txt` 一起输出到构建产物。中文使用 Noto Sans SC；本次 Windows 浏览器已安装该字体。其他未安装该系统字体的环境仍可能出现中文字体回退。

## 交互

- Must-do 标题右侧恢复添加／编辑／确认操作组，所有图标有中文无障碍名称和原生 title 提示。
- Commit 的用户可见文案改为「确认今日计划」，PRD 同步说明。图标先打开简洁确认对话框；只有「确认并保存」才发送原 Commit API。取消或 Escape 不提交；取消默认获得焦点，关闭后焦点返回触发图标。提交中禁止重复确认和 Escape 关闭；失败在对话框内反馈，可重试原命令。
- Task 行默认只有 checkbox、标题和真实时间／执行状态副信息；Draft 的优先级与移除功能通过编辑开关显示。Committed 禁止编辑 Initial Items。
- 新增任务为紧凑单行：名称、分组、保存、取消。支持 Enter 提交、Escape 收起、保留未提交输入。沿用原 Create → Draft / Added Later、失败后复用已创建 Task 的重试逻辑；存在未完成的加入操作时仍锁定日期、取消和其他相关操作。
- 日期输入收进日期说明展开区，保留前一天／今天／后一天及紧凑刷新入口。日视图为当前视图，周／月明确禁用。
- 账号菜单收在底部主题标识内，退出登录、提交中和错误提示保持可用；不新增主题切换功能。
- 继续展示 API 提供的 Daily Status，不从任务行计算资格，不改后端、数据库、Qualification 或任何命令契约。历史日期使用「当日」文案，今日使用「今日」。

## 截图与浏览器验证

全部截图为真实 Chrome 页面截图或原始 Figma 导出，未裁剪、拼接或后期修改。最终 Draft / Committed 均记录为 1440×1024、DPR=1、scale=1。实测信息见 [browser-metrics.json](browser-metrics.json)。

- [Figma 原始参考图](figma-reference.png)
- [修改前 Draft](browser-before-draft.jpg)
- [首轮 Draft](browser-pass1-draft.jpg) / [首轮 Committed](browser-pass1-committed.jpg)
- [最终 Draft](browser-final-draft.jpg) / [最终 Committed](browser-final-committed.jpg)
- [内联新增](browser-inline-create.jpg) / [二次确认](browser-confirmation.jpg)

验证使用 `apps/desktop/tests/visual/today.html`，该独立开发入口直接渲染真实 Sidebar 和 TodayPage，以离线 HTTP test double 提供合成示例。没有登录凭据，没有数据库连接，未改动真实用户任务。fixture 不由生产入口引用，也不进入生产 build。

示例沿用 Figma 的五个任务标题及顺序。Draft 全部待完成；Committed 为 4/5 完成（两个 Must-do 均完成）及 API double 返回的 80% 达标状态，保证数据内部一致。日期是浏览器本地日期：基线截图于 10 月 27 日保存，最终截图于 10 月 28 日保存；Figma 自身显示 9 月 21 日，不冻结或修改产品时间。

已在真实浏览器操作：Draft 编辑开关、优先级往返切换、内联输入及 Enter/Escape、创建后移除合成任务、确认取消及焦点恢复、确认提交、Complete/Uncomplete 后等待状态刷新、页面重载后的状态保持、账号菜单展开／折叠。以上是离线前端交互验收，不替代或重复远端数据库 Smoke。

复现（使用项目现有 Vite 命令启动 Desktop 后）：

```text
http://127.0.0.1:5173/tests/visual/today.html?mode=draft&run=review
http://127.0.0.1:5173/tests/visual/today.html?mode=committed&run=review
```

切换新的 `run` 参数可获得全新合成状态；原状态仅保存在当前浏览器 sessionStorage 中。浏览器验收使用固定视口 capability，结束后恢复默认视口。

## 质量检查

- 前端专项：5 files / **34 tests PASS**，包含新增二次确认、取消／Escape、提交中防重复、失败重试、Draft 编辑开关、内联键盘交互、Sidebar sign out 及真实 Daily Status 展示回归。
- Desktop typecheck PASS；Frontend ESLint PASS；Desktop build PASS。
- build 仍有两条既有 Zod PURE 注释警告；本票未引入新的警告。
- `git diff --check` PASS。未运行后端测试、完整 RLS、数据库 Smoke 或数据库操作。

实际命令（复用仓库现有工具，未安装依赖）：

```powershell
# 使用工作区内被忽略的 TEMP，避免宿主临时目录的 Vitest ENOENT 问题。
node node_modules/vitest/vitest.mjs run --config apps/desktop/vitest.config.ts --maxWorkers 1
node node_modules/typescript/bin/tsc -p apps/desktop/tsconfig.json --noEmit
node node_modules/eslint/bin/eslint.js apps/desktop/src apps/desktop/tests/visual/today-fixture.tsx
node node_modules/vite/bin/vite.js build apps/desktop
git diff --check
```

## 保留的差异 / 边界

- Project 未实现：保留 Figma 的列宽、起点、容器和标题样式，展示明确占位；不填入 Portfolio、Activity Pulse、进度或假项目，也不强行撑出 556px 空白卡片。
- Calendar Event 未实现：不伪造两条事件。日程目前只显示真实 API 形状支持的定时任务，因此示例中的 IELTS 行高相同但位于第一行。
- Reward 未实现：原奖励行的位置显示「每日奖励尚未接入」，没有 +1、Wish 名称或进度变化。
- API 暂无 Project 标签信息，任务副信息使用真实时间及执行状态。Figma 的静态 checkbox 与 4/5、80% 文案本身不一致；本实现保持 Task / Daily Status 数据一致，未复制虚假的完成视觉。
- 遵守中文 locale：使用「日／周／月」「主题 · 蓝色」「必须完成」，没有照搬 Figma 的混合语言标签。计划状态、刷新与不可用说明是现有功能所需的少量额外信息。
- 已完成真实截图比对和几何复核；未宣称全图像素完全相同，未做自动像素相似率评分。

## 变更范围

仅 `BACKLOG.md` 新增本票登记、`PRD.md` Commit 文案、`apps/desktop` 的页面／样式／组件／前端测试／字体资源，以及本 Review 目录。`apps/api`、`supabase`、shared packages、package.json、pnpm-lock.yaml、根 README 和 .env.example 均未修改。其他票据状态未改变。
