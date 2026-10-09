# Voice 8c 音质修复结果（待 Claude 复查，未通过完整验收）

日期：2026-10-08。施工目录：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard-task12`；分支：`codex/voice-8c-task12`。依据桌面 Task 12 复查及音质修复规格；采用复查要求的 Task 12 分支，先提交 M1，再分别提交 A、B。没有开始 Task 11。

## 当前结论

M1 和五项外观修复已完成；音质 A、B 代码已实现。24kHz 分块排播和整体播放逐样本一致，同码解码的快照/现场预热逐样本一致，五句 SNR 与 F0 起伏门槛通过，七风格启动自检通过，首包延迟门槛通过。

**七风格生产流式评测仍未通过**：105 次中 advise 2 次、warm 1 次 HTTP 503；cheerful F0 中位超过 104.3Hz ±15%。已停止继续改动音质 B，不调整参考、不降低门槛、不切换原彩排服务。所有失败原样保留。需要 Claude 复查这些问题与后续修法；不能宣布音质验收完成。

## A：浏览器播放

- 优先创建 `AudioContext({sampleRate:24000,latencyHint:"interactive"})`；构造失败回落默认硬件采样率，trace 记录实际 `playbackContextRate`，对话台明确显示回落。48k/44.1k 回落仍存在原块边界重采样缺陷。
- 保留 50ms PCM 块、150ms 预缓冲。欠载后的块开头线性淡入 5ms，逐轮统计 `playbackUnderruns`，通过当前轮/当前所属大屏校验后的 metrics 事件记入 trace 并显示。
- 让声、原生 suspend/resume、截止时间冻结、outputLatencyMs 读取均保留并回归验证。
- 实际 PcmPlayer 注入 Chromium OfflineAudioContext(24000)，20 个分块相对整段播放：不一致样本 0，最大差异 0。并非单独复制排播逻辑的模拟验证。
- 实体回声测试脚本改为优先 24kHz 输出，支持 `--quiet-only` 重跑原门槛 AEC 开无人声 10 次；没有获得设备/安静环境确认，因此本轮未执行物理录音测试。真人外放试听也未完成。

## B：参考码预热与状态快照

- `VOICE_TTS_DECODER_PRIME_FRAMES` 默认 50，0 关闭。配置进入新的 refHash，旧固定话术缓存自动失效。
- 通过已编译 decoder 的 bound reset 方法获取真实实例，只在实例上包 reset。每句流式开始的第一次 reset 恢复对应风格快照，后续 reset/取消/结束只清理，不再次预热。未修改已安装 mlx-audio 或任何参考文件。
- 启动自检使用模型自身 ICL 缓存，每风格编码一次并保存 reference_codes。快照包括全部卷积 _buffer、_overflow、transformer KV cache 的 keys/values/offset。KV 数组恢复时复制，防止原库索引赋值污染下一次恢复。
- 原 evaluate_styles.py 已调用生产 HTTP /tts。本轮补充明确流式路径记录、PCM 格式核验、F0 起伏指标、七风格试听保存，以及不同解码哈希禁止复用旧报告。
- 新服务仅用于隔离验证，地址 `http://127.0.0.1:18812`；原 `8810` 彩排语音服务保持旧版。新服务启动时七风格自检全通过且 CER 都为 0；新的隔离固定话术缓存已重建且 ready=true。

## 同码真模型验证

使用与 Claude 实验相同的五句、seed 1000–1004 和 default 参考。每句捕获生产流式 codes，分别做清零、现场预热 50 帧、恢复快照、重复恢复，以及参考码前置的离线解码。

- 五句快照/现场预热逐样本完全一致；重复恢复也逐样本一致。
- SNR：16.98、16.35、17.74、16.61、17.61dB（门槛 >=11dB）。
- F0 起伏差异：0.099、0.015、0.059、0.185、0.083 半音（门槛 <=0.5）。
- 快照恢复主机端调用耗时 0.058–0.141ms；实际生产 HTTP 首包延迟见下表，避免把主机端测量等同于端到端开销。
- 原始证据：`docs/voice-8c-decoder-prime-calibration.json`；脚本 `services/voice-local/verify_decoder_prime.py`。

## 七风格生产流式评测（5句 ×3次 ×7风格）

Whisper 可懂度门槛 CER <=10%，F0 风格中位沿用 104.3Hz ±15%；延迟门槛 P50 <=350ms、P95 <=600ms。该轮与浏览器回归并行，属于有浏览器测试负载的本机测量；不代表展厅负载或孤立性能。

| 风格 | CER达标 | 合成失败 | F0中位Hz | F0中位门槛 | 首包P50/P95 ms |
| --- | --- | --- | --- | --- | --- |
| default | 15/15 | 0 | 96.4 | 通过 | 306.2 / 397.2 |
| advise | 13/15 | 2 | 92.3 | 通过 | 285.3 / 538.8 |
| apologetic | 15/15 | 0 | 101.5 | 通过 | 285.5 / 290.2 |
| cheerful | 15/15 | 0 | 128.3 | 未通过 | 283.8 / 285.4 |
| serious | 15/15 | 0 | 115.7 | 通过 | 284.4 / 288.0 |
| serious_long | 15/15 | 0 | 108.1 | 通过 | 313.2 / 400.2 |
| warm | 14/15 | 1 | 111.1 | 通过 | 282.8 / 533.9 |

成功的 102 次均 CER <=10%；3 次 503 计为失败，未从总数中删除。没有截断；首包统计仅计算成功返回音频的请求，不掩盖失败率。cheerful 超限，以及 advise/warm 的失败，均使完整风格验收不能通过。

失败具体问题：advise 的“我在,先生。请讲。”第3次，以及长合同额句第1次；warm 的失败位置见原始 JSON。advise 缺失的第1次长句试听另发一次成功请求补齐，作为独立试听样本，没有改写 105 次原始评测。

原始证据：`docs/voice-8c-audio-quality-style-calibration.json`、`docs/voice-8c-audio-quality-cache-calibration.json`。

## 旧版服务对照

对原 8810 服务用同五句各三次，分别检查 advise/cheerful/warm 的 HTTP 成功率和同样的 F0 算法，不重复 Whisper，因此仅用于根因范围对照。

- 旧版 advise：3/15 次失败，F0 中位 90.6Hz。
- 旧版 cheerful：0/15 次失败，F0 中位 124.0Hz。
- 旧版 warm：0/15 次失败，F0 中位 116.5Hz。

旧版已复现 advise 合成失败与 cheerful 的 F0 中位超限。warm 旧版本轮 0/15 失败、新版 1/15；采样文本相同但 codes/随机序列不同，不能据此认定或排除回归，留待 Claude 复查。不能因旧版也有问题便算作新版本通过。

证据：`docs/voice-8c-audio-quality-baseline-calibration.json`。

## 自动回归与交付边界

- Vitest 470/470 通过；Python unittest 28/28 通过；TypeScript、ESLint、生产构建、diff 检查通过。
- M1 阶段 36 项卡片浏览器检查通过，真实 VAD 暂停态截图用例通过。第一次并发运行两个 Playwright 进程，共用输出目录导致 ENOENT 追踪文件清理冲突；该轮 46 通过、1失败、7未运行，不能当通过证据。
- 已改为顺序运行最终完整浏览器回归：70/70 通过，0失败、0跳过、0重试后通过，约9.3分钟。原始 JSON 与日志存放本机 `.review/`；汇总证据 docs/voice-8c-task12-repair-verification-status.json。
- 试听：`/Users/apple/Desktop/语音试听/音质修复/`，七风格各一组同句修复前/后，以及 default 五句同码前/后。WAV 均 24kHz / mono / int16，只是生成样本，不代表真人听感通过。
- M1 截图：`docs/design/answer-card-mockups/修复_M1_打断暂停.png`。用户截图确认、真人外放试听、物理回声无人声10次均未完成。
- 未合并、未推送、未部署。原彩排服务未切换，Task 11 未开始。

本地提交：M1 `39cbefe`；A `a6836f6`；B（本提交）已作为待 Claude 复查的独立提交保存。B 的风格验收状态不通过，不因提交而改变。

视觉预览 3018 已重启为本轮生产构建： http://localhost:3018/screen/sales?voiceDemo=1 。该地址只做卡片轮播，不连接旧语音 hub，不表示音质 B 已投入彩排。
