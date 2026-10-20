# 验证与失败历史

最终数值由 [summary.json](evidence/summary.json)、[GSAP 长稳](evidence/gsap-soak.json)、[Legacy 长稳](evidence/legacy-soak.json) 记录。原始逐秒数据、浏览器报告和失败 trace 保留在 `.review/p1-5-c/`；提交的文本副本仅规范换行与行末空白，不改失败内容；清单给出路径与 SHA-256，不能把未完成或历史测试写成本轮通过。

## 自动化边界

纯策略覆盖正常/严重低频、完成率/绝对频率/P95 三条件、严格临界值、尾部异常、断续窗口、暂停恢复、无效样本、时钟/目标变化、完整正常负载三窗口、失败退避、成功清零、Shadow 低负载不得冒充探测通过。Director 覆盖唯一写档者、手动权限、异常回退、低刷新参考退出实验、INTRO 让位上限及暂停保留失败数。有限校准按真实调用次数/有效经过时间计算参考，覆盖 60/100Hz 及 100Hz 显示器经 60Hz 上限后出现的 20/20/10ms 节奏，避免用中位间隔误判成 50Hz；测试还覆盖取消清理、3 秒无 RAF 超时。

浏览器专项覆盖 Baseline/Shadow/Candidate、无许可/非法/历史 URL、DOM 篡改无法改档、隐藏/显示、reduced motion、重新校准、16 次引擎切换、客户端同引擎回到 Baseline、真实 overlay 的唤醒/speaking/退出及 INTRO/PULSE 被小川接管。此处 speaking 是真实 WebSocket 协议驱动的界面状态，不代表 TTS 音频链路/人耳验收。

通用 Playwright 套件默认 reduced motion；GSAP PoC、P1.5-B/P1.5-C 专项使用各自的 no-preference 配置独立执行。通用套件排除这些已独立完整运行的专项，避免错误预设和重复执行；不删除或放宽任何原断言。Legacy/GSAP 同套 63 项及 PoC 8 项另列结果。

物理显示器刷新率没有在本轮切换；60/100/30Hz 是受控时钟/参考模拟。窗口 resize、orientation 事件或本地“重新校准刷新率”会触发有限重校准；浏览器没有可靠刷新率变更通知时须显式重新校准。目标设备切换显示模式后应现场确认。

## `pending RAF=0` 分类

- 页面隐藏、小川活动、reduced motion static、组件卸载：0 是合理状态，自己的 GSAP listener 应为 0。
- 恢复设置与首帧调度之间：一个瞬时 0 不能单独证明停止。记录恢复即时值，并在确定的后续窗口检查实际 listener 计数增长、1 个待执行 RAF、1 个场景与正常更新时间推进。
- 页面应活动、持续没有后续 listener 更新/Director 时间推进，或者 listener 已丢失/数量不受控：属于真正停止或所有权错误。

P1.5-B 首轮曾出现恢复 1 秒后 `pending=0,max=1`，随后的原断言复跑通过。该失败记录保留在已提交的 `docs/nexus-p1-5-b/06-regression.md`。本轮核查原工作区 `.review/gsap-poc/legacy-traces/` 仅有 `.last-run.json`，未找到报告引用的旧 trace zip；不能声称已保留或重新分析不存在的文件。

本轮保留 `e2e/gsap-poc.spec.ts` 的原 `{pending:1,max:1}` 断言与 1000ms 测量长度，增加恢复环境确认及实际 ticker 调用增长断言。完整 8 项复跑，最终结果见结构化汇总。另增加 30 次 reduced motion 暂停/恢复专项：每次静态必须 0 RAF/0 自有 listener；恢复 1 秒后必须仍为 `{pending:1,max:1}`，并确认实际 ticker 调用持续增加。最终集成 30 次中 8 次即时快照仍为 0 RAF，确认恢复并推进 1 秒后 30 次均为 1 RAF/max=1，自有 listener 调用增加 46–60 次（DOM 快照滞后通过 listener 时间戳区分）。即时快照与稳定后快照分开保存于 `.review/p1-5-c/reduced-resume-30.json`。不会用延长原断言等待、删除断言或只检查低档速度来掩盖错误。

源码能确认旧组件路径在 `director.running=false` 时无条件全局 sleep，而 `running` 在正常帧回调内也会暂时为 false。这是明确的所有权风险；当前入口通过 active listener 检查消除了该风险。旧 trace 缺失且原失败非稳定重现，因此不将它宣称为历史单次失败的唯一已证实根因。

## 本轮失败与修正（原始输出不覆盖）

1. 初始构建失败：新工作区软链接依赖超出 Turbopack filesystem root。改用工作区独立 `pnpm install --offline --frozen-lockfile`；未改锁文件或原工作区依赖。
2. 初始 633 项单测有 1 项失败：测试将 Legacy 目标设为 100Hz，却仍以 60Hz 输入并预期恢复。改为显式测试 60Hz 引擎上限；没有调低生产阈值。
3. 首轮集成 9/10：用 DOM 改写 Next Link 的 href 测试同引擎回退，React 仍使用原路由属性。增加正式“回到 Baseline”链接并使用真实客户端导航，随后完整专项通过。原失败 trace 保存。
4. 初始类型检查发现 Playwright 未导出 `WebServerConfig`，改用配置自身推断，后续通过。

5. 新增 30 次恢复专项首次失败：实际计数未增长，但 trace 证明 `emulateMedia` 返回时仍 paused，测试先推进了虚拟秒、再等到真正恢复。将一秒的测量起点置于环境恢复确认之后，原 RAF 和新增进度断言不变，随后 30 次全部通过；失败 zip、日志和解码快照保留。
6. 有头视觉采集暴露 debug 状态含义混用：帧回调内 `id=null` 被误报暂停。增加只表示环境的 `paused`，实际待执行请求继续用 `running`/RAF 计数单独检查，不改变动画时钟或质量行为。
7. 视觉采集器默认 RAF 轮询与测试注入的全局 60Hz 节流竞争。等待改为 100ms 定时轮询，生产代码没有新增 RAF 管理器。原 42ms/50ms 合成负载在约 40Hz 临界点未连续满足四秒条件，保持 normal 符合规则；改用 85ms/100ms 明确严重负载验证失败探测，不改变候选阈值。失败原始报告保留。

通用回归最终为 196/196、0 跳过/0 失败；合同尾号 masked/empty 两项在本轮及从 `2584284` 重新构建的独立基线复核中均通过。施工时一度将截图目录误判为失败，已按最终 JSON 报告纠正，不继续将旧记录当作当前故障。

8. 高频短语音接管复现了探测饥饿：原实现每次低档暂停/恢复都重置等待，虽有足够安静时间仍长期 low。[失败用例保留](evidence/history/probe-deadline-failures.json)；修复为低档中断保留原截止时刻、probe 中断也保留既定机会并清零通过窗口，旧样本仍全部清除，频率与退避阈值不变。修复前 30 分钟记录独立归档，不能冒充最终修复后的结果。

所有后续浏览器、视觉、长稳失败或受限证据补充在最终 [summary.json](evidence/summary.json) 和交付说明，不删除初始文件。测试工具和录屏产生的调度开销不会被解释成产品性能改善。

## 正式长稳

GSAP 目标 30 分钟，Legacy 目标 10 分钟，均为墙钟计时，不是虚拟时间。先保持完整 4K 负载，后段将视口改为 1920×1080降低渲染负担；地图、航线、粒子、数字、仪表和发货组件全部保留。隐藏/小川状态模拟/reduced motion 在运行中反复暂停恢复。长稳采用既有 debug 事件模拟小川活动；真实 overlay 的 WebSocket 状态链路另由专项覆盖，未把它称为声音/麦克风硬件的连续长稳验收。正式计时从资源/字体准备及固定 3 秒预热后开始；初始降档可能发生于预热，已观测转换总数包含这段记录，不能写成全都发生在正式计时内。恢复延迟按逐秒外部观测近似，误差约一个采样窗口。每秒记录状态与实际 listener 计数，每分钟记录 CDP 堆、DOM、事件监听器、active timeout/interval、RAF、GSAP listener/scene/timeline/root 实例；结束采集 GC 后控制。性能阶段没有视频或截图。

成功判据包括：实验没有意外退出、过载下有失败探测、退避上限 60 秒、负载改善后实际自动恢复且末态 normal、无页面脚本异常、GSAP 正常时只有 1 个自有 listener/1 个 scene/固定 timeline 数、静态时 listener 为 0。资源趋势须结合 active 数量、GC 和峰谷分析，不能仅以单个堆峰值定性泄漏，也不把累计调用增长叫作 active listener 增长。

9. 最终 PoC 复跑再次捕获原 `pending RAF=0,max=1` 失败。本次 trace 完整保留并[解码](evidence/history/poc-reduced-race-final/decoded-timing.json)：`clockRunFor(1000)` 和读取 loopAudit 均在媒体 change 真正应用之前，随后快照为 paused=false、activeListeners=1，但虚拟时钟尚未继续，listenerUpdates 不变。原测试增加环境恢复前置确认，随后仍只推进 1000ms，保留原 RAF 断言，并要求实际 listener 增长超过 30 次；不是延长窗口或降低判据。新捕获证据只解释这次复现，旧 P1.5-B trace 缺失仍不推定同因。


## 本轮最终长稳实测

固定 fixture、seed=713、DPR=1、Chromium 153.0.8010.12。本节为无头 SwiftShader：GPU compositing/rasterization 均为 disabled_software；不是 Metal 硬件呈现测试。正式性能计时无录屏/截图；独立有头 Metal 视觉证据见视觉章节，[物理显示环境](evidence/display-environment.json)为 1920×1080@100Hz，4K 是浏览器虚拟视口。

| 指标 | GSAP Candidate | Legacy Candidate |
| --- | --- | --- |
| 实际墙钟 | 1800.081 秒 | 600.064 秒 |
| 逐秒观测 / 最大间隔 | 1742 / 2.240 秒 | 583 / 2.707 秒 |
| 降档 / 探测开始 / 失败 / 恢复 | 1 / 27 / 26 / 1 | 1 / 10 / 9 / 1 |
| 后段负载改善 | 第 25 分钟，4K→1920 | 第 8 分钟，4K→1920 |
| 负载改善到恢复 | 约 50.576 秒 | 约 26.384 秒 |
| 末态 / 失败计数 | normal / 0 | normal / 0 |
| 暂停检查 | 10 次，全部 listener/RAF=0 | 3 次，全部 RAF=0 |
| 自然 GC 堆范围 | 6.85–16.43 MiB | 6.31–13.32 MiB |
| 结束强制 GC 后堆 | 6.90 MiB | 6.28 MiB |
| DOM 节点范围 / GC 后 | 1201–1562 / 1202 | 1218–1559 / 1201 |
| 事件监听器范围 / GC 后 | 370–666 / 398 | 381–677 / 370 |
| 活动时 timeout / interval / RAF | 0 / 3 / 1 | 0 / 3 / 1 |
| GSAP 自有 listener / scene / timeline / root | 1 / 1 / 27 / 0 | 不使用 GSAP host |
| 页面脚本异常 | 0 | 0 |

转换总数包含 3 秒预热中可能发生的首次降档；恢复延迟来自逐秒外部观测，约有一个采样窗口误差。GSAP 的每分钟 used heap 线性斜率约 +0.114MiB/分钟、Legacy 约 -0.145MiB/分钟，前者为正且采样含自然 GC 峰谷/负载变化；结束 GC 回到 6.90MiB 及固定实例数量支持本轮资源回收，不能据此宣称全天无泄漏。没有采集 VRAM、浏览器进程 RSS 或堆 retaining path，现场长稳仍待验证。

网络原始记录也保留：GSAP 21 次、Legacy 8 次本地 Next/RSC 请求 `net::ERR_ABORTED`，没有 HTTP ≥400 记录。采集器未保存取消的完整时刻/方法，因此不将全部取消推定为某个已证实原因，也不称本轮网络零错误；页面脚本异常为 0、末态恢复和断言通过是另一个结论。

[GSAP 时序/资源图](figures/gsap-soak.svg) · [Legacy 时序/资源图](figures/legacy-soak.svg)。图中更新率来自 Director 有效样本，不等同于实际显示 FPS。

## GSAP ticker 直接计数

最终资源快照累计 `listenerUpdates=106005`，结束 GC 后累计 106017；计数从本页 host 第一次 listener 调用开始，包含预热和同步 wake，不将它冒充精确的正式 1800 秒内总数。完整首末时刻及所有外部快照在原始报告中。

仅对活动、同显示档位、连续且未跨已记录状态转换的外部快照，使用实际 listener 次数差 / listener 末时刻差计算频率：

| 观测显示档位 | 实测 Hz 最小–最大 | 均值 |
| --- | --- | --- |
| normal 负载，含 probe 及初期超载区间 | 20.76–60.06 | 59.68 |
| low 负载 | 30.48–60.19 | 59.92 |

这些区间是有限观测快照，不是所有窗口都达到 60Hz 的保证；不能隐藏最小值或只报告均值。短区间会有边界/同步 wake 计数偏差，略高于 60 的采样比值不表示解除了上限；唯一管理入口仍固定 `fps(60)`。对窗口过短或跨暂停的区间不估算 ticker Hz，原始累计值照常保留。暂停、卸载和快速引擎切换的 active listener 归零由专项另验；low→probe 的正常负载频率由真实计数及决策样本并列保留，没有 Director 1:1 推算。
