# 视觉验收修复批（第 1–9 项）施工结果

分支 `feat/screen-design-polish-rebased`；施工基线 `d60fde6`；最新代码提交 `8c3a3a9`（主修复 `bd16fee`）。报告和证据随后单独提交，最后交付提交可用 `git log -1 --format=%h -- docs/visual-acceptance-1-9-result.md` 读取。此次继续在原分支上提交，未改写旧历史。

## 每项改动位置与验收

| 项目 | 改动 | 位置 | 验收 |
|---|---|---|---|
| 1 | 答不上来时显示“暂不支持”警示；简报删除重复服务副标题 | [src/components/overlay/OverlayStage.tsx:550](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/OverlayStage.tsx:550)；[src/components/overlay/AnswerCard.tsx:274](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/AnswerCard.tsx:274)；[src/lib/voice/card-presentation.ts:84](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/lib/voice/card-presentation.ts:84) | 兜底状态为 warn / Unsupported，标题“小川”仅一次，正文仍为原固定句 |
| 2 | 暂无数据、网络中断增加 30px 下一步指引 | [src/components/overlay/OverlayStage.tsx:552](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/OverlayStage.tsx:552)；[src/components/overlay/overlay.css:285](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/overlay.css:285) | 1280 下文案、30px 下限和零溢出通过；文案为临时版本 |
| 3 | 标题与播报共用分词、保护词和数字单位边界 | [src/lib/text-layout.ts](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/lib/text-layout.ts)；[src/components/screen/WordText.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/WordText.tsx)；[src/components/overlay/spoken-pages.ts](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/spoken-pages.ts)；[e2e/layout-audit.ts:72](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/e2e/layout-audit.ts:72) | “区域”“距离”等保持完整；长文本逐页重组；故意拆词能被检测 |
| 4 | 标题不再中间省略；34→20px 缩字，最多两行；极端标题完整分页 | [src/components/overlay/CardTitle.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/CardTitle.tsx)；[src/components/overlay/AnswerCard.tsx:274](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/AnswerCard.tsx:274)；[src/components/overlay/overlay.css:287](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/overlay.css:287) | 1280/1920/3840 下每页≤两行，字号≥20，全文重组一致、没有省略号 |
| 5 | 公开打码号取末尾数字，显示“尾号 0123”；Rajdhani 字体、等宽位置、同一行字号；空值不留列 | [src/lib/display-copy.ts:10](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/lib/display-copy.ts:10)；[src/components/screen/ContractTail.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/ContractTail.tsx)；[src/components/screen/ReminderRail.tsx:47](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/ReminderRail.tsx:47)；[src/components/overlay/cards/CustomersShipmentsCard.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/cards/CustomersShipmentsCard.tsx)；[src/app/globals.css](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/app/globals.css)；public/fonts/rajdhani/ | 打码和空值两种端到端用例，覆盖提醒和语音发运卡；前导零、等宽、字号、无省略号检查 |
| 6 | 排行留在右下；状态/图例分置上方两角；保护上海、宁波、日本标签完整进入视口 | [src/components/screen/ShipmentMap.tsx:564、589、623、423](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/ShipmentMap.tsx:564) | 三个分辨率下上海、宁波、日本、哈尔滨和黑龙江标签均存在，所有 HUD 与其交叠面积≤0.5px²，原地图宽度占比和 22% 门槛保留 |
| 7 | 负合同额核对文字进入主读数，保留 44px 下限；去掉下方重复小字 | [src/components/screen/KpiRail.tsx:110、113](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/KpiRail.tsx:110) | 单个负金额下主卡核对提示只出现一次；字号≥44、零溢出；原始负值未改变 |
| 8 | 内部列表说明改为“当前列出 X 条，已收录 Y 条”；地图改为“仅标注部分地点” | [src/lib/display-copy.ts:3、6](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/lib/display-copy.ts:3)；[src/components/screen/ReminderRail.tsx:38](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/ReminderRail.tsx:38)；[src/components/screen/DeliveryMilestones.tsx:70](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/screen/DeliveryMilestones.tsx:70)；[src/components/overlay/cards/CustomersShipmentsCard.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/cards/CustomersShipmentsCard.tsx)；[src/components/overlay/cards/RegionCard.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/cards/RegionCard.tsx) | 只转换显示，不重新计算任何计数、不改播报或业务口径；最终口径和文案留给 Task 11 |
| 9 | SVG 说明补偿地图自身缩放，达到 20px 设计字高；检测 SVG 实际变换后的字号与视口边界 | [src/components/overlay/ReadableSvgNote.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/ReadableSvgNote.tsx)；[src/components/overlay/cards/RegionCard.tsx](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/src/components/overlay/cards/RegionCard.tsx)；[e2e/layout-audit.ts:43](/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-design-polish-rebased/e2e/layout-audit.ts:43) | 正常说明零溢出；强制 SVG 1px 字号时检测必须报错；其他 SVG 地名也接受检查 |

## 临时文案与排版边界

- 无数据：“当前暂无可展示的数据，请稍后重试”；断网：“网络连接中断，请检查网络后重试”。均为 30px 展示指引，不改固定播报句，最终文案由 Task 11 确认。
- 列表说明只替换“样本 / 展示总量”的内部说法，保持两个原始数字及统计来源不变；“已收录”不新增任何取数或计算逻辑，最终展示口径由 Task 11 统一。
- 标题缩字下限 20px、每页最多两行。极端长标题在最小字号仍无法放入两行时，提供完整标题提示及显式翻页，不中间省略、不悄悄丢字；减少动效下也能手动看完。
- SVG 字号下限按原舞台设计像素口径检查：排除地图自身二次缩放后达到至少 20px；1280 和 4K 继续随整卡舞台缩放。不把 SVG 属性写着“20”当成已达到实际设计字高。
- Rajdhani 字体随项目提供，不运行时访问 Google。启用 tabular-nums，同时使用等宽数字位置，避免字体缺少 tnum 特性时出现不等宽；OFL 许可保留在 public/fonts/rajdhani/OFL.txt。
- 演示合同号只将原值改为 ****xxxx 格式；空值不补编号，原始公开结构和白名单不变。

## 测试结果

- 全量单测：39 文件 / 539 项通过。
- 最后完整浏览器回归：140/140 通过，0 skipped / 0 flaky / 0 unexpected。
- Lint、生产构建、TypeScript 检查、git diff --check 通过。
- 100 项卡片与新增视觉定向回归、15 项截图修复后的视觉复验通过；随后重跑全部 Playwright 文件。
- CPU 增量 P95：1920 为 1.60ms，1280 为 1.60ms；原 ≤8ms 阈值未改。不含 GPU/合成器。
- 验证元数据（本地证据：`.review/visual-acceptance-1-9-evidence/verification.json`） / 完整浏览器记录（本地证据：`.review/visual-acceptance-1-9-evidence/browser-full-final.json`）。

539 项单测包含原 533 项与 6 项新增展示/默认演示检查。15 项新增浏览器用例覆盖警示/指引、三档分辨率长标题与拆词、拆词负向检测、打码/空合同、三档地图避让、主读数去重、SVG 字号负向检测，以及默认演示的打码 API 和实际尾号展示。原断言全部保留；仅为新显示文案同步原两处期望文字，字号、尺寸、零溢出和 CPU 阈值均未放宽。

历史定向检查曾失败 5 项：长文本夹具超过协议的简报行长度、检测遗漏根元素、数字等宽尚未生效。已分别修正夹具、检测和等宽数字位置，JSON 记录保留在 `.review/visual-acceptance/`；最后结果以完整回归为准。

首次 139 项完整回归通过后，截图复核仍发现默认演示提醒调用里的未打码值、右上图例遮挡哈尔滨/黑龙江、标题两行利用不足。已补默认演示单测和端到端检查，扩充地图保护标签，增加真实两行检测并修正紧凑行高下的拆词判断；随后再次跑最终整套回归。前一轮记录保留为 `browser-full-before-screenshot-review.json`，不替代最后结论。

## 红线核对

- PublicSalesScreenPayload 定义、适配公开字段/白名单、平台代码、固定播报句、voice-local、运行依赖均未修改。
- 语音服务只有测试/演示 JSON 中 20 处合同号值改为打码格式，逐层核对键、数组长度和其他值完全不变；不改服务代码、接口或事件流。
- 负数仍显示核对提示；未知地区仍走 unresolvedRegionTotals；同月多目标仍沿用最新修改规则；不重新定义数据口径。
- 全部本地提交，未 push、未开 PR、未合并 main、未部署。原前端分支和其他工作目录不动。
- 本次验证为本地浏览器与截图复核。4–8 米实屏可读性、人声/音响与展厅噪声环境仍需现场确认；不把自动化当作现场验收。

## 当前证据与预览

截图、验证元数据及最后回归记录：`.review/visual-acceptance-1-9-evidence/`。之前前端批和迁移批的截图是历史记录，不覆盖。

[本地底屏](http://127.0.0.1:3023/screen/sales?fit=1) / [本地语音演示](http://127.0.0.1:3023/screen/sales?voiceDemo=1&lite=1)。


当前截图：默认底屏（本地证据：`.review/visual-acceptance-1-9-evidence/screen-default.png`）、警示简报（本地证据：`.review/visual-acceptance-1-9-evidence/unsupported.png`）、无数据指引（本地证据：`.review/visual-acceptance-1-9-evidence/guide-no-data.png`）、网络指引（本地证据：`.review/visual-acceptance-1-9-evidence/guide-offline.png`）、两行长标题（本地证据：`.review/visual-acceptance-1-9-evidence/long-title-1920.png`）、地图避让（本地证据：`.review/visual-acceptance-1-9-evidence/map-1920.png`）、负金额主读数（本地证据：`.review/visual-acceptance-1-9-evidence/negative-1920.png`）。

## 本地证据归档说明

本报告引用的原始截图和验证记录已移至当前工作目录的 `.review/` 对应子目录，仅保存在本地，不随 Git 分支分发。历史提交号用于追溯原验收批；清理前历史保留在 `backup/polish-022443f`，本次逐提交改写映射见本地 `.review/history-cleanup/commit-map.json`。
