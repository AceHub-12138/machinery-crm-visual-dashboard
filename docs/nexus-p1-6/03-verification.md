# P1.6 测试与审核报告

日期：2026-10-21。状态：本地 PoC 交付，等待架构审核和用户视觉确认；不是生产或展厅验收。

## 验证结果

| 检查 | 结果 | 证据 |
|---|---|---|
| 生产构建 | 通过 | [build.txt](evidence/build.txt) |
| TypeScript | 通过 | [typecheck.txt](evidence/typecheck.txt) |
| 单元测试 | 56 文件、709 项通过；包含时间轴及振幅源路由 | [unit.txt](evidence/unit.txt) |
| lint | 0 错误、2 条既有未使用变量警告，均在未修改文件 | [lint.txt](evidence/lint.txt) |
| P1.6 浏览器用例 | 16 个不同用例最终结果均通过；无跳过 | [汇总](evidence/validation-summary.json) |
| Metal 对照 | 8 项通过，四尺寸 × 两引擎 | [原始报告](evidence/browser-headed-results.json) |
| 原有 Legacy 回归 | 11 项通过：8 种正常卡片、真实 PCM/句段、覆盖旧回答、音频失败 | [原始报告](evidence/legacy-regression-results.json) |
| GSAP 卡片边界 | 1792×832，8 种卡片 × 普通/长文本共 16 组；正文分页拼接无丢失 | [布局记录](evidence/gsap-p13-layout.json) |
| diff/禁止范围 | 主屏 MotionDirector/质量策略/地图、业务契约及 PCM 播放器均无源码差异 | [代码差异](code-diff.patch) |

原始最终完整轮次是 14/15，其中新增的退场正文断言放在截图编码之后，耗时超过 200ms 视觉快照期限，断言时元素已正常回收。将断言移到截图前，电影演示及两条生命周期用例定点复验 3/3 通过；随后新增模板矩阵 1/1 通过。保留[完整原始轮次](evidence/browser-final-results.json)、[定点复验](evidence/browser-recheck-results.json)及[模板复验](evidence/browser-p13-results.json)，不将历史失败改写成成功。

覆盖包括：1280×720、1792×832、1920×1080、3840×2160；reduced motion；正常中文 PCM 播放、音频 503、播放中打断、连续追问、4 次唤醒退出、早期展开期间 6 次打断、页面隐藏/恢复、组件卸载/重新挂载、Next Link 导航与返回。主屏 GSAP 与小川 GSAP 同时工作也单独验证，ticker cap 保持 60Hz。

## 性能对照

下表每格均为 Legacy / GSAP，单位 ms。页面 RAF 间隔是观察器采样，Canvas 是包含绘制调用的 rAF 回调耗时，不是 GPU 时间或真实显示呈现 FPS。采样约 8 秒、DPR=1、原 high 粒子路径，使用同一脱敏数据和真实 PCM；采集工具本身带来少量开销，两版一致。单次短样本不构成统计显著性或长稳结论。

| 后端 | 宽度 | RAF 间隔均值 | RAF 间隔 P95 | Canvas 回调均值 |
|---|---:|---:|---:|---:|
| SwiftShader | 1280 | 16.67 / 16.89 | 16.70 / 16.70 | 2.15 / 2.20 |
| SwiftShader | 1792 | 16.74 / 16.74 | 16.70 / 16.70 | 2.13 / 2.08 |
| SwiftShader | 1920 | 16.70 / 16.81 | 16.70 / 16.80 | 2.10 / 2.17 |
| SwiftShader | 3840 | 41.08 / 42.31 | 50.10 / 50.10 | 1.61 / 1.70 |
| Metal | 1280 | 11.83 / 10.08 | 11.00 / 10.90 | 1.34 / 1.40 |
| Metal | 1792 | 10.26 / 10.11 | 11.00 / 11.00 | 1.41 / 1.43 |
| Metal | 1920 | 10.26 / 10.11 | 10.90 / 11.00 | 1.40 / 1.43 |
| Metal | 3840 | 10.10 / 10.09 | 10.90 / 10.90 | 1.45 / 1.43 |

Metal 4K：Legacy / GSAP 的 ScriptDuration 为 1.13 / 1.14s，TaskDuration 为 2.44 / 2.46s；布局与样式累计均约 0.01s。未观察到稳定的明显 JS、Canvas 或布局回退，也没有证明 GSAP 可普遍提高帧率。

SwiftShader 4K 两版都只有约 23 次 RAF/s，GSAP P95 部分样本更差，不能判为软件后端 4K 性能合格。Metal 虚拟 4K 视口约 99 次 RAF/s，Canvas 约 1.4ms；物理屏幕实际是 1920×1080@100Hz，不能据此认定真实 4K LED、GPU 显存或全天运行合格。

后端不是只看 WebGL 字符串：[软件 GPU 诊断](evidence/headless-gpu.json)中 gpu_compositing/rasterization 为 disabled_software；[硬件诊断](evidence/headed-gpu.json)为 enabled，ANGLE Metal Apple M1 Ultra。[显示器](evidence/display.txt)及[运行环境](evidence/environment.json)分别记录。原始每尺寸样本和 CDP Script/Task/Layout/Recalc 指标见 evidence/*performance.json；[汇总](evidence/comparison-summary.json)保留完整数字。

## 时间轴与真实音频

首轮观测相对 ANSWER 的时刻（ms）；DOM 的观察器存在约 1–2 帧读数延迟，不能当作亚帧级测量。

| 引擎 | 水平线首现 | 卡体首现 | 卡体接近展开完成 | SVG 完成 | 首块 PCM 排队 | 首个音频实际时间线起点 |
|---|---:|---:|---:|---:|---:|---:|
| legacy | 425.7 | 525.7 | 659.1 | 675.8 | 48.6 | 198.6 |
| gsap | 423.8 | 523.9 | 657.2 | 673.9 | 47.6 | 197.6 |

GSAP 三轮 Canvas/DOM 同一轮次进度的等效偏差 P95 约 17ms，最大约 19.1ms；它来自 Canvas 独立 rAF 与 60Hz ticker 的读取顺序。新轮次开始时，上一张 Canvas 画面最多保留到下一帧，统计已明确剔除时间戳早于新 ANSWER 的旧帧，不把它误算为 350ms 光流错位。

首轮高亮 DOM 相对真实 PCM 时间线的观测误差：Legacy 首/次句约 27.1/20.7ms，GSAP 约 9.6/19.8ms；各轮结果见汇总。样本太少且包含观察延迟，不能宣称 GSAP 稳定提升同步精度。正式收益是共享阶段、可替换轨道和清晰所有权。

播放排队通常在 ANSWER 后约 20–50ms，实际声音约 170–200ms 开始，明显早于 650ms 卡体完全展开，说明动画没有挡住真实播放。相应的视觉取舍是：首句最初一段会先响，完整播报层稍后才出现。高亮身份始终由真实句段决定，但这段“声音先于完整正文”仍需用户视觉/听感确认。没有以动画时长驱动 live 状态迁移。

## 视觉问题

- 已修复：GSAP 保留参数 `data` 导致数据层未出现；改用 metricsContent，并加入最终 opacity/内容断言。
- 已修复：追问结束时 Canvas 发射起点已清空，视觉快照 key 可能变为 0，导致折叠卡片重建；现独立保存答案起点，并验证折叠期间正文保留。
- 已改进：关闭时从 +400ms 开始恢复主屏，与核心收拢重叠，避免粒子已收空后仍整场遮黑等待淡出。
- 待审美确认：分层入场的 8px 位移与 550–900ms 节奏；首段音频先响；打断后 200ms 折叠是否足够自然。
- 未新增新的背景能量汇聚美术；完整场景只编排原有核心成型/氛围场和淡入淡出。保留现有场景设计，不将此描述为重新设计的电影空间。

## 性能问题

- 未解决：软件后端 4K 合成不足；本轮不靠减少粒子/120 光流/卡片细节“过关”。原渲染器自身预算策略未改。
- 未验证：LED 现场、物理 4K 设备、全天稳定性、GPU 显存峰值；短样本无法承诺长稳。

## 生命周期问题

[最新记录](evidence/gsap-lifecycle.json)：隐藏时本层 pendingJob=false，暂停轨道保留，恢复后进度追到当前而不重播。卸载及 Next Link 离开后 liveControllers=0、liveTimelines=0、subscribers=0、pendingJob=false、activeListeners=0；卸载后额外等待 150ms，Canvas 绘制次数不再增加。

小川关闭但组件仍待命时，保留当前 1 个 controller、2 个空闲订阅，Timeline/job/ticker listener 为 0；这是下一次唤醒的现存实例，不是旧实例残留。只通过活动计数、绘制停止及回调清理验证，不宣称已用堆快照证明所有对象被 GC。

隐藏测试主动派发 document.hidden/visibilitychange，验证应用的隐藏处理逻辑；没有把它当作系统休眠、浏览器后台音频策略或真实切屏验收。物理麦克风/唤醒词/回声抑制/人声 barge 未做现场验证；本轮打断由合法 hub 状态事件触发，音频停止和视觉清理走真实实现。

## 正式接入建议

1. 值得进入架构审核：核心/光流/卡片共用视觉快照；命名轨道替换和释放；旧卡从实际姿态折叠；固定提示音、输入与输出振幅分源。
2. 适合保留为可选候选：内容分层、接管/返回重叠淡出。先由用户观看原版与新版再决定节奏，不直接设为默认。
3. 应保留原实现：JarvisCore Canvas 粒子、音频/业务状态机、P1.3 模板分页、主屏 MotionDirector 及质量策略、Legacy 完整回退。
4. 本 PoC 不足以批准全屏 GSAP 迁移或生产启用；本地施工结束，不启动 Task 11，不推送、合并或部署。
