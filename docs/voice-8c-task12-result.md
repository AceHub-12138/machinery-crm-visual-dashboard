# Voice 8c Task 12 施工与验收记录

施工目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-task12`

施工分支：`codex/voice-8c-task12`

基点：`561ae0ef51493635e85f3834a773fa6885cd8de5`（barge-fix 修复分支）

依据：桌面 `voice-8c-local-stack-tasks.md` v7 的 Task 12，以及用户对第一、第三张播报区和追问条间距的补充要求。

## 完成的改动

- 八种答案卡采用统一切角铜/琥珀框、固定标题区、数据区、小川播报区和追问条。新增客户概览、跟进待办、回款结构三种数据卡；简短回答只显示一次播报正文。
- 1920×1080 下卡片顶边 400px、数据卡底边 1020px，标准宽 880px、区域卡宽 1040px；720p 整体等比缩放。核心进入回答时向 y=225 平滑上移、缩至约 0.75 倍，退场复原。JarvisCore 渲染文件未改动。
- 按用户追加要求，小川播报标题与正文之间保留 8px，正文使用 19px 字号、1.55 行高和均衡换行，避免区域卡末行短尾；追问条与播报区间隔 16px，到卡框底边留白 60px（原为 36px）。简短回答保留 36px 底部留白。
- 圆环卡三行指标收进固定数据区，避免第三行贴近播报区。
- 发运清单每页最多 5 行、最多 3 页，约 400ms 水平过渡；有句级播放边界时同步，没有对应句子时按 4s 翻页；超出部分汇总。合同只展示尾号。区域排行 TOP5，其他省份汇总，地图保留全部落点并复用已有投影和省界数据。
- 标题、设备、状态等长文本显示省略片段，保留完整文本在 title/无障碍标签。金额、零值、180% 超额显示均有边界用例。
- 七张数据卡自动轮播，全部走唤醒、思考、展开、回答、等待和收回流程；演示数据由当前大屏公开 payload 转换，避免独立夹具与屏幕数据不一致。
- 新卡片字段逐项校验；三种新模板沿用确定性数据构建与金额 formatter。追问映射集中管理，仅包含已支持意图。生产播报话术保持原有内容。

可选的规则提示、地面光环未加入。本次未涉及真实 ERP 接入、Windows 硬件验收、TTS/ASR 模型或麦克风/VAD/打断实现修改。原 3015 演示服务及 3016 修复测试服务保留。

## 验证记录

当前已完成验证：

- 单元测试：468/468 通过。
- TypeScript/生产构建与 ESLint：通过。
- Task 12 浏览器检查：36/36 通过；其中包含 8 种卡片 × 正常/长数据 × 两个分辨率的 32 组布局检查，以及零值/180%、分页、七卡完整轮播、CPU 帧增量检查。
- 1080p 数据卡底边 1020px、追问条底部留白 60px；720p 对应约 680px 和 40px。布局记录无水平文字溢出，数据文字无纵向越界。
- 覆盖层 RAF 回调 JS/Canvas CPU 成本 P95 增量，两档分辨率均约 1.4ms；此指标不包含 GPU/合成器，不能代替实机帧耗时验收。
- 本地 Qwen 分类器追问检查：11/11 通过。

最终完整浏览器回归：**69/69 通过，0 跳过、0 重试后通过**，耗时约 9.3 分钟。运行命令：

```sh
PLAYWRIGHT_SILENT_AUDIO=0 PLAYWRIGHT_JSON_OUTPUT_FILE=.review/task12-playwright-complete.json caffeinate -di pnpm exec playwright test --reporter=list,json --max-failures=3
```

先在干净进程中重跑此前失败的 19 项，19/19 通过；随后关闭静音测试选项，用默认原生 AudioContext 输出完成全部 69 项连续回归。只在测试期间临时防止自动休眠，随测试结束退出。本轮未新增产品代码修复。此前的音频时钟停滞及后续超时未在最终回归中复现，具体环境触发原因未完全确认，不把此次通过视为系统音频问题的永久修复。上一轮 50 通过、19 失败的记录仍保留在 JSON 中。

证据：[布局与 CPU](voice-8c-task12-browser-calibration.json)、[分类器](voice-8c-task12-followup-calibration.json)、[完整回归状态](voice-8c-task12-verification-status.json)。

## 自动测试的音频环境限制

此前本机 Headless Chromium 的独立音频探针中，AudioContext 虽显示 running，1.2s 内音频时钟只前进约 0.0053s，造成既有音频回归超时。此前回归未通过，不算作验收成功；最终默认输出回归结果见上节。

采用原生静音 sink 后，同一探针在 1.2s 内前进 1.2s。本轮重新测量默认输出，1.2s 内音频时钟前进约 1.189s，恢复正常；最终 69 项回归没有启用静音 sink。`e2e/audio-test.ts` 仅在 `PLAYWRIGHT_SILENT_AUDIO=1` 时启用该测试选项，仍运行真实 PCM、AudioContext、analyser、worklet/VAD/KWS 和 WS/HTTP 流程；普通运行保持默认物理输出。没有修改产品播放器或系统音频设置。探针记录见 [音频环境证据](voice-8c-task12-audio-environment.json)。静音测试不代表扬声器、展厅麦克风或 Windows 实机验收。

## 本地视觉预览

[打开 Task 12 自动轮播预览](http://localhost:3018/screen/sales?voiceDemo=1)

3018 服务运行最终生产构建，绑定 127.0.0.1；浏览器实测 HTTP 200 并展示第一张目标进度卡。此地址用于七张数据卡的视觉轮播，不连接原 3211 hub 做真人语音测试。原 3015/3016 页面和 3210/3211 hub 均保留原进程。

启动方式：`TZ=Asia/Shanghai pnpm exec next start --hostname 127.0.0.1 --port 3018`。构建变更后需重启预览服务。运行 PID 和日志仅保存在本机忽略目录 `.review/`。

## 八张实现截图

截图使用固定验收夹具，便于与 Claude/用户认可的概念图对照；不代表真实 ERP 业务数值。

| 编号 | 模板 | 实现截图 |
| --- | --- | --- |
| 1 | 合同额目标进度 | [查看](design/answer-card-mockups/实现_1_target-progress.png) |
| 2 | 目标完成率 | [查看](design/answer-card-mockups/实现_2_completion-ring.png) |
| 3 | 区域发运分布 | [查看](design/answer-card-mockups/实现_3_region.png) |
| 4 | 发运清单 | [查看](design/answer-card-mockups/实现_4_customers-shipments.png) |
| 5 | 客户概览 | [查看](design/answer-card-mockups/实现_5_customer-kpi.png) |
| 6 | 跟进待办 | [查看](design/answer-card-mockups/实现_6_followup-buckets.png) |
| 7 | 累计回款 | [查看](design/answer-card-mockups/实现_7_collection-split.png) |
| 8 | 简短回答 | [查看](design/answer-card-mockups/实现_8_brief.png) |

原参考图仍在原始 checkout 的 `docs/design/answer-card-mockups/`，未改动用户原文件。此施工目录只提交本次生成的八张实现图。

## 交付边界

Task 12 改动及最终验收记录已整理为独立施工分支的本地提交；未合并、未推送、未部署，未移动演示版本标签。新版截图需要用户人工确认；真实音频输入输出与 Task 9 展厅设备验收仍待完成。
