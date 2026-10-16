# NEXUS GSAP 替代可行性：第一轮隔离 PoC

采样与验证：2026-10-16；收尾交付：2026-10-17。基线 `10a5e0b283b6ecae664cc64d44f7a9e88fb061f1`，实验分支 `codex/nexus-gsap-poc`。这是独立实验，不是正式迁移。原 P1.3 工作区、main、PR #2 均不在本次写入范围内。

## 结论

**GSAP 接管入场和地图编排在技术上可行；本轮不建议全面替换。保留 Legacy 默认值，等待架构审核。** 静止态、业务联动、中断、重启、清理和 reduced motion 的本地验证通过；1080p 没有测出性能优势；4K 两个引擎都出现明显的正常/低档振荡，稳定满档流畅度尚未通过。

如果后续采用 GSAP，建议先限制在复杂入场/共振编排。SVG/投影/标签、共享属性写入出口及业务调度继续保留。若目标是 4K 稳定 60fps，应另行定位绘制/合成成本与降档恢复策略，不能把换动画库当作已验证的性能解决方案。本轮没有为此修改布局、样式或正式主屏。

## 验收结果

| 检查 | 最终结果 |
| --- | --- |
| 构建 / TypeScript | 通过，生产构建 |
| 全部单测 | 48 个文件，606 项通过（基线 602 + 新增 4） |
| lint | 0 错误；仅 2 条原有未使用变量警告 |
| Legacy 原验收 | 63/63：NEXUS 7 + 动效 7 + P1.3 49 |
| GSAP 同一套验收 | 63/63：相同断言；SSR 无 JS 首屏也使用 GSAP 参数复测 |
| 新增 PoC 专项 | 8/8（基础 4 + 固定时钟正常档视觉 4）；静止态另行复测 2/2 |
| 1920×1080 / 3840×2160 静止态 | 隐藏实时时钟、等待字体/时钟占位完成后，实际几何相同，逐像素差异均为 0 |
| 中断与重启 | 入场重启、语音展示优先、隐藏/恢复、共振取消、reduced 动态切换均通过 |
| RAF 与清理 | 活跃时最大待执行 RAF=1；reduced 后=0；组件切换后没有额外 GSAP 场景/时间轴累计 |
| 长运行筛查 | 每引擎 4K 真实 5 分钟 + 12 次完整虚拟时钟共振循环；无页面脚本异常。真实 4K 会降档，不能称为满档稳定运行通过 |
| 4K 流畅度 | **未通过稳定满档目标**：两个引擎均反复降档/恢复 |

134 个不同浏览器用例全部通过，无跳过、无 flaky；额外复测的两个静态用例不重复计入 134。自动化通过不覆盖真实扬声器、麦克风、现场 LED 或全天候运行验收。

原 P1.3 干净工作区仍为 `10a5e0b`；main 仍为 `a43fb6c`。没有修改 PR #2，没有推送、合并、部署，没有启动 Task 11。

## 性能实测

本机 Apple M1 Ultra（20 核、64GiB），Darwin 24.6.0 arm64，Node 24.21.0，Chromium 153.0.8010.12 headless。同一生产构建、同业务夹具、DPR=1、16:9 布局、固定随机种子，业务夹具归一化 generatedAt 后的 SHA-256 四轮均为 `8f733819a5fcfcb49bf964e8e9dec9f43163de471a7f32e88d768ecd773cafd9`。四轮顺序执行；计时期间不并行运行测试，也不录屏。每引擎 1080p 120s、4K 300s，每 30s 记录堆和 DOM。动画保持原有自动降档保护。

| 分辨率 | 引擎 | 实测时长 | 平均 RAF FPS | 帧间隔 P95 | 丢帧估算 | 动画回调 P95 | 长任务 次数/总时长 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1920×1080 | legacy | 120.0s | 60.00 | 16.7ms | 0.00% | 0.2ms | 0 / 0ms |
| 1920×1080 | gsap | 120.0s | 60.00 | 16.7ms | 0.00% | 0.2ms | 0 / 0ms |
| 3840×2160 | legacy | 300.1s | 47.09 | 50.0ms | 21.52% | 0.2ms | 0 / 0ms |
| 3840×2160 | gsap | 300.1s | 46.82 | 50.0ms | 21.98% | 0.2ms | 1 / 62ms |

P95 表示 95% 的观测值不超过该值。丢帧以 60Hz 为基准按 RAF 间隔估算，不是 GPU 实际呈现帧统计；动画回调包括该引擎在 RAF 中执行的工作，不包含全部绘制/合成成本。单次有界样本没有统计显著性，0.28fps 的差异不能解释为确定的性能回退或收益。

**4K 平均值掩盖了周期性抖动。** 两个引擎各记录 20 次降档、19 次恢复；正常档低帧窗口约 21–22fps，低档恢复到约 60fps，然后再次升级、再次降档。说明现有自适应策略发生振荡；GSAP 没有消除这一现象。主线程长任务少不代表流畅。推测需进一步查看绘制/合成负担，但本轮未通过 GPU trace 定位根因，因此不作确定归因。

GSAP 4K 的一次长任务为 62ms；不能凭一次事件断言由 GSAP 引起。四轮都没有页面脚本异常或 HTTP 4xx/5xx。客户端切换/离开页面阶段记录到 RSC/导航 `net::ERR_ABORTED`，完整保存在 JSON，不计作主屏崩溃。

真实样本按计划发出共振触发请求；低档位会按原规则拒绝共振，故 4K 样本不能解释为连续满档共振压力测试。完整共振时序、上限 5 城波纹、平滑衰减及取消另由既有动效断言和 12 次完整虚拟循环验证。虚拟时间测试不冒充真实运行性能。

![真实时间帧率曲线](../../.review/gsap-poc/performance/fps-timeline.png)

主线程 CDP 指标（计时窗口内累计，不是 CPU 整机百分比）：

| 分辨率 / 引擎 | TaskDuration | ScriptDuration | LayoutDuration | RecalcStyleDuration |
| --- | --- | --- | --- | --- |
| 1920×1080 / legacy | 12.925s | 1.571s | 0.206s | 2.004s |
| 1920×1080 / gsap | 13.021s | 1.638s | 0.209s | 1.999s |
| 3840×2160 / legacy | 17.436s | 2.868s | 0.436s | 2.033s |
| 3840×2160 / gsap | 17.980s | 3.120s | 0.444s | 2.068s |

## 内存与重复进出

记录的是渲染器 JS 堆、DOM 和监听器，不是浏览器 RSS 或 GPU 显存；强制 GC 只在计时外执行。采样数组在测最终堆前清空，减少测试记录本身造成的保留。

| 分辨率 / 引擎 | 开始 GC 后 MiB | 结束 GC 后 MiB | 增量 MiB | 转空白页 GC 后 MiB | 空白页节点/监听器 |
| --- | --- | --- | --- | --- | --- |
| 1920×1080 / legacy | 6.094 | 6.773 | +0.680 | 0.911 | 8 / 0 |
| 1920×1080 / gsap | 6.453 | 7.172 | +0.719 | 0.911 | 8 / 0 |
| 3840×2160 / legacy | 6.035 | 6.515 | +0.480 | 0.913 | 8 / 0 |
| 3840×2160 / gsap | 6.422 | 6.938 | +0.517 | 0.915 | 8 / 0 |

每轮计时后做 10 次客户端引擎切换，共 40 次，实际触发 React 卸载/重新挂载。每次回到 GSAP 均为 1 个存活场景、27 条时间轴、globalTimeline 子动画 0；正常运行每分钟快照刷新也不累积场景。另有专项测试 10 次切换和单测 30 次场景创建/销毁验证。

**不能把内存结论写成“零增长”。** 10 次软导航的 GC 后 JS 堆仍增长约 0.51–0.73MiB；其根因尚未用堆快照定位，可能涉及路由缓存/运行时预热，不能武断归因或排除泄漏。转空白页后四轮均回收到约 0.91MiB、8 个 DOM 节点、0 监听器，说明整页离开可以回收。当前没有观察到 GSAP 场景/时间轴数量泄漏，但软导航堆增长仍是架构审核和更长运行时需要关注的风险。

![软导航后的 GC 堆](../../.review/gsap-poc/performance/navigation-heap.png)

## 本地证据

- [可视对照页：视频、静止态、1080p/4K 连续截图](../../.review/gsap-poc/review.html)
- [完整性能/内存/升降档/网络记录](../../.review/gsap-poc/performance/benchmark.json)、[验证索引](../../.review/gsap-poc/verification-manifest.json)
- [Legacy 1080p 视频](../../.review/gsap-poc/performance/video/legacy.webm)、[GSAP 1080p 视频](../../.review/gsap-poc/performance/video/gsap.webm)
- [固定时钟正常档连续截图审计（GSAP 4K）](../../.review/gsap-poc/functional/controlled-gsap-3840.json)、[固定视觉测试](../../.review/gsap-poc/controlled-visual-results.json)
- [静止态像素核对](../../.review/gsap-poc/functional/pixel-comparison.json)、[中断/清理记录](../../.review/gsap-poc/functional/lifecycle.json)、[12 次虚拟循环](../../.review/gsap-poc/functional/cycles.json)
- [Legacy 回归](../../.review/gsap-poc/legacy-regression-results.json)、[GSAP 回归](../../.review/gsap-poc/gsap-regression-results.json)、[PoC 专项](../../.review/gsap-poc/functional-results.json)、[静态复测](../../.review/gsap-poc/static-results.json)
- Legacy P1.3 全矩阵在 `.review/p1-3/after/`；GSAP 对应矩阵在 `.review/gsap-poc/gsap-p1-3/after/`，不互相覆盖。

连续截图/视频在独立视觉采集阶段生成，不混入计时性能样本。4K 视觉采集也保留实际自动降档行为；另有 1080p/4K × Legacy/GSAP 的 4 组固定虚拟时钟正常档连续截图，每组 8 个检查点，均明确断言正常档、PULSE 和全路线亮起；用于剔除录屏/截图开销触发降档的干扰。完整满档时序以这组证据和专项虚拟时钟测试为准，不把它当作真实流畅度证明。截图阶段的实时时钟自然变化不作为业务/布局差异。

所有截图、视频、原始 JSON 和失败历史保留在本 worktree 的忽略目录 `.review/`，不进入产品资源或 Git 提交。`history/` 保存初期加载占位、style 字符串采集差异，以及性能脚本隐藏链接定位超时的记录；最终统计与这些历史失败分开。

## 实现范围

[施工前架构审计](architecture-audit.md) 覆盖动效清单、触发/生命周期、状态依赖、可替换项、渲染保留项、CSS 属性冲突、业务和测试边界。

- 默认地址继续 Legacy；显式 `?motion=gsap` 使用独立 GSAP 客户端入口，`?debug=1` 提供 Legacy/GSAP 切换、重启入场、触发/取消共振、降档与语音模拟。切换保留其他 URL 参数并实际卸载组件。
- GSAP `3.15.0` 固定版本；只使用核心 timeline/ticker/plain-object tween，不使用 MotionPath、DrawSVG、ScrollTrigger 等插件，不增加业务服务依赖。
- 入场四段：背景 0ms、地图 300ms、两侧面板 900ms、底部动态 1500ms，各 600ms，终态和原 CSS 变量一致。
- 地图 GSAP 时间轴编排：近到远路线点亮、共振升降包络、城市波纹、3s 飞行/1s 到达及原点呼吸。代理值交给原有唯一 SVG 属性写入出口；保留路径采样/尾迹朝向、点击联动和既有调度。
- 保留 SVG 三层地图、地理投影、标签避让、椭圆遮罩、小地图、Canvas 粒子、表盘/标尺/逾期提示、数字动画及所有业务数据逻辑。没有用 GSAP 替代绘图技术，也没有把业务计算交给动画库。

## 技术架构及清理

Legacy：原生 RAF → MotionDirector → 触发规则/共享渲染。

GSAP：唯一 GSAP ticker → request/cancel 适配器 → 同一个 MotionDirector → 暂停且脱离 globalTimeline 的 GSAP 场景时间轴 → 共享渲染。

时间轴仅由 director 显式 seek，使用 director 的逻辑时间，不使用 GSAP 累积墙钟推进。DOM/CSS 同一属性只有一个逐帧写入者，不额外开启组件 RAF。暂停、隐藏、reduced motion 停止 ticker；恢复从当前稳定状态继续，不补追积压帧。每次 payload 更新先清理旧场景，再创建新时间轴；每个场景时间轴上限 `3 + 2 × 目的城市组数`。卸载 kill 所有时间轴并移除 ticker 监听、媒体/visibility/语音展示状态监听和观察器。代理时间轴不修改 inline style，故无需用 revert 恢复 CSS；DOM 终态由共享渲染及既有 reset 过渡维护。

新增诊断记录当前场景时间轴数、模块内全部存活场景/时间轴数和 globalTimeline 子动画数。原有调试帧率、降档和显著动效预算继续工作。重启入场由 director 使用当前时钟重新设定相对起点，语音/隐藏/reduced 时拒绝重启。

初期尝试客户端动态 import Provider，在暂停的虚拟时钟下会停留加载占位。最终改为服务端按参数选择独立客户端入口，保留 GSAP 模式的 SSR 内容。Legacy 页面不依赖异步 GSAP 初始化才能显示。施工前审计的懒加载占位方案因此未作为最终实现。

参考：[GSAP ticker](https://gsap.com/docs/v3/GSAP/gsap.ticker/)、[Timeline](https://gsap.com/docs/v3/GSAP/Timeline/)、[context/revert](https://gsap.com/docs/v3/GSAP/gsap.context%28%29/)。本 PoC 使用代理对象，因此采用显式 kill 清理所有自有 timeline。

## 可重复运行

在本隔离 worktree 执行，所有服务使用本地夹具，不读取生产环境配置：

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm lint
pnpm build
NEXUS_TEST_PORT=3047 pnpm exec playwright test -c e2e/gsap-poc.config.ts
GSAP_REGRESSION=1 NEXUS_TEST_PORT=3047 pnpm exec playwright test -c e2e/gsap-poc.config.ts
GSAP_REGRESSION=1 NEXUS_MOTION_ENGINE=gsap NEXUS_TEST_PORT=3047 pnpm exec playwright test -c e2e/gsap-poc.config.ts
NEXUS_TEST_PORT=3047 node scripts/gsap-poc-benchmark.mjs
python3 -m venv .review/gsap-poc/plot-venv
.review/gsap-poc/plot-venv/bin/python -m pip install -r docs/gsap-poc/plot-requirements.txt
.review/gsap-poc/plot-venv/bin/python scripts/gsap-poc-pixels.py
.review/gsap-poc/plot-venv/bin/python scripts/gsap-poc-plots.py
node scripts/gsap-poc-review.mjs
```

作图依赖仅安装在忽略目录的隔离 venv，不修改系统 Python 或产品依赖。版本已固定在 plot-requirements.txt（本机 Python 3.9）。

顺序执行，避免 3199 夹具端口及服务器竞争。benchmark 自行启动/退出隔离服务器，端口被占用即拒绝复用；默认每引擎 1080p 120s、4K 300s，另有导航清理与独立录屏。可用 `GSAP_BENCH_MS` / `GSAP_SOAK_MS` 调整采样窗口。长运行时按每 30s 记录堆/DOM，并在 30s、90s 等相同时间点发起共振请求（低档会拒绝）。录像和连续截图在计时样本之外采集，避免编码开销混进性能结果。

每轮业务夹具相同，只在每轮开始刷新 generatedAt，确保两个引擎都在相同的新鲜度状态；业务 SHA-256（将 generatedAt 归一化）可核验。随机种子 713、deviceScaleFactor=1、固定 16:9 布局、同一 Chromium 和生产构建。刷新每分钟照常运行。

## 风险与回退

1. GSAP 不能自动减少地图 SVG、遮罩、Canvas 和 DOM 属性写入成本；本轮重点验证编排与生命周期，不能预设换库就提升性能。
2. ticker 的 fps/sleep 是模块共享设置；当前页面只有本 PoC 使用 GSAP。以后加入其他 GSAP 消费者前，必须统一管理 ticker 所有权，不能直接照搬 sleep 策略。
3. 代理时间轴保留原渲染出口，适合本轮可比实验，但仍有双引擎维护成本。全面迁移前应明确最终边界，并删除失去用途的旧插值路径。
4. GSAP 对代理小数有有限精度；视觉时序做了契约测试，不能据此承诺所有未来自定义动效无差异。
5. 本地 Chromium/headless 的性能和有界运行记录，不代表展厅 LED、实际浏览器 GPU、全天候运行或真实麦克风/扬声器验收。掉帧为 RAF 间隔估算，不是 GPU 实际呈现帧统计。

即时回退：删除 `motion=gsap` 或在 debug 面板点击 Legacy；默认入口无需改动。完整撤回：丢弃本独立实验分支/工作树或撤销实验提交。没有迁移业务数据、没有服务端开关、没有生产部署需要回滚。

交付后停止，等待架构审核；不推送、不合并、不部署，不启动 Task 11。
