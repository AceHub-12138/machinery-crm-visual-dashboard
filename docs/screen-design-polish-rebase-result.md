# 前端修复批迁移到数据口径批：本地施工结果

- 新分支：`feat/screen-design-polish-rebased`，基线 `70be18a`（`codex/screen-data-display`）。
- 原分支：`feat/screen-design-polish`，仍为 `b86b5fb`；18 个提交全部逐个 cherry-pick，没有删除、重写或漏迁。
- 工作目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased`。
- 最后代码施工提交：`767dcfd`（附带修复提交 `54f28d3`）。报告及证据随后单独本地提交；最终交付提交可用 `git log -1 --format=%h -- docs/screen-design-polish-rebase-result.md` 查询。
- 平台文档分支 `codex/screen-data-reconcile`，文档提交 `f2ce4dd`，仅修改 `docs/screen-data-reconcile-result.md`。
- 未推送、未合并 main、未开 PR、未部署；无数据库、权限或服务器变更。原 main 工作目录和其他工作树不动。

## 保留的三条业务规则

1. 负金额、计数、台数仍显示“数据待核对”，原始 payload 负值保留。对应比率与进度图不渲染。金额拆分工具对数值和已格式化负数字串均使用同一提示，不还原为负数字。
2. 地图排行与语音消费完整 `delivery.regionUnits`，`routes` 只供点位样本；未知地区仍消费 `unresolvedRegionTotals` 并显示“地区待确认”。公开接口、类型、白名单及字段文件与 `70be18a` 完全一致。
3. 同月公司目标仍由平台 `public-service.ts` 按 `updatedAt desc, id asc` 读取最后修改的一条；平台该查询未改动。前端继续使用既有 collection 字段，不改成读取旧目标实际值。

KPI 主卡与环形图圆心的核对文字使用单行 FitText（最小 18、最大 label 令牌），正常数字仍保留主读数 44px、环心 40px 的下限；1280/1920/3840 增加文字不换行、真实 Range 不越界与字号检查。

## 冲突处理

- 4138681: format.ts, DeliveryMilestones.tsx, ShipmentMap.tsx — 保留负值核对、北京日期、完整统计与未知地区；合入金额拆分和全文提示。
- f3eba02: AnswerCard.tsx, ProgressCard.tsx, overlay.css — 保留发运时钟、目标设置与实际回款/新合同欠款语义；采用前端字号、金额适配与卡片尺寸。
- 006ffe8: KpiRail.tsx, TargetRing.tsx — 保留目标有效性、累计回款率和本期合同口径；负值核对文案用 min18/max22 FitText，正常数字保留主读数44与环心40下限。
- e8c353d: AnswerCard.tsx — 保留数据批句级发运翻页时钟与暂停行为，合入减少动效。
- bd6effd: ShipmentMap.tsx — 右下角布局合入，同时保留地区待确认与其他省份提示。
- 31bb322: ReminderRail.tsx — 前端单列分页和44px计数合入；保留全量计数、样本/展示总量标识和负计数核对提示。
- 4f4981b: DeliveryMilestones.tsx — 时间轴和全部分页合入；仅SHIPPED、北京日期、全量summary与样本/展示总量标签仍以数据批为准。
- db8503c: KpiRail.tsx, DeliveryMilestones.tsx — 保留实际回款/新合同欠款、真实目标率、负值格式；合入单位绑定、定宽缩字与读屏全文。
- 集成复验: ProgressCard 202px 数据区保留两项新增口径，双指标行时 gap22→10；所有高度和字号断言不变。

数据逻辑以数据批为准，尺寸/字号/布局以前端批为准。提醒仍标注样本与展示总量；交付只列 SHIPPED，保留完整统计与北京日期，同时使用 112px 时间轴和分页。核对金额完整值作为悬停提示保留，没有删改原 HTML 金额断言。

## 指定的附带修复

- 保留 JarvisCore 减少动效的单张静态画面行为。新增实际调度循环测试：一帧后不继续排 RAF，一秒的后续时钟内仍只画一次；正常动效对照能检出连续帧。状态或尺寸变化时允许重新绘制新的静态快照。
- 未知状态原因仅删除该可选字段，合法状态事件的状态、问题和轮次继续处理；已知四种原因保留，坏的必填字段仍拒绝。新增未知字符串、null、数字、对象及已知值测试，验证能进入 thinking。
- `intent-answers.ts` 只改一行播报为“先生，数据待核对。”。原单测 108/164 及浏览器 88 附近断言只同步期望文字，其他断言保留；两仓库指定结果文档同步。
- `tts/fixed-lines.ts`、`voice-local/core.py` 及其他半角“先生,”保持与数据基线一致。

## 测试与证据

- 全量单测：38 文件 / 533 项通过（511 原有 + 11 迁入前端 + 11 本次新增）。
- 最后一轮完整浏览器回归：125/125 通过，0 skipped / 0 flaky / 0 unexpected；覆盖仓库全部 Playwright 文件，包括 voice-cards、text-fit、screen-data-reconcile、播放、收音、音频归属和样本级音频质量。
- Lint、生产构建、TypeScript `tsc --noEmit`、`git diff --check` 通过。
- 进度卡六项定向复验通过，25 项数据/文字定向复验通过；之后再次完成整套回归。
- RAF CPU 增量 P95：1920 为 1.60ms，1280 为 1.70ms，原门槛仍为 ≤8ms；不包含 GPU/合成器。
- 证据：[验证元数据](screen-design-polish-rebase-evidence/verification.json)、[完整浏览器记录](screen-design-polish-rebase-evidence/browser-full-final.json)、[提交映射](screen-design-polish-rebase-evidence/commit-map.json)。
- 截图：[负数 1920](screen-design-polish-rebase-evidence/negative-1920.png)、[负数 1280](screen-design-polish-rebase-evidence/negative-1280.png)、[负数 4K](screen-design-polish-rebase-evidence/negative-3840.png)、[进度卡](screen-design-polish-rebase-evidence/实现_1_target-progress.png)、[区域卡](screen-design-polish-rebase-evidence/实现_3_region.png)。

- 511 项原数据批单测全部保留，迁入前端新增 11 项，本次新增 11 项，总计 533。数据批原断言未删除；前端原负数格式/长值期望因负数业务规则改为“数据待核对”。
- 可见溢出零容忍、卡片 s/m/l 高度及数据区断言、1020×scale 底边和 8ms CPU 门槛均保留。数据批旧检测之前没有读屏节点，迁入后只补 `.sr-only` 可见性过滤，并额外调用更严格的文字审计；这不会放行可见文字溢出。
- 首次定向回归曾把隐藏全文误报为溢出；首次完整回归发现进度卡两项新业务指标使 202px 数据区越界。历史 JSON/trace 保留在 `.review/rebase/`，最终结论以最后验证为准。
- `PLAYWRIGHT_SILENT_AUDIO` 未启用。浏览器测试保留实际 AudioContext/PCM/worklet 与 VAD 路径；推理使用测试替身，未接生产 CRM 数据，不代表真实人声、硬件或展厅验收。
- 原前端批迁入的报告与截图为历史证据。当前基于数据口径批的截图和验证信息位于 `docs/screen-design-polish-rebase-evidence/`。

## 逐个提交对应

| 原提交 | 新提交 | 内容 |
|---|---|---|
| `4138681` | `b5885c3` | feat(screen): 建立缩字与全文补偿工具，避免长值撑破布局 |
| `5fd0db3` | `39265a8` | feat(voice-ui): 独立表达异常原因并把声音提示放入卡片 |
| `f3eba02` | `af2f995` | feat(voice-ui): 提升语音字号并保留新尺寸几何断言 |
| `006ffe8` | `110fddc` | feat(screen): 放大主读数和回款环并限制缩字下限 |
| `40e8257` | `282f433` | feat(screen): 默认隐藏英文眉标与语音调试提示 |
| `14033cf` | `7575c8e` | feat(voice-ui): 将覆盖层主线框统一为品牌橙 |
| `d414d97` | `4203dcb` | feat(voice-ui): 读屏只播完整句并避免逐字重复通知 |
| `e8c353d` | `18798f6` | feat(voice-ui): 减少动效时静态绘制并保留真实音量采样 |
| `fdd8b11` | `09fc098` | test(e2e): 重写溢出检测并扩充长字符串和异常状态回归 |
| `bd6effd` | `dac5cd7` | feat(screen): 扩大地图并外移浮层，同步更新几何验收 |
| `31bb322` | `ee54b33` | feat(screen): 提醒以数字为主，按紧急程度单列翻页 |
| `4f4981b` | `3df6a8a` | feat(screen): 交付里程碑改为横向时间轴并保留全部分页记录 |
| `805c5d7` | `3bba230` | feat(voice-ui): 聆听时展示真实音量，并保留原有收音判定 |
| `312c2ec` | `9b118bf` | feat(voice-ui): 卡片按内容分档，长播报按三行测量翻页 |
| `db8503c` | `d38814f` | feat(screen): 补齐大金额与长标签边界，保持数字单位同一行 |
| `0e2b180` | `8164654` | feat(screen): 提交 P2 超宽与过渡设计稿，待确认后实施 |
| `de5d1a5` | `0f04be9` | feat(screen): 让长标签裁剪真正生效，防止时间轴相邻文字重叠 |
| `b86b5fb` | `2ca602f` | feat(screen): 交付前后对比、阶段截图和本地验收报告 |

## 本地复核与回退

本分支预览：[底屏](http://127.0.0.1:3023/screen/sales?fit=1) / [语音演示](http://127.0.0.1:3023/screen/sales?voiceDemo=1&lite=1)。原前端批 3021 预览未改动。

```bash
pnpm test
pnpm lint
pnpm build
pnpm exec tsc --noEmit
pnpm exec playwright test
```

需回看原前端批时，使用原工作目录 `/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish`；需回看数据批时，使用 `/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-screen-data`。两个原分支均保留，不需改写历史。P2 仍只保留设计稿，未新增实际超宽布局或其他未批准功能。
