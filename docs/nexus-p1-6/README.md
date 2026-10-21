# DACHUAN NEXUS · P1.6 小川 GSAP PoC

本地原型已完成，默认仍为 Legacy。等待架构审核及用户视觉确认。没有推送、合并或部署。

基线：`cf1a835fbbc4e3f62311987e23677ea3fb862125`
分支：`codex/nexus-p1-6-xiaochuan-gsap`
工作区：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-p1-6`

## 先看演示

- [Legacy 完整交互视频（含实际浏览器播放音轨）](media/legacy-interaction.mp4)
- [GSAP 完整交互视频（含实际浏览器播放音轨）](media/gsap-interaction.mp4)
- [完整流程左右对照：左 Legacy / 右 GSAP，无音轨](media/side-by-side.mp4)
- [以首次 ANSWER 为近似起点对齐的左右对照](media/answer-aligned.mp4)
- [Legacy 视频联系表](media/legacy-video-contact.png) / [GSAP 视频联系表](media/gsap-video-contact.png)
- [主要阶段时间轴](media/timeline.svg) / [实际时刻和性能数字](evidence/comparison-summary.json)

同一问题“本期新增客户有多少家”，同一卡片 fixture：新增 12、总数 120。同一预合成中文 PCM，经真实 PcmPlayer 播放；未使用模拟语音时长。背景为仓内脱敏 fixture，视频不含真实客户或合同信息。两个完整视频都包含唤醒、思考、回答、真实播报、连续回答、播报中打断、再次回答、折叠及返回主屏。

完整影片按相同步骤录制，截图编码/渲染等待会带来几百毫秒的整体位置差异；近似对齐影片使用独立 performance/视频时基换算，精确阶段比较请看相对 ANSWER 的 JSON。所有视频是浏览器场景录屏，声轨采自浏览器输出，不是物理扬声器录音。这里不把软件性能数据等同于现场观感。

## 关键帧

| 阶段 | Legacy | GSAP |
|---|---|---|
| 唤醒 | [图](media/legacy-wake.png) | [图](media/gsap-wake.png) |
| 思考 | [图](media/legacy-thinking.png) | [图](media/gsap-thinking.png) |
| 答案出现 | [图](media/legacy-answer.png) | [图](media/gsap-answer.png) |
| 播报 | [图](media/legacy-speaking.png) | [图](media/gsap-speaking.png) |
| 打断 | [图](media/legacy-interrupt.png) | [图](media/gsap-interrupt.png) |
| 再次回答后的追问 | [图](media/legacy-followup.png) | [图](media/gsap-followup.png) |
| 折叠退场 | [图](media/legacy-exit.png) | [图](media/gsap-exit.png) |
| 主屏恢复 | [图](media/legacy-returned.png) | [交叉淡入](media/gsap-return-crossfade.png) / [恢复](media/gsap-returned.png) |

另有四种分辨率的 Legacy/GSAP 截图，以及 `headed-*` 的 Metal 截图，均在 media/。

## 审核材料

1. [施工前动画清单及属性所有权](01-animation-ownership.md)
2. [实现、参数、音频和回退设计](02-design.md)
3. [完整测试、视觉/性能/生命周期问题和接入建议](03-verification.md)
4. [代码差异](code-diff.patch)
5. [逐文件 SHA-256 清单](artifact-manifest.json)

建议优先审核共享发射编排和打断清理，分层入场与场景交叉淡出保留为候选。Canvas 粒子、原语音状态机、P1.3 布局分页、主屏 MotionDirector/质量策略和完整 Legacy 回退继续保留。

## 本地复现

依赖：仓内 pnpm 依赖、Playwright Chromium；视频后处理需要 ffmpeg。

```sh
pnpm build
pnpm exec playwright test --config e2e/p1-6.config.ts
P16_PERF_TAG=headed- P16_REPORT=browser-headed-results pnpm exec playwright test --config e2e/p1-6.config.ts --headed --grep 'geometry and performance'
node scripts/p1-6-analyze.mjs
node scripts/p1-6-media.mjs
```

测试会启动回环地址 fixture（3199）和独立大屏端口（3066），结束自动关闭。审核页由该测试配置显式启用；普通服务未设置 `XIAOCHUAN_POC_REVIEW=1` 时返回 404。普通大屏删去 `xiaochuanMotion` 参数即可回退，主屏引擎开关与它独立。

音频源文件为 `audio/0.pcm`、`audio/1.pcm`（24kHz/mono/s16le）；分别为“本期新增客户十二家。”“客户总数为一百二十家。”，由本机 macOS Tingting、180 字/分钟合成。只用于本地确定性集成演示，不替换正式 TTS。

原始长录制及临时调试留在忽略目录 `.review/p1-6/`；交付用视频、截图、紧凑原始证据和摘要已经保存在本目录。当前实际 CPU/GPU/显示器信息均来自本轮重新采集。
