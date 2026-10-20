# NEXUS P1.5-B 动画质量策略设计与受控验证

基线：P1.5-A `957ff26b3202510316213dec93f8a0d98c0758b4`。采集与验证：2026-10-17 至 2026-10-19。独立分支：`codex/nexus-p1-5-b-quality-strategy`。

## 结论

**候选“有效目标 + 正常负载探测 + 失败退避”策略通过本机受控验证，建议进入 P1.5-C 类型化架构和现场灰度设计；本轮不建议直接替换正式默认策略，也不建议全面迁移 GSAP。**

关键证据：

- 相同 60Hz 目标下，无头 SwiftShader 4K 的 Legacy/GSAP 均约 21.4Hz；不是单一动画库问题。
- Metal 1080p/4K 两引擎均稳定约 60Hz；GSAP 没有测出确定性能优势。
- 历史旧策略在 SwiftShader 4K 60 秒内 4 次降档/3 次恢复；候选三轮 45 秒测试均只有 1 次正式降档、0 次正式恢复，失败探测按退避执行。
- GPT-6 Luna 执行的 30 分钟长稳中，前 25 分钟 0 次误恢复；最后 5 分钟人为降负载后 47.158 秒自动恢复，之后保持 normal。
- 30 分钟内 active timeout/interval/RAF 恒定 0/3/1；堆、DOM、监听器没有持续上涨，结束 GC 后堆 7.43MB。
- 有头 SwiftShader 补测证明运行模式是显著混杂因素，headless 软件结果不能直接代表所有 SwiftShader 环境。

## 实现边界

产品侧只增加明确隔离的实验入口：仅 `debug=1&qualityExperiment=external` 停止原自动升降档，让外部候选控制器唯一驱动质量。构造器默认 `automaticQuality=true`；默认 URL、默认 Legacy 引擎、P1.4 阈值、视觉时序、共振、语音和数据语义均未改变。

候选策略本身仍在测试工具中，不在默认产品路径中。删除实验参数即回到 P1.4 策略。

## 交付索引

1. [更新频率与候选策略](01-strategy-design.md)
2. [Legacy / GSAP 同目标频率对照](02-frequency-comparison.md)
3. [新旧质量策略时间序列](03-quality-strategy-validation.md)
4. [30 分钟长时间稳定性](04-long-stability.md)
5. [Paint / Composite / GPU Trace](05-trace-costs.md)
6. [性能、视觉与自动化回归](06-regression.md)
7. [P1.5-C 架构输入与风险](07-p1-5-c-inputs.md)
8. [复现命令与证据](08-reproduce.md)

结构化汇总在 `evidence/`；大型原始 Trace、三次重复运行 JSON、30 分钟逐秒数据和失败 trace 保留在 `.review/`，由 manifest 记录 SHA-256。

## 是否建议纳入正式产品

当前建议：**不直接替换；批准进入 P1.5-C 实验实现/现场灰度。** 原因是本机数据证明候选方向有效，但阈值只覆盖一台 M1 Ultra、Chromium 153 和有限软件/Metal 场景，尚无目标展厅设备验收。正式化前还需 ticker 直接计数器、类型化策略接口、探测视觉过渡和现场长稳。

本轮交付后停止，等待架构审核；不推送、不合并、不部署、不启动 Task 11。
