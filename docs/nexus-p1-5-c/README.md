# DACHUAN NEXUS P1.5-C · 类型化质量策略与受控灰度准备

施工分支：`codex/nexus-p1-5-c-quality-integration`。基线依次为 P1.5-B `2584284e3e7b994d0510d9d53b2a302e3aa740bc`、P1.5-A `957ff26b3202510316213dec93f8a0d98c0758b4`、P1.4 `df69d71`。

默认入口保持 Legacy + Baseline。Candidate 和 Shadow 只接受明确服务端本地许可及回环地址；历史 `qualityExperiment=external` 已失效。仅本地施工、测试、提交；没有推送、合并、部署、数据库变更、生产灰度或 Task 11。

## 本地结果

| 验证 | 最终结果 |
| --- | --- |
| 纯策略与全项目单测 | 649 / 649 |
| P1.5-C 集成 / 原 GSAP PoC | 15 / 15；8 / 8 |
| Legacy / GSAP 同套回归 | 各 63 / 63 |
| 通用回归 | 196 / 196，0 跳过、0 失败 |
| 无许可入口 / 历史入口 / 独立基线对照 | 5 / 5；3 / 3；2 / 2 |
| 构建 / TypeScript / lint | 通过；lint 0 错误、2 条既有警告 |
| GSAP / Legacy 墙钟长稳 | 1800.081 秒 / 600.064 秒，均自动恢复 normal |
| 视觉采集 | 两引擎 × 四分辨率，56 帧、2 段视频 |

正常负载探测失败与成功恢复都已记录。人眼流畅性、小川真实音频节奏、目标设备刷新率切换和展厅 LED 验收仍待审核。本地许可只能用于回环地址；有效参考低于 52Hz 的设备暂不进入 Candidate。GSAP 保留 60Hz 上限，Default 仍为 Legacy + Baseline。

## 审核入口

1. [接口、状态机、唯一控制权与 ticker 所有权](01-architecture.md)
2. [本机许可、开启、关闭与完整回滚](02-operation.md)
3. [自动化、长稳、ticker 实测、失败历史](03-validation.md)
4. [正常负载探测视觉证据与人工审核](04-visual-review.md)
5. [交付文件、提交与展厅灰度条件](05-handoff.md)
6. [结构化验证汇总](evidence/summary.json)
7. [证据 SHA-256 清单](evidence/manifest.json)

自动化、虚拟时钟、真实墙钟长稳、视频和人眼/展厅验收分别记录。调度更新率不等于显示器实际呈现 FPS；本机测试不能替代展厅 LED 验收。
