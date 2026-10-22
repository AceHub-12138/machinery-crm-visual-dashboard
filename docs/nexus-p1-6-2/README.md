# DACHUAN NEXUS · P1.6.2 GSAP 兼容性收口

报告日期：2026-10-22。仅本地施工与提交，等待架构审核。**逐句无障碍通知已修复；CPU 8ms 原断言保留，软件入场峰值仍不合格，已提交可复现归因和验收提案，不能宣称整体性能全绿。**

本轮未执行推送、合并或部署，未启用生产 GSAP，未启动 Task 11。

## 基线与施工区

- 来源：`codex/nexus-p1-6-1-gsap-hardening`，完整 SHA `5ac9cff6398839d776ee5f92ac4fc34da92c9b3b`。开始时来源工作树干净，已有 10 个本地远端引用之外的提交；没有 fetch/push。
- 施工分支：`codex/nexus-p1-6-2-gsap-compatibility`。
- 施工区：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-6-2`。独立 worktree、独立离线依赖安装，未复制业务配置或密钥。
- 来源工作区保持不变；另建的 `...-p1-6-2-profile` 为本批专用 detached 计时构建，不属于发布源码。未清理其他工作区。
- 收口时共享远端跟踪引用发生外部更新，reflog 为 `update by push`，两个相关 origin 引用已指向 `5ac9cff`；本轮没有执行该操作，没有回退引用，也没有联网确认远端状态。见 [引用变化](evidence/shared-ref-drift.json)。
- [Git 基线](evidence/git-baseline.json)。最终提交 SHA 见本轮最终回复及 `git rev-parse codex/nexus-p1-6-2-gsap-compatibility`，本报告不写入自身提交 SHA。

## 实现与边界

产品改动仅三个文件：

| 文件 | 修改 |
|---|---|
| `src/components/overlay/sentence-announcements.ts` | 新增完整句子发布账本和 PCM 回调观察证据；不控制播放器/网络/语音状态 |
| `src/components/overlay/AnswerCard.tsx` | aria-live 使用独立通知时钟与生命周期；可见正文策略不变。缓存四个固定节点，只跳过相同样式值的重复写入 |
| `src/components/overlay/OverlayStage.tsx` | 将现有 PCM start/skip/drain/error 和取消事件传给观察账本；实际播放动作及语音 reducer 不变 |

可见 GSAP live 正文继续全文可读，不恢复逐字慢速展示。无障碍通知不再复用视觉 `typed` 进度：

1. 有本地真实 PCM 时，下一句开始证明上一句已完成，最终 drained 证明最后一句完成；只发布这些正向完成证据。没有虚构新的句末音频事件。
2. 重复/倒序/迟到事件不能提前完成句子；被跳过的不完整音频句不会因下一句开始而假装完成。暂停期间不发布新通知。
3. 没有本地 PCM 的兼容场景沿用安全的完整句子时钟；音频失败可转入同一安全规则，保留已发布账本以免重复。非播报屏即使收到 speech 元数据，也走无本地 PCM 的兼容规则，不能因此获得播放权。
4. reduced motion 无 PCM 保留既有整段完整可访问策略；有 PCM 时仍优先遵循实际完成状态，不因 reduced motion 提前发布全文。
5. 打断、已接受 barge、退出旧播放源、旧卡折叠会取消旧账本；新回答使用独立账本。通知计时器及 visibility listener 随组件/effect 清理，不由 GSAP Timeline 驱动。

85 个受保护源码文件逐字未变，见 [SHA 清单](evidence/protected-source-manifest.json)：包括 P1.6.1 许可/审计/Timeline 生命周期、GSAP ticker owner、JarvisCore、主屏 MotionDirector/质量策略、语音状态机、PCM 播放器、TTS/编排源代码和业务契约。动画参数、120 光流、缓动和 CSS 布局未修改。

## 验证结果

以下为最终生产构建的完整轮次；构建 ID 与三个产品文件的 SHA-256 见 [源码快照](evidence/final-build-source.json)。原始日志/JSON 与失败历史均保留。

| 检查 | 结果与证据 |
|---|---|
| 全量单测 | 59 文件、747 项通过：[日志](evidence/unit-all.txt) |
| TypeScript / 构建 | [类型检查](evidence/typecheck.txt)、[生产构建](evidence/build.txt) |
| lint | 0 错误、2 条未修改文件的既有警告：[日志](evidence/lint.txt) |
| GSAP 144 项完整扩展回归 | 143 通过、1 失败；唯一失败为原 CPU 8ms，0 skipped / 0 flaky：[报告](evidence/gsap-regression.json)、[日志](evidence/gsap-regression.txt) |
| Legacy 144 项完整扩展回归 | 144 通过，0 skipped / 0 flaky：[报告](evidence/legacy-regression.json)、[日志](evidence/legacy-regression.txt) |
| P1.6 + P1.6.1 + 本轮专项 | 35 通过（16 + 7 + 12），0 skipped / 0 flaky：[报告](evidence/special.json)、[日志](evidence/special.txt) |
| 四档几何与文字边界 | 1280、1792、1920、3840；每模式 116 份记录，0 越界、0 文字失败，双模式矩形差异无超过 0.5px；含普通/长文本、正常/音频不可用及两种 motion preference：[几何摘要](evidence/geometry-summary.json) |

新增纯单测覆盖：完整句子时机、PCM 优先、跳过句、暂停恢复、取消/折叠、失败回退、reduced motion、换答隔离和重复/倒序事件。浏览器专项覆盖两模式真实中文 PCM、句段高亮、drain 通知、可见全文、失败回退、连续回答、打断折叠和被动屏幕。

所有音频集成使用真实 Chromium AudioContext/PCM/Worklet 路径及脱敏测试音频；不是生产 TTS 推理、物理麦克风或扬声器现场验收。页面隐藏测试不等同于真实系统休眠/后台音频策略验收。

## 失败历史与性能裁决

- 先运行来源两个失败用例，二者均失败：[red-existing JSON](evidence/red-existing.json) / [日志](evidence/red-existing.txt)。没有删改 aria-live 或 8ms 断言。
- 原逐句读屏用例修复后定点通过：[报告](evidence/green-existing-aria.json)；首组 10 项新增边界通过：[报告](evidence/announcements-browser.json)。它们不是最终全量结果。
- 新增“被动屏有元数据但不播放”边界先失败 2 项：[报告](evidence/red-passive.json) / [日志](evidence/red-passive.txt)，随后将真实 PCM 观察限定为实际播报屏。该失败属于施工中新增覆盖发现的边界，不冒充来源已存在的失败。
- 资料清点脚本在共享引用更新、未推送对象为空时发生一次空输入错误，已修复脚本并重跑：[记录](evidence/inventory-script-failure.txt)。
- 一次新增测试 Window 类型声明错误导致构建失败，保留 [日志](evidence/build-initial-test-type-error.txt)，修复后生产构建通过。
- CPU 原 gate 的三个独立进程仍失败，1280×720 增量约 9.5 / 9.5 / 8.9ms。匹配阶段三轮表、Canvas/native/seek/DOM/布局/调度归因、量测偏差、无效轮次原因和待批准门槛提案见 [PERFORMANCE.md](PERFORMANCE.md)。

最终完整轮次前的一轮 Legacy 144 项已全部通过，单独保留为 [预最终报告](evidence/legacy-prefinal.json)；后续补齐了取消通知边界，因此没有用这轮结果替代最终双模式回归。

软件与 Metal 的原始数据、scope/native 探针、无探针对照分开保留。重叠单测的 Metal 第三轮标为无效并仅重采该轮，已完成有效轮次未重跑；没有拿带探针或降档帧的数据宣布 gate 通过。

## 资料清点与正式 PR

[PR-MATERIALS.md](PR-MATERIALS.md) 提出正式 PR 的最小源码/测试/小结果材料清单，并列出应暂留本地的视频、Trace 和原始调试样本。

当前基线树中大型/媒体文件约 233.5MB；开工时远端引用之外的历史大对象约 183.9MB，其中包括必要运行资源和地图数据，不能一概删除。收口时共享引用已更新，按当前本地引用重算的基线未推送对象为 0；这不等于公开材料已获审核。保留 [开工清单](evidence/large-evidence-inventory-initial.json) 和 [当前清单](evidence/large-evidence-inventory.json)，本地大型调试资料为 149 项、约 269.8MB。原始性能 JSON 位于 `.review/p1-6-2/performance/`，完整截图、录屏、Trace 和各 worker 原始记录也保留本地。

本轮仅提交精简报告、CSV/摘要、原始资料哈希清单、源码和可复现测试；不新增视频/Trace ZIP 到 Git。是否上传历史对象取决于目标远端已有对象；本轮没有联网核验，不能依据共享引用更新推断公开资料边界已获批准。正式公开 PR 须经审核后另做可构建的源码整合与 reachable-object 白名单检查；本批不整合、不重写、不上传。

## 复现、diff 与回滚

```sh
pnpm install --frozen-lockfile --offline
pnpm build
pnpm test
pnpm exec tsc --noEmit
pnpm lint
P161_OVERLAY_MODE=gsap P13_EVIDENCE_DIR=.review/p1-6-2/p13-gsap pnpm exec playwright test --config e2e/p1-6-2-regression.config.ts
P161_OVERLAY_MODE=legacy P13_EVIDENCE_DIR=.review/p1-6-2/p13-legacy pnpm exec playwright test --config e2e/p1-6-2-regression.config.ts
pnpm exec playwright test --config e2e/p1-6-2.config.ts
python3 scripts/p1-6-2-performance-summary.py
python3 scripts/p1-6-2-delivery-inventory.py
```

性能复现入口：`p1-6-2-perf-run.py <worktree> <label> --early [--headed]` 启动三轮独立进程；`p1-6-2-original-cpu.py <worktree> <label>` 保留原 8ms Oracle 的三轮结果；`p1-6-2-profile-build.py <新的独立工作区>` 生成仅本地的计时构建，再在该目录安装和构建。带探针的数据必须明确标记，不能混入无探针 gate。

源码/测试精确增量见 [code-diff.patch](code-diff.patch)，全部交付文件见 [changed-files.txt](changed-files.txt)，资料哈希见 [artifact-manifest.json](artifact-manifest.json)。完整本地 Git diff 另外交付于忽略目录，未推送。

回滚：在本施工分支执行 `git revert <本轮最终提交SHA>` 恢复 P1.6.1，保留 `5ac9cff` 的许可及审计清理保护；不撤销 P1.6.1。若只需停用本地 GSAP，撤销实验服务的 `XIAOCHUAN_MOTION_PERMISSION` 并重启该本地服务即可。没有生产操作。

提交后停止，等待架构审核；CPU gate 的失败和新提案均不得自动转为生产启用许可。
