# 采集与复查操作说明

本目录是诊断文档；`scripts/p1-4/` 只增加采集/分析工具，不被产品入口引用。所有网络业务数据均来自 `e2e/nexus-fixture-server.mjs` 的本地夹具，未复制 `.env.local`、未连接正式数据或语音服务。需要本机Node/pnpm和既有Playwright Chromium。

## 独立工作区

从已验证的 `1f9e9cd6d78e12f85eee47d087c87191f90a0460` 新建：

```sh
git worktree add -b codex/nexus-p1-4-motion-audit /Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit 1f9e9cd
```

该命令只在首次建立时执行；分支/目录已存在时直接进入，不重复创建。原P1.3、PoC、main均不checkout、不写入。

## 顺序执行

在诊断worktree中执行，基准/Trace/ablation/内存期间不同时跑测试、构建、录屏或另一份浏览器基准。

```sh
pnpm install --frozen-lockfile
pnpm build
node scripts/gsap-poc-benchmark.mjs
node scripts/p1-4/capture.mjs
python3 scripts/p1-4/source-audit.py
python3 scripts/p1-4/analyze-traces.py
node --expose-gc scripts/p1-4/analyze-heaps.mjs
```

- 第一个基准命令是**原PoC脚本原样复用**：1080p每引擎120秒、4K每引擎300秒；10次客户端切换；录屏/截图是另外的非计时阶段。端口3199/3047；输出 `.review/gsap-poc/performance/`。不要在此时打开录屏或多跑另一浏览器。
- `capture.mjs` 用同一Playwright、同一生产构建、夹具、seed=713、DPR=1、16:9、无reduced。它从原脚本提取原始 `instrument()` 与 `summary()`，不另定义不可比较的FPS算法。端口3199/3048；输出 `.review/p1-4/`。它会拒绝复用已占用端口，不停止其他人的服务。
- 可用 `P14_PHASE=trace` / `ablation` / `memory` 单独复查；`trace-repeat` 只复采4K；`hardware` 为独立有头四组60秒复核；默认按Trace→ablation→内存顺序运行。各阶段服务和浏览器在finally清理。不要对同一个输出目录并行执行。
- Trace阶段：1080p各12秒、4K各18秒，含主线程/失效跟踪/cc/gpu/viz/layers。它是有采集开销的诊断，**不替代原脚本的长样本FPS**。每秒重置原collector数组，标记质量等级时间点，记录CDP指标和图层几何/合成原因。最终Trace使用256MiB缓冲并保存dataLossOccurred；首轮36秒请求只有约23秒有效事件，已移到trace-initial-buffer-limited，不能当完整36秒Trace。图层/level读取在stream导出后可能包括采样后活动，因果关联以Trace内时间戳与采样窗口为准。
- ablation阶段：一次性浏览器页面只加CSS覆盖，分别隐藏Canvas、隐藏地图、关闭mask、关闭filter、无覆盖对照；每case24秒，正序+逆序两轮。DOM/业务数据/JS绘制循环保持原样。CSS只在关闭页面前存在；不是产品修改、不是建议删效果。每一项仍保留自适应保护，必须结合每秒level判断。
- 属性写次数独立6秒采集，对setAttribute/setProperty/Canvas draw调用加计数包装，会增加开销，只用于说明频率，不把其FPS当性能基准。
- 内存阶段：干净导航组、原collector但每次清空组、不导航驻留组。各70次、每次2.5秒、每次两次强制GC；导航组GSAP/Legacy交替，10/30/50/70均回到GSAP。同一路径同端点比较；10次作为预热端点，之后三批20次。干净组取10/30/50/70和15秒settled堆快照，驻留组也取settled快照。强制GC与堆快照**不在性能计时期间**。
- 分析脚本只读原始证据；trace以线程/质量等级分组，inclusive时间不能直接相加作CPU百分比；heap以稳定V8对象ID、浅大小、强保留路径分析，不将浅大小冒称dominator retained size。

Next build会重生成 `next-env.d.ts`。本轮已核对并恢复该自动生成差异，交付不包含它；构建产物 `.next/` 保留本地用于复查，不提交。

## 有头硬件加速复核

原PoC的默认Chromium headless shell在本机实测为SwiftShader软件后端。`P14_PHASE=hardware node scripts/p1-4/capture.mjs` 使用同版本完整Chromium、有头模式，四组各60秒，保持夹具/seed/DPR/布局；30秒请求一次原有共振。每个4K组另取12秒Trace。GPU状态单独保存在browser-gpu-headed.json，不覆盖软件后端记录。该补充实验与原120/300秒长样本分开报告，仍非展厅LED或长时验收。必须等前一个浏览器实验关闭再运行。

## 原始证据与分享

- 原PoC报告备份：`.review/p1-4/prior/benchmark.json`，没有修改原PoC目录。
- 新长样本：`.review/gsap-poc/performance/benchmark.json` 与 `*-raw.json`。
- Trace：`.review/p1-4/{legacy,gsap}-{1920,3840}.trace.json.gz`，解压后可由Chrome DevTools Performance导入；JSON支持user timing的 `P14:level:*` 标记。
- Trace统计/图层/DOM映射：`*-trace-summary.json`、`*-trace-metrics.json`。
- 堆：`memory-clean-{10,30,50,70}.heapsnapshot`、`memory-clean-settled.heapsnapshot`、`memory-dwell-settled.heapsnapshot`；Chrome DevTools Memory加载，Compare同CDP组内ID。
- 原始文件体积较大，保留在本地ignored `.review/`；Git内保留文档、分析脚本、精简证据JSON与哈希清单。跨机器架构审核时须连同原始证据提供，不能只看图。
- 机器序列号/硬件UUID不采集；GPU/浏览器/启动参数记录在 `environment/browser-gpu.json`。CDP不提供可靠的实际显存占用；图层像素边界不能当显存实测。

## 复查限制

Headless Chromium、软件或硬件渲染后端、LED实际刷新率、浏览器有头模式和DPR都会影响结果。报告必须标注实际后端，不将本机headless结果等同现场。声卡/麦克风/音频链路未运行；本轮不启动Task11，也不自动发布修改。
