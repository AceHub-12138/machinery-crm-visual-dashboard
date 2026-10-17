# NEXUS P1.5-A 性能基准体系校准

基线：P1.4 `df69d71`，GSAP PoC `1f9e9cd`，P1.3 `10a5e0b`。采集日期：2026-10-17。独立分支：`codex/nexus-p1-5-a-performance-calibration`。

## 结论

本轮成功标准是“数据更可信”，不是提高 FPS。P1.5-A 已把浏览器 RAF 调度代理、引擎底层回调、GSAP ticker listener/Director 更新拆开记录，并按实际环境校准了刷新节奏和回调机会损失。本轮没有改动产品源代码、业务数据契约、语音状态机、视觉时序、升降档阈值、恢复规则或默认动画引擎。

最重要的新证据是：同一台 100Hz 显示器上的 Metal 有头 Chromium 中，Legacy 的底层 RAF 和 MotionDirector 都约 100Hz；GSAP 的底层浏览器 RAF 仍约 100Hz，但 ticker listener 与 MotionDirector 约 60Hz。旧报告把前者统称为 RAF FPS，无法表达这一区别。

软件 SwiftShader 的 4K 样本中，Legacy 和 GSAP 均出现 4 次降档、3 次恢复；Metal 的 1080p/4K 四组均无降档。这个结果说明渲染后端比“动画库名称”更能改变本机样本的行为，但单机单次 60 秒样本不是统计显著性或展厅验收。

真实呈现帧率仍不可可靠获取。所有 RAF 数值均明确标为浏览器调度代理，不冒充实际显示帧率；Trace 的 GPU 事件时长也不冒充 GPU 利用率、功耗或呈现帧统计。

## 交付索引

1. [性能采集方案与指标定义](01-metrics-and-collection-plan.md)
2. [Legacy / GSAP 对照报告](02-legacy-gsap-comparison.md)
3. [软件 / Metal 渲染后端记录](03-render-backends.md)
4. [频率与质量档位时间序列](04-quality-timeline.md)
5. [诊断工具与复现命令](05-reproduce.md)
6. [P1.5-B 前置条件与验收建议](06-p1-5-b-entry-criteria.md)

原始正式计时 JSON、Trace、截图和服务日志保留在 `.review/p1-5-a/`；可提交的汇总、时间序列和 SHA-256 清单在 [evidence](evidence/)；可视曲线在 [cadence-quality.svg](figures/cadence-quality.svg)。P1.4 的 `docs/nexus-p1-4/` 未覆盖、未删除。

## 验证边界

- 8 个正式计时样本：SwiftShader/Metal × Legacy/GSAP × 1080p/4K，每组约 60 秒，顺序执行。
- 8 个独立 Trace 样本：每组约 10 秒；不计入正式性能数据。
- 16 张独立截图：每组 ambient/pulse 各 1 张；不计入正式性能数据。
- 业务夹具、随机种子 713、DPR=1、16:9、生产构建、动画触发计划和质量策略一致。
- 无录屏；因此不存在编码开销进入正式计时的问题。
- 所有正式样本从现有调试操作“恢复自动档”开始，用于清空预热阶段已累计的质量窗口；阈值与规则未改变。
- 页面脚本错误和 HTTP 4xx/5xx 均为 0；原始记录保留 10 条页面关闭时取消隐藏引擎链接 `_rsc` 预取的 `ERR_ABORTED`，已单独分类，不伪装成“网络记录为空”。

本轮本地提交后停止，等待架构审核；不推送、不合并、不部署、不启动 Task 11。

## 本地验证

- `pnpm build`：通过，生产构建与 TypeScript 完成。
- `pnpm test`：48 个文件、606 项通过。
- P1.5-A Node 测试：15 项通过（6 项指标算法 + 9 项证据矩阵/完整性）。
- `pnpm lint`：0 错误；2 条 P1.4 基线已有未使用变量警告，本轮未修改对应文件。
- `git diff df69d71 -- src public` 为空；产品文件 blob 清单 SHA-256 与 P1.4 相同，详见 [product-integrity.json](evidence/product-integrity.json)。
