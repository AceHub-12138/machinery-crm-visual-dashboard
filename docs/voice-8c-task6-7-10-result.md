# Task 6、7、10 施工与复核材料

2026-10-07。按用户指示在本机 01:41 PDT 后开始修改；基线为 Task 5 修复提交 `80a1c9e`，施工分支 `codex/voice-8c-task6-7-10`。

**代码施工已完成，尚不能标记全部验收通过。** Task 6 延迟目标未达标；Task 7 的真人远场、展厅噪声验收未进行；Task 10 的 `serious_long` 出现一次合成失败，仍需复核与参考质量调整。提交供 Claude 复核，不合并 main、不推送、不部署。原先未提交的任务书、架构文档与 `next-env.d.ts` 改动保留原状，不混入施工提交。

## 交付行为

- Task 6：live 大屏用 AudioWorklet 将原生采样率转成 16kHz 单声道 PCM，本地 Silero VAD 尾静音默认 500ms、最短 300ms、最长 15s。ambient 只送 KWS，listening/followup 送 VAD，播报等状态关闭音轨。实际播放末块结束后，再等待 outputLatency + 300ms 开麦。
- `/voice/wake`、`/voice/utterance` 只接受 screen Bearer，复用提问全局限流，校验 Origin、PCM 长度与格式，断开或退场中止识别。WS 保持原角色限制，仅当前轮播放回报与 Esc 可上行。控制台文字提问保留原流程。
- ASR 去除「你好小川」「小川」前缀后直接分类，取消录音路径的模拟逐字等待。纯问候再次邀请说话；空结果/不足两字与识别异常播放「抱歉先生,我没有听清。」后进入追问。追问开始检测到语音时保留会话，避免说话超过三秒被强制退场。
- Task 5 遗留：真实断流用 150ms 重新缓冲；ambient suspend 播放 AudioContext；卡片打字结束后停止 rAF；补「天、周、次、位、名、人、种、批、份、套」量词。
- Task 7：Worker 内本地 sherpa-onnx wasm + 2024 中文 3.3M KWS；离线 ppinyin 关键词「你好小川」、阈值/分数/能量配置、应答后五秒冷却。F9 与 KWS 共用 HTTP 唤醒流程。**可选“一口气唤醒并提问”未实现**，当前交互为唤醒 → 等应答 → 提问。
- Task 10：启动读取每组参考字节并保存快照，逐风格回环自检。default 失败禁用 TTS；其他失败仅禁用该风格。health 给出 styles、failedStyles、styleHashes 与各风格 CER。映射集中在 `speech-style.ts`，模型不能选风格。
- 每轮保持同一风格。风格不存在则回落 default 并记录 trace；运行时风格失败仅在首个音频字节尚未输出前整轮回落 default，已有声音后不换声线。固定话术按参考哈希、风格、文本独立缓存；某种情绪的短话术失败可用独立 default 缓存，default 也失败则关闭语音。对话台显示实际风格和回落。

业务快照继续由代码出卡和播报，分类请求不含业务数据。`JarvisCore.tsx` 与 screen 基线样式未改动。本批不包含 Task 8 库存投影或 Task 9 部署。

## 验证与原始数据

单元测试 368 项、Python 17 项通过。最终 lint、生产构建与 14 项浏览器回归结果见文末检查记录。

浏览器收音回归使用本机合成 WAV 注入 MediaStream，实际运行 AudioWorklet、Silero、HTTP 上传；独立回归用确定性 ASR/TTS，验证前缀、半双工和超过三秒的追问。完整延迟评测另用真实 ASR、LM Studio 分类与 TTS，三模型常驻。两种测试均未使用真人麦克风、跨机局域网或展厅环境，不能替代现场验收。

原始记录：

- `voice-8c-task6-browser-calibration.json`：20 轮真实模型、浏览器首样本调度计时。
- `voice-8c-task7-kws-calibration.json`：20 次正样本与 50 次负样本。
- `voice-8c-task10-style-calibration.json`：7 风格 × 5 文本 × 3 次，105 个评测用例。

### 唤醒词

同一份 macOS Tingting 合成「你好小川」录音重复检测 20 次，20/20 命中；「大川机床」「小川」「你好」「小王」「你好大川」各 10 次，无误唤醒。浏览器 Worker 错误为空。重复同一录音只验证确定性功能，不是 20 次真人独立试验。

尚需现场：2–3m、约 60dB 人声、真人 20 次 ≥18 次成功；唤醒到应答 ≤0.8s；一小时展厅背景误唤醒 ≤1 次。当前没有这些验收证据。

### 七风格持续评测

七风格启动自检均 CER=0、健康通过。持续合成结果如下，首包统计仅包含成功返回音频的请求；503 没有首包，不计入百分位。

| 风格 | CER≤10% | F0±15% 次数 | F0 中位 Hz | 失败/静音 | 重生成次数 | 首包 P50/P95 ms |
| --- | --- | --- | --- | --- | --- | --- |
| default | 15/15 | 14/15 | 97.76 | 0 | 0 | 306.29 / 334.48 |
| apologetic | 15/15 | 12/15 | 104.80 | 0 | 0 | 279.91 / 281.87 |
| cheerful | 15/15 | 3/15 | 138.73 | 0 | 0 | 282.54 / 286.61 |
| warm | 15/15 | 12/15 | 114.29 | 0 | 0 | 280.33 / 283.05 |
| serious_long | **14/15** | 12/15 | 113.48 | **1** | 1 | 309.81 / 310.95 |
| serious（未映射） | 15/15 | 12/15 | 109.59 | 0 | 2 | 281.53 / 531.19 |
| advise（未映射） | **13/15** | 8/15 | 90.23 | **2** | 8 | 344.87 / 541.87 |

default/apologetic 的 F0 中位在目标 104.3Hz ±15% 内，但分别有 1/3 条单条 F0 越界，不能声称逐条均达标。cheerful 按任务书已有试听决策允许较高音调。自动相关法 F0 和 Whisper CER 不是人工试听。所有参考音频/文本保持原样，没有通过换文本、删失败用例或降低静音门限改善报表。

另一次完整链路测试在固定话术缓存初始化时遇到合成失败并停止；这是上表之外的运行可靠性问题。已补上非 default 固定话术失败时重建 default 缓存的保护，然后完整跑完 20 轮；不能用这次成功重跑抹去先前失败。

`serious_long` 为已映射风格，因此其一次失败使“15/15 可懂、零失败”条件未通过。`advise` 未映射，仍保留失败结果供后续选用参考。评测曾在首次 503 时中断，补齐失败记录与断点续跑后得到 105 个唯一用例；这是恢复执行后的结果，不能解读为一遍无中断跑完。首音前默认回落保护不等于原情绪参考已通过验收。

## 本机配置与复现

本机 gitignored `services/voice-local/.env.local` 已添加 `VOICE_TTS_STYLES_DIR=~/voxlab/ref/styles_v1`，七组参考仍在用户原目录，不入仓。留空该变量保持只有 default；default 目录配对与原 default 配置必须一致。

新增编排环境变量见 `.env.example`：VAD hangover、开麦延时、KWS threshold/score/energy、wake phrase、`VOICE_SPEECH_STYLE_MAP` JSON 意图覆盖。更换唤醒词必须同步离线生成关键词文件，否则 Worker 提示 F9 回退；不是仅改一句环境变量就能改变模型词表。

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
pnpm lint
pnpm exec playwright test
# 在 voice-local Python 环境内运行：
python -m unittest discover -s services/voice-local -p 'test_*.py'
```

真实评测脚本：`scripts/voice-input-check.mjs` 需已运行的 voice-local、`VOICE_LLM_*` 与 `VOICE_TEST_AUDIO_DIR`；`services/voice-local/evaluate_styles.py` 需本机离线 Whisper 路径；`scripts/voice-kws-check.mjs` 需本地已服务的页面和合成 WAV 目录。脚本不提交 token 或参考素材；具体环境使用项目环境变量，不硬编码私密路径到生产配置。

VAD/ORT 资源由 `predev/prebuild` 从锁定 npm 包复制到 `public/voice/vad/`，运行时无 CDN，生成目录被忽略。KWS 包含本地模型数据和 wasm（约 25MB），来源、版本与 SHA256 见 `public/voice/kws/manifest.json`，Apache 许可证随包保存。使用固定 sherpa 提交 `99ddefaa92129858b80a71a426903dd4215c83fa` 和 Emscripten 4.0.23 构建官方 wasm KWS 工程；关键词由 sherpa-onnx-cli 1.13.8 生成：

```sh
sherpa-onnx-cli text2token --tokens public/voice/kws/tokens.txt \
  --tokens-type ppinyin input.txt public/voice/kws/keywords.txt
```

更改资源后更新 manifest 哈希。浏览器实际麦克风需本机安全上下文或 HTTPS，跨机 HTTPS 与自启动仍属 Task 9。

实现依据：[Silero 浏览器 API](https://docs.vad.ricky0123.com/user-guide/browser/)、[sherpa-onnx KWS](https://k2-fsa.github.io/sherpa/onnx/kws/index.html)、[固定版本源码](https://github.com/k2-fsa/sherpa-onnx/tree/99ddefaa92129858b80a71a426903dd4215c83fa)。

## 复核顺序

1. Claude 复核 HTTP 权限、取消与限流、状态门控、固定话术播放回报、风格缓存和回落。
2. 先解决下方 L1 预算缺口，并复测 ≥20 轮；保留 150ms 预缓冲与输出延时防回声，不能靠删除这些保护宣称达标。
3. 排查 `serious_long`/`advise` 参考可靠性与 default/apologetic 单条音高分布；参考若更换，成对处理、重新评测与人工试听。
4. 在现场完成真人远场、背景噪声、真实扬声器和跨机延迟验收后，才将任务书状态改为验收通过。

## 20 轮延迟与预算缺口

M1 Ultra / 64GB 本机，LM Studio `qwen/qwen3.6-35b-a3b`、现有 MLX ASR/TTS 三模型常驻；注入八份本机合成问题录音循环 20 轮，浏览器与服务均走回环地址，页面仍运行 KWS/VAD。20/20 完整播完，浏览器错误为空；库存问题保持 Task 8 尚未接入时的既定降级回答。

| 阶段/指标 | P50 ms | P95 ms |
| --- | --- | --- |
| **L1：VAD 结束 → 首样本调度** | **1229.90** | **1329.63** |
| L2：最后有声样本 → 首样本调度 | 1761.03 | 1856.00 |
| 最后有声样本 → VAD 结束 | 527.05 | 549.93 |
| 上传请求体读取（服务端） | 0.13 | 0.25 |
| ASR 推理（voice-local） | 218.25 | 237.49 |
| ASR HTTP 往返（含推理） | 221.50 | 239.80 |
| 分类 | 481.09 | 508.26 |
| TTS 首包（编排） | 362.16 | 440.72 |
| 同轮 TTS 首包（voice-local） | 356.85 | 435.43 |
| 同轮 TTS 首包差额 | 5.54 | 6.63 |
| 浏览器拿到首 PCM → 首样本调度 | 150.10 | 150.20 |

上传为本机请求体读取，不代表跨机上传耗时；ASR 往返与 ASR 推理为包含关系，不能重复相加。L2 最后有声样本用注入 WAV 最后一个幅度 ≥0.003 的样本估算；首样本为 Web Audio 调度时刻，没有测扬声器空气传播。P50/P95 分段值不可直接相加当总量。

Task 6 L1 门槛 P50≤1100、P95≤1300ms，本机分别超约 130/30ms，因此**延迟验收未通过**。主要预算为 ASR 约 222ms、分类约 481ms、TTS 首包约 362ms、必要预缓冲 150ms。第一轮 TTS 首包 657.88ms，L1 1537.30ms，保留在分布中，没有删冷尾或仅选择快样本。

本轮新增 voice-local 首包原始打点，用同一请求比较编排与服务端：差额中位仅约 5.54ms，包括本机 HTTP 发送/接收与客户端读取。任务书引用 Task 5 的 65–75ms 来自两份不同场景的直连/联调数字，本轮不能将其全部解释为“网络转发”。default 独立风格评测首包 P50 306.29ms，与三模型完整链路中的 default 首包存在差异；分类后 GPU 状态、参考解码缓存和计时边界可能影响，尚无单因素对照，不把差额武断归因某一修复。

性能优化应先复核 ASR/分类/TTS 分段预算，再按同口径复测；没有通过换用更小分类模型、删 150ms 预缓冲、降低静音阈值或更改参考对绕过原方案。

## 最终检查记录

- `pnpm test`：28 个文件、368 项通过。
- Python unittest：17 项通过。
- `pnpm lint`：通过，无错误/警告。
- `pnpm build`：通过，包含 TypeScript 检查与生产静态资源准备。
- `pnpm exec playwright test`：14 项通过，包含新增收音链路与既有画面、播放、退场回归。
- KWS manifest：7 项 SHA256 全部匹配；`git diff --check` 通过。

提交仅包含本批施工、依赖锁定、本地 KWS 资源、回归测试与报告。没有合并、推送或改变平台部署。按用户授权，检查完成并保存本地提交后关闭本次测试服务并执行 Mac 关机。
