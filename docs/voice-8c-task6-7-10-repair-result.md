# Task 6 / 7 / 10 审查修复结果

2026-10-07。本批在 `codex/voice-8c-task6-7-10` 修复 `ea6ffee` 的审查问题。提交前已核对仓库当前 v6 任务书的决策 I/J/K；任务书、既有架构文档、效果图原样保留。Task 12 卡片改版仍排在本批修复与本机真人测试之后，本批只修复现有卡片提前停帧。

**代码与本机自动验证完成，交 Claude 复查；真人麦克风、展厅远场 / 噪声 / 真实音箱和跨机验收待测。** 用户最新回复「保持开机，准备真人测试」覆盖历史关机安排，本机服务与 Mac 保持开启。不合并、不推送、不部署生产。

## 审查问题落实

| 审查项 | 修复行为 | 验证 |
| --- | --- | --- |
| 高 1：静默卡 listening | 唤醒 / 问候 / 没听清后，实际开麦 `ready` 开始默认 5000ms；超时播缓存 `idle_exit`（warm），随后 `session.end: listen_timeout` → ambient | 单测 + 浏览器静默退出 |
| 第 4 秒说长句 | VAD `SpeechRealStart` 上报，暂停剩余时间；`VADMisfire` 恢复剩余时间；重复 ready/start 不延期。另设 16 秒人声上限，避免报告丢失后永久冻结 | 剩余时间 / 重复报告单测；浏览器第 4 秒开始 7.875 秒录音 |
| 服务端独立兜底 | 无播放 / 开麦回报时，上限为缓存 PCM 时长 + 5 秒 + 1 秒；新聆听租约也有无 ready 上限。问候 / 没听清同样受保护 | 无浏览器回报单测 |
| 噪声循环 | 连续两次没听清或语义降级播退出语；提问 429 同样退出。真实数据源 / LLM 异常沿用第一轮就播降级话术并退场的行为 | 两次没听清、限流与既有异常测试 |
| 追问 | 提示语播完、实际开麦后保留 3 秒窗口；确认人声暂停，超时静默退场 | 超过 4 秒追问浏览器用例 |
| 高 2：Esc 不同步 | screen 可发受限 `session.dismiss`，只接受当前 sessionId；任何非 ambient 状态可关闭当前会话；未接受的 HTTP wake 返回 409 | listening Esc 后 F9 新会话；非法角色 / 旧 id 单测 |
| 高 3：停止后 KWS 永久关闭 | `PcmPlayer` 的统一 `onActive/onIdle` 绑定麦克风占用；stop / error / drain / timeout / supersede 都释放，仍保留 outputLatency +300ms 延后开麦 | 单测；真实本地 KWS 在 Esc、断线、插问、超时后重新命中 |
| 卡片停在半展开 | 停 rAF 必须同时满足全文已显示与 `u >= 1` | 单句问候卡展开浏览器用例 |
| E2E 掩盖误上传 | 直接统计浏览器 POST `/voice/utterance` 请求数；长句夹具为 7.87475 秒，另补前缀用例 | 播报中请求数不增加；长追问正常提交 |
| 前缀 | 仅剥开头的 你好 / 您好 + 小川 / 小船 / 晓川；句中名字保留 | 4 个同音变体单测；您好晓川浏览器用例 |
| 会话隔离 | utterance、聆听活动带 `X-Voice-Session` 与 `X-Voice-Listen`；生产 HTTP 必须提供并匹配当前租约，旧上传在 ASR 前返回 409。CORS 预检同步放行这两项 header | HTTP 身份 / 预检、旧租约单测 |
| 没听清 / 问候 | 意图决定重新 listening，不做字符串比较；没听清后不再播追问；定时回调捕获所属 turnSeq | 单测 + 问候浏览器用例 |
| Worker 错误 | KWS Worker、AudioWorklet 异常显示 F9 / 刷新提示，VAD Promise 错误显示处理异常 | 实现检查；F9 走受鉴权 HTTP wake |
| 唤醒限流 | 独立 hub 全局唤醒账本，使用提问同一组间隔 / 窗口 / 次数配置；utterance 继续使用提问账本 | wake 429 单测。更正原报告：两类请求不共享计数 |

开麦 ready 只在麦克风 / worklet 初始化完成、音轨已启用、AudioContext running 后发送。等待权限或暂停的音频上下文不会提前吃掉 5 秒；对应边界另加单测。screen 仍不能发任意提问或 console 强制控制；新增活动接口只接受当前租约的 ready / speech_start / misfire，body 必须为空。

## 决策 J：预测性合成

ASR 之后，权威 LLM 分类与数据意图预测 TTS 并行。预测只存 AudioStore，不广播卡片或 turnId。分类一致才复用；不一致取消隐藏轮、按权威意图生成最终回答。关闭 / 顶替 / 分类 deadline 都取消隐藏合成。取消轮的延迟回调不污染最终轮指标。trace 和对话台显示 `speculative: hit | miss | none`；正式 JSONL 延迟报告也分组。

**22 轮真模型本机回环结果**：三模型常驻；macOS 合成录音注入真实浏览器 MediaStream → AudioWorklet → 本地 Silero VAD → HTTP → Qwen ASR / LM Studio Qwen 分类 / Qwen TTS → 首样本调度。使用原 q1–q8 加三个易误猜问题，各两次；首轮也计入，全部原始样本保留。22/22 drained，无浏览器错误。

| 分组 | 样本 | L1 P50 / P95（ms） | L2 P50 / P95（ms） |
| --- | --- | --- | --- |
| 全部 | 22 | **930.4 / 1229.0** | 1466.5 / 1774.4 |
| hit | 14 | 920.1 / 958.7 | 1446.9 / 1496.4 |
| miss | 6 | 1208.1 / 1253.5 | 1736.8 / 1791.9 |
| none | 2 | 1188.6 / 1194.2 | 1718.8 / 1731.0 |

本机回环整体满足 P50≤1100 / P95≤1300；miss 的样本量为 6，分组数值仅说明这组分布，不独立宣称达到 ≥20 轮验收。跨机局域网与物理音箱仍需按 v6 全局验收另测。

| 阶段 | P50 / P95（ms） | 样本 / 口径 |
| --- | --- | --- |
| ASR 服务内 | 232.5 / 266.1 | 22 |
| ASR HTTP 往返 | 235.5 / 267.9 | 22 |
| 分类 | 525.6 / 555.4 | 22；与预测 TTS 并行，不能串行相加 |
| 编排观察 TTS 首包 | 517.6 / 526.2 | 20；另 2 轮使用固定告别缓存，不产生 TTS 请求 |
| voice-local TTS 首包 | 512.3 / 520.9 | 20；包含 GPU 争用，不能当成单模型直连基准 |
| 浏览器首字节 → 首样本 | 150.2 / 150.2 | 22；保留 150ms 预缓冲 |

hit 中编排 TTS 转发通常约 5–6ms；miss 中包含取消预测与释放工作线程的等待，本组最大约 103ms。L1 起点为浏览器发起 utterance 的时刻，之前保留原 500ms 尾静音判定；L2 用注入 PCM 最后一个超过能量阈值的样本时刻估计，所以有录音阈值误差，不是物理麦克风现场测量。outputLatency 开麦保护、150ms 缓冲和静音阈值均未下调。

真实未命中记录：「张三这个月业绩怎么样」「回款最慢的客户是谁」被权威模型归为 unanswerable；「销售部最近忙不忙」两次被归为 chitchat_or_end，播放告别缓存。三者均未播误猜的数据回答；这里如实保留模型分类，没有改模型结果来凑准确率。真人复查可进一步评估后一种语义分类是否符合使用预期。

原始逐轮数据：`docs/voice-8c-task6-repair-calibration.json`。旧 `voice-8c-task6-browser-calibration.json` 保留供对照。复跑时先准备 q1–q8 与 m1–m3 的 16kHz/mono WAV，并设置本机模型 / 录音目录环境变量：

```sh
VOICE_TEST_FIXTURES=q1,q2,q3,q4,q5,q6,q7,q8,m1,m2,m3 VOICE_TEST_ROUNDS=22 \
  node --experimental-strip-types scripts/voice-input-check.mjs docs/another-calibration.json
```

## Task 10 风格与失败记录

逾期跟进改用自然单句参考 `serious`；`serious_long`、`advise` 保留可配但不默认映射。`idle_exit` 用 warm，启动预生成缓存后播放不触发 GPU 合成。没有改参考对、temperature、CER 判定或静音阈值。

本次初次启动 serious 自检失败，原服务未记录具体原因；正常重启后七种风格全部通过、CER 均为 0。两次健康快照在 `docs/voice-8c-task10-repair-startup.json`，第一条失败仍保留；另补 `/health.styleFailures` 与日志的原因 / 统计，便于下一次诊断。一次重启通过不能证明这类随机失败已消失，运行时仍由自检白名单回退 default。

F0 口径按审查澄清：default / apologetic 的**中位数**相对参考 ±15%，逐条计数只用于诊断。评测工具新增 median 字段及可配置参考 F0；复算原 15 条样本的中位数分别为 97.76 / 104.80Hz，相对 104.3Hz 均符合。不是重新采样，原风格 105 轮数据与 advise / serious_long 失败记录未覆盖。

22 轮结束时 voice-local 当前启动累计健康指标：TTS fail=0、truncated=0、regenerated=1、cancelled=6、activeJobs=0。计数包含启动固定话术缓存等请求，不能将它们当成仅这 22 个回答的逐轮统计。

## 验证与交付

- TS：**390/390**，29 个文件；Python：**17/17**。
- `tsc --noEmit`、lint、生产 build 通过。lint 忽略 Playwright 生成的 test-results / report，避免第三方 wasm 包的 trace 副本被误当源码检查。
- Chromium 全量 **22/22**；修正 ready 初始化边界后再跑相关输入 **9/9**。
- 生产 CLI 已启动真实编排并成功加载 6 条固定缓存；修复 strip-only Node 不能处理构造器参数属性的问题，ListenWindow 使用普通字段。
- 现场观察脚本连真 hub 的 3 秒冒烟通过，不足一小时，`noiseOneHourPass=null`；不作为误唤醒验收。
- `JarvisCore`、screen 基线样式、本地 KWS / VAD 资源、参考对未改；未纳入 Task 8 / 9 / 11 / 12 施工。

真人入口：根目录 `启动本机语音测试.command`。LM Studio → voice-local → 编排 → 新启动 Next 时构建当前代码 → Chrome；复用健康服务，无下载 / 卸载模型，令牌只在本机配置。源码更新后若旧服务仍在运行，请先正常停止旧服务再启动，避免复用旧进程。记录表与展厅观察命令：`docs/voice-8c-human-test.md`。先用户本人测试，再交 Claude 复查；展厅验收留在这批复审通过之后。
