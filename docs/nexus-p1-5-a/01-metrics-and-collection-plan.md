# P1.5-A 性能采集方案与指标定义

## 三层频率

| 字段 | 含义 | 采集方式 | 能否称为真实显示 FPS |
| --- | --- | --- | --- |
| `browserRafProxyHz` | 浏览器给独立原生 RAF 探针的回调节奏 | 页面初始化前保存原生 RAF，并运行独立轻量探针 | 不能，仅是调度代理 |
| `engineClock` | Legacy 的 RAF 主循环；GSAP 的 ticker 底层 RAF 回调 | 包装页面脚本使用的 `requestAnimationFrame`，记录间隔和回调成本 | 不能；GSAP listener 可低于底层 RAF |
| `gsapTicker` | GSAP ticker listener 更新 | 记录配置上限 60Hz；当前一条待执行 Director job/每次 listener 的拓扑下，以 Director 更新频率作 1:1 估计 | 不能；且不是独立直接探针 |
| `motionDirector` | MotionDirector 实际更新频率估计 | 每秒读取既有 Director 内部 1 秒采样窗口 FPS | 不能；它是应用更新频率 |

GSAP ticker 更新没有新增产品接口。报告保留 `independentDirectInstrumentation=false`，明确它来自当前 1:1 拓扑推导，不伪装成独立硬件遥测。如果以后 ticker 同时服务多个消费者，必须先增加获批的只读计数器，不能继续沿用这个推导。

## 刷新率与回调机会

- `system_profiler SPDisplaysDataType -json` 报告当前物理显示器为 `1920×1080 @ 100.00Hz`。
- 每个正式场景在空白页单独校准浏览器 RAF 调度节奏：有头约 100Hz，无头约 60Hz。
- 无头调度与物理显示器刷新率不是同一件事。无头结果中的物理呈现刷新率标为未知。
- 回调机会损失以该场景校准得到的中位间隔为参考，不再硬编码 60Hz：`sum(max(0, round(interval/reference)-1))`。
- 这项统计只叫“估算缺失回调机会”，不能写成 GPU 掉帧、实际呈现丢帧或显示 FPS。

## P95/P99、长任务与档位统计

- P50/P95/P99 使用 nearest-rank，在原始间隔/时长样本上计算，不插值制造不存在的观测值。
- 长任务来自 `PerformanceLongTaskTiming`；次数、总时长、P95/P99、最大值分开记录。
- Total Blocking Time 仅累计每个长任务超过 50ms 的部分。
- 档位每秒采样一次；切换时间精度约 ±1 秒。报告保存原始点，不用平均频率替代档位曲线。
- 降档为 `normal → low`，恢复为 `low → normal`。连续次数从完整时间序列推导，不只看最终档位。
- 共振请求固定在约 10s、30s、50s。接受/拒绝按未改动的同步前置条件判断；低档拒绝单独计数。由于 `data-motion-state` 在下一次 draw 才更新，立即读取的 DOM 状态只作旁证，不作为接受判据。

## 成本边界

| 成本 | 正式窗口 | 独立 Trace |
| --- | --- | --- |
| 动画/脚本计算 | 引擎回调时长；CDP `ScriptDuration` | `FunctionCall`、`EvaluateScript` 等事件 |
| Main Thread | CDP `TaskDuration` | Renderer Main Thread 完整事件 |
| Layout/Style | CDP `LayoutDuration` / `RecalcStyleDuration` | `Layout` / `UpdateLayoutTree` / `RecalculateStyles` |
| Paint | 不从 RAF 推断 | `Paint` / `PaintImage` / `PrePaint` |
| Composite/Raster | 不从 RAF 推断 | `CompositeLayers` / `RasterTask` / `DrawFrame` 等 |
| GPU | 不从 Main Thread 推断 | GPU Process 事件；仅 inclusive event duration |

Trace 事件会嵌套、跨线程重叠，所有时长均为 inclusive duration，不可相加为总耗时。GPU Process 事件时长不等于 GPU 利用率。

## 采集开销

正式窗口只启用独立 RAF 探针、引擎 RAF 包装、长任务观察器及每秒一次 Playwright 读取；探针自身回调耗时被单独记录。Trace、截图和视频编码均不在正式窗口内。本轮未录制视频。

## 旧脚本到新口径的映射

| 旧字段/做法 | 问题 | P1.5-A 处理 |
| --- | --- | --- |
| `fps` | Legacy 时近似 Director RAF；GSAP 时是 ticker 底层 RAF；含义随引擎变化 | 拆成 browser RAF、engine clock、ticker estimate、Director update |
| 固定 `1000/60` 算 missed vsync | 100Hz 环境会把正常回调误判；无头也未必代表硬件 | 每场景空白页校准；名称改为回调机会损失 |
| `directorRecords` | 只在切档/10 分钟周期记，无法还原曲线 | 每秒时间序列 + transition 表 |
| RAF callback cost | 不包含绘制、合成、GPU | 正式 CDP 主线程指标 + 独立 Trace 分类 |
| Headless Chromium | 未强制体现软件/硬件差异 | SystemInfo + WebGL 双证据分类 SwiftShader/Metal |

原旧脚本及其证据保持不变，便于审核者逐项对照。
