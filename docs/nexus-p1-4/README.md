# NEXUS P1.4｜动效架构审计与4K诊断交付

建议采用GSAP作为主要视觉编排技术，保留MotionDirector、业务状态机、SVG/Canvas渲染和轻量CSS。本轮不全面迁移，不改变产品视觉，完成后停在架构审核。

最重要的新证据：原4K问题在本机默认Playwright headless shell的软件渲染路径中复现；Metal硬件加速补充实验没有复现反复降档。不能把原约47FPS直接当作展厅GPU能力。软件路径内动态全屏Canvas可见合成是主要负载，正常档Display绘制约47ms，RAF编排计算约0.4ms；两轮隐藏Canvas诊断对照恢复约60FPS，隐藏地图/关mask/关filter均无相同效果。**这些对照不是删除效果的方案。**

## 六项交付

| 交付物 | 内容 |
| --- | --- |
| [动效使用清单](01-animation-inventory.md) | CRM、桌面、NEXUS三个实际仓库；模块、文件、触发、生命周期、属性所有权、调用关系与风险 |
| [GSAP统一架构](02-gsap-architecture.md) | 现状/建议架构图、MotionDirector定位、每个JS运行时的ticker所有权、业务/动画/音频时间边界、迁移与回退 |
| [4K性能报告](03-performance-diagnosis.md) | 原四组长样本、软件/Metal后端、完整Trace、绘制对照、升降档因果、采样器限制 |
| [内存报告](04-memory-diagnosis.md) | 预热后多轮导航、驻留/collector对照、六份堆快照、旧实例身份与强保留路径、未解决边界 |
| [下一轮施工任务](05-next-implementation-plan.md) | 优先级、收益、风险、依赖、验收、回退；所有产品改造均待审核 |
| 本页架构决策建议 | 下表逐项回答六个决策问题 |

辅助交付：[复查操作说明](REPRODUCE.md)、[逐行源码索引](source-index.md)、[版本与源码哈希](source-versions.json)、[精简证据与原始文件哈希](evidence/artifact-manifest.json)。源扫描覆盖113个命中文件、548行命中；不将命中数等同动画模块数，误命中、第三方内核与未部署分支边界均有说明。

## 架构决策建议

| 问题 | 建议与依据 |
| --- | --- |
| GSAP是否适合作为主要动画编排技术？ | 适合。CRM已有useGSAP基础，NEXUS proxy PoC可复用；价值是编排和生命周期一致性，不能宣称换库提高4K性能。保持每个应用独立运行时，不建立跨进程全局ticker。 |
| 哪些优先迁移？ | 先补现有Chat转场清理和ticker边界；再采纳已PoC的NEXUS入场/共振/数字插值；CRM内嵌屏和桌面重复数字后置；语音答案卡视觉序列最后，保留原demo回退。 |
| 哪些不应强制迁移？ | SVG地图/投影/标签、Canvas逐像素、Spline/Leaflet渲染内核、业务金额/库存计算、语音reducer、AudioContext/drained、业务刷新/打印焦点计时、简单hover/focus CSS。 |
| 4K主要瓶颈是什么，证据够不够？ | 对本轮默认软件后端，证据足够指向SoftwareRenderer的动态Canvas合成负载；有头Metal四组60秒均normal、包含共振。对真实4K LED、长时运行和显存/硬件GPU内核瓶颈，证据不够，不能推断现场已通过或GPU不足。 |
| 升降档振荡如何处理？ | 保留已有45/52阈值与5/10秒持续判断的事实；新增独立驻留、满档恢复probe、失败记忆/退避和窗口日志。低档60FPS不能证明高档容量，不能永久锁低档冒充优化。 |
| 下一轮先实施什么最小修改？ | 先在测试工具明确GPU后端/刷新率/真实场景更新率；独立quality策略补丁；共享前隔离ticker所有权与Chat转场清理。仅在需软件回退或实际硬件长测仍失败时做保持原视觉的Canvas合成PoC。 |

## 验证结果与实际局限

- 原PoC基准脚本原样复测：1080p每引擎120秒，约60FPS；4K每引擎300秒，Legacy 46.73、GSAP 46.71FPS，两者各20次降档/19次恢复；夹具业务哈希与原PoC一致。
- GPU核验：默认headless shell为SwiftShader软件后端；完整有头Chromium为Apple M1 Ultra Metal。物理参考屏1920×1080 @100Hz，4K为虚拟viewport。两引擎各分辨率60秒均normal并完成共振；非现场LED验收。
- 补充节奏核验：底层RAF均约100Hz，Director实际Legacy约100、GSAP约60。GSAP的ticker限帧不会取消每次底层RAF请求；不能把原collector读数直接当画面更新率。
- 最终六份Trace：软件1080p各12秒、软件4K各18秒、Metal4K各12秒；4K补采和MetalTrace均dataLossOccurred=false。最初缓冲受限数据与启动采参失败日志均保留，未覆盖掉失败证据。
- 内存：两个导航组各70次（含10次预热），另70次不导航驻留读数；六份堆快照。旧Director/Scene及对应场景timeline在同文档软导航中回收；未发现动画实例累积。预热后增速趋缓，但浏览器缓存、Performance记录及DevTools资源仍有增长，未证明全天无泄漏。
- 生产构建通过。原606单测/134浏览器用例来自已核实PoC报告，**本轮未重跑，未计作本轮新通过数**。本轮验证重心是新采集、对象路径、工具语法、数据完整性与工作区保护。
- 未测真实语音音频链路、真实4K LED、全天运行、浏览器RSS或显存；没有因此修改产品或视觉降级。

## 施工分支与安全结果

独立目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-4-motion-audit`。

分支：`codex/nexus-p1-4-motion-audit`，产品源代码基于 `1f9e9cd6d78e12f85eee47d087c87191f90a0460`；确认其包含P1.3基线 `10a5e0b`。只新增 `docs/nexus-p1-4/` 和 `scripts/p1-4/`；原始证据放在本地ignored `.review/`，Git内提供精简数据和哈希清单。

产品src/public、依赖锁文件、e2e、services和配置与PoC一致；构建自动生成的next-env.d.ts差异已核对恢复。原PoC、P1.3、main工作区未修改；不修改PR #2。不推送、不合并、不部署、不启动Task11。所有诊断浏览器与本轮服务已关闭。

下一步仅交架构审核。原始Trace/堆快照体积较大，留在本机；跨机器审核需按manifest连同原始证据提供，不能只依据截图或结论。
