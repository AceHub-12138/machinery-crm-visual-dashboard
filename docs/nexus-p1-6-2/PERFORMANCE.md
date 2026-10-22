# P1.6.2 CPU 归因与架构裁决提案

报告日期：2026-10-22。**8ms 断言未改动，原 GSAP 用例仍失败。本文件提供裁决证据，不替代失败结果，也不授权生产启用。**

## 口径和实验条件

原测试指标是同一 RAF timestamp 下产品回调的同步 JS + Canvas CPU 时长之和，取 2.5 秒窗口 P95，再减主屏基线窗口 P95，要求增量 ≤8ms。它不是 GPU 时间、真实显示呈现 FPS 或物理屏幕验收。

- Chromium `153.0.8010.12`，DPR=1；1920×1080、1280×720。Canvas 背衬沿用原系数 0.75，未调低。
- 固定同一 `region_shipments/normal` fixture；Math.random seed=713，Jarvis 原有独立 seed=`0xc97f3d`。
- 原 high 预算：core 2200、ambient 3000、sparks 64、光流 120；原有自适应保留，未强制永久低档，未删粒子/光流。GSAP ticker cap 仍为 60Hz。
- Canvas 自有 RAF 可以跟随浏览器刷新频率；CSV 的 RAF 间隔不是 GSAP ticker 频率，也不是实际显示呈现帧率。
- 软件环境：ANGLE SwiftShader；CDP 返回 2d_canvas=`unavailable_software`、gpu_compositing=`disabled_software`。
- 硬件环境：ANGLE Metal / Apple M1 Ultra；2d_canvas 和 gpu_compositing 均为 `enabled`。完整浏览器/设备/featureStatus 在原始 JSON 中。
- 每轮重启 Playwright/浏览器进程，每个模式与尺寸使用新上下文；第 2 轮反转模式顺序。两模式使用相同 fixture、预算、DPR 和采样阶段。
- 匹配入场窗口：从答案开始后立即采 2.5 秒；匹配稳定窗口：统一等待两种模式的安全展示完成时间后再采 2.5 秒。另保留先等核心成型的对照系列。

完整 P50/P95、采样数、排队时间、RAF 注册成本、布局/样式累计时长见 [CSV](evidence/performance-windows.csv) 和 [结构化报告](evidence/performance-summary.json)。每个原始样本的本地路径、大小、SHA-256 见 [原始样本清单](evidence/performance-raw-manifest.json)。数据留在本工作区 `.review/p1-6-2/performance/`，未上传。

## 三轮无产品探针的匹配结果

下表是相对于各自主屏基线的 P95 增量，单位 ms；三项对应三轮独立进程。它们是诊断结果，不是修改后的新验收断言。

| 后端 | 尺寸 | 模式 | 同阶段入场 | 同阶段稳定 |
|---|---|---|---|---|
| SwiftShader | 1280×720 | Legacy | 8.7 / 8.6 / 8.7 | 1.3 / 1.3 / 1.4 |
| SwiftShader | 1280×720 | GSAP | 8.8 / 9.0 / 8.9 | 1.3 / 1.3 / 1.2 |
| SwiftShader | 1920×1080 | Legacy | 9.1 / 9.7 / 9.8 | 1.5 / 1.4 / 1.5 |
| SwiftShader | 1920×1080 | GSAP | 9.7 / 10.1 / 10.2 | 1.2 / 1.5 / 1.5 |
| Metal | 1280×720 | Legacy | 2.4 / 2.5 / 2.5 | 0.9 / 0.9 / 0.9 |
| Metal | 1280×720 | GSAP | 3.0 / 3.2 / 3.2 | 0.9 / 0.9 / 0.9 |
| Metal | 1920×1080 | Legacy | 2.4 / 3.0 / 2.4 | 0.8 / 0.9 / 0.9 |
| Metal | 1920×1080 | GSAP | 3.1 / 2.5 / 3.2 | 0.8 / 0.8 / 0.8 |

结论限于本次条件：软件后端的入场峰值同时存在于 Legacy 与 GSAP；稳定阶段和 Metal 样本明显较低。不能据此宣称 GSAP 没有额外开销，也不能把软件后端失败简单归咎于 GSAP Timeline。

## 原 8ms 用例的复现与采集偏差

修复前两项历史失败均先复现，见 [red-existing](evidence/red-existing.json)。做完最小 DOM 缓存后，原 CPU 用例又在三个独立进程复现：1280×720 增量约 **9.5 / 9.5 / 8.9ms**，全部保留失败。原断言、2500ms 窗口、两档尺寸和高质量策略均未删改，只增加原始样本记录。

原用例调用 `show()` 等待 `data-spoken-complete=true` 再采样。GSAP 可见正文保持全文，原采样开始约在 ANSWER 后 90–116ms；Legacy 的正文完成约在 2.75 秒之后。因此“都等显示完成”并不等于“比较同一阶段”。本次另建匹配阶段采样，未用它替换原 gate。

原用例每轮 viewport 都调用 addInitScript：第一档采集器深度为 1，第二档为 2，存在额外包装扰动。本次保留原结构并记录深度，另设每个上下文只安装一次的对照。**没有证据把所有超限归为包装错误**：独立计时的 Canvas renderer 本身也出现高尾部成本，不能以“测量有偏差”抹掉真实失败。

## 开销分离及观察者效应

只在本批另建的 detached profiling 工作区插入计时作用域，最终产品源码不含 `profileSpan` 或 Canvas API 包装。生成方法见 `scripts/p1-6-2-profile-build.py`；具体 patch、构建日志和源文件留在 `.review/p1-6-2/` 与本批 profile 工作区。该构建不用于 8ms 判定。

计时层级：

| 类别 | 量测内容与限制 |
|---|---|
| Canvas renderer | Jarvis 整帧 CPU，含投影/积分、Canvas 调用和属性写入；不是纯 GPU 绘制时间 |
| Canvas native API | drawImage、fillRect、stroke 等同步调用时长/调用数；不含未包装的属性 setter；只作归因 |
| Timeline seek | 每个轨道的 totalTime 调用，保留全部原始 invocation |
| DOM painter | 答案卡 paint；缓存稳定节点并跳过相同值样式写入后，视觉数值及调用时机不变 |
| subscriber/ticker/host | 分别保存 inclusive 与 exclusive 时长；不能把嵌套项相加冒充总成本 |
| 布局/样式 | CDP LayoutDuration/RecalcStyleDuration 的窗口累计差值，不伪造为每帧 P95 |
| 调度 | RAF 注册成本、callback start−RAF timestamp 排队时间；后者不是 callback CPU |

作用域三轮中，renderer 是主要开销；seek、ticker 和答案卡 painter 的单次 P95 多为 0.1–0.2ms 量级或低于计时分辨率。原生 API 探针三轮显示 drawImage 占 renderer 累计成本的主要部分，例如 1280 第一轮 drawImage 约 365.5ms、整段 renderer 约 486.6ms。不能将 renderer−native 总和简单称为纯数学成本，它还包含属性写入和探针开销。

原生探针增加了 CPU 开销，并使部分帧触发原有自适应。记录中保留 ambientStride/coreHalf/high/DPR/120 光流预算及 full-quality 帧数，原始数据没有因低档而删除。预算相同不等于每一帧实际参与绘制的点数相同；探针数据不参与 gate 数字，也不作为“降低粒子后通过”的依据。最终无产品探针对照另行采集，全部保留。

最小优化仅移除每次 painter 的四个固定 DOM 查询及相同值的样式写入，没有重写 Canvas。它未消除软件入场峰值，本批不宣称 CPU 项已修复。

这些三轮诊断样本先于最后的“被动屏无本地 PCM”判定及取消通知补齐采集；后两项只作用于无障碍账本，不修改本次采样使用的 Canvas、Timeline 或 DOM painter。最终生产构建另跑完整双模式回归，其中原 8ms 用例仍直接检验最终源码。诊断轮次不会被冒充为最终完整回归，最终构建及产品文件哈希见 `evidence/final-build-source.json`。

## 无效轮次与保留规则

一次启动发生在新增测试类型错误导致构建未完成之后，没有产生有效性能样本；日志保留在 `invalid-build-start`，补上 BUILD_ID 前置检查后重新启动。

Metal 第三轮与一次单测有短暂重叠，标记为无效，原始数据保留在 `invalid-unit-overlap`，不计入表格。仅重采第三轮，第一、二轮没有重跑。替代样本为 `early-headed-recheck-r3`。有效与排除样本均有清单和原因。

没有把 trace 的 inclusive 时长当 GPU 利用率，没有把 RAF 观察频率当物理 LED 呈现验收。未隔离操作系统全部后台活动，三轮短样本不能证明全天性能。

## 提交架构审核的提案，尚未批准/实施

**现状：原 8ms gate 保持原样，软件后端失败仍阻止声称全绿。**

建议先选择验收范围，再改测试合同：

1. 若坚持所有后端、所有阶段均 ≤8ms：保留当前失败，后续另行批准 Canvas 内部不降质优化；本批不靠削减视觉过关。
2. 候选方案：Metal 的匹配入场与稳定阶段仍 ≤8ms；SwiftShader 稳定阶段仍 ≤8ms，软件入场另设 **P95 ≤12ms 的候选诊断预算**。12ms 是基于本次最高约 10.2ms 留余量的提案，尚不足以证明适用于其他设备，需要架构批准并补充更长样本后才可落地。

无论选择哪项，都应统一 fixture、后端、DPR、质量标志、采集器安装次数和 ANSWER 相对时间窗，继续公开旧 gate 的失败历史。本批**没有写入 12ms 断言、没有跳过 CPU 用例、没有静默降级 CI、没有启用生产 GSAP**。
