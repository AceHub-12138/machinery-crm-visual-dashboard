# 8c 全本地语音栈施工任务书（交付 Codex）

- 版本：**v8** · 2026-10-08
  - v2：TTS 参考音频改为中文
  - v3：按 Codex 评审补齐 ASR、浏览器 PCM 播放、结构化答案与播报管线、断网快照、跨机部署、半双工收音、延迟口径（评审逐条回应见 §7）
  - v4：同步 Task 1–5 进度；唤醒词定为「你好，小川」，人设统一为「小川」（决策 H）；新增情绪风格参考与按场景选风格（§0.6、决策 I、Task 10）；Task 6–7 按复查遗留项与新决策重写
  - v5（2026-10-07）：Task 6/7/10 首轮审查后——新增决策 J 预测性合成（L1 达标方案）；逾期跟进风格改为 `serious`；补充 listening 超时等无人值守要求
  - v6（2026-10-07）：Task 12 答案卡按用户认可的效果图改版——核心上移、卡片分区、新增 3 张数据卡、小川播报区、受支持的追问条、分页防溢出
  - **v7（2026-10-08）：打断与播完流程改版（`~/Desktop/voice-8c-interaction-redesign.md`，已在 f1e0559 实现），决策 F 与红线 7 作废；展厅硬件已定，Task 9 补充硬件与 Windows 现场校准（§「v7 变更」）；施工顺序为打断修复批 → Task 12 → Task 11 → Task 9**

## v8 变更（2026-10-08 晚，优先级最高）

**演示已取消**，不再为参展保留冻结版本。按 8c 全局验收走完整流程：分支整理 → Task 11 → 稳定性批次 → Task 9 → §3 全局验收。

### v8-1 代码线合并
- 语音大屏仓库只保留一条代码线：`codex/voice-8c-task12` 合并回本地 `main`（`a433bad` 之后共 20 个提交）。**只合并到本地 main，暂不推送 GitHub。**
- 分支和 tag 保留不删：`codex/voice-8c-task6-7-10`、`codex/voice-8c-barge-fix`、`codex/voice-8c-task12`、`demo-2026-10-09`。
- 之后每批开发从 `main` 拉新分支，完成后按同样方式合回本地 main。
- 各目录遗留的本机配置文件（`.env.local`）不要提交进仓库。

### v8-2 Task 11 之前要做的平台改动（**先于 Task 11 施工**）
平台仓库 `machinery-crm` 的公开大屏接口 `GET /api/screen/sales/[publicId]` 需要补一个**全量按省份汇总**字段，用来解决区域卡「其他 N 省 · X 台」与副标题口径不一致的问题（现 `ROUTE_SAMPLE_LIMIT=80` 只给样本）：

1. 在 `src/modules/screen/display-payload.ts` 的 `summary` 里新增 `regionUnits`：按 `province` 聚合的 `[{ province, shipmentCount, unitCount }]`，**全量计算、不截断**，按 `unitCount` 降序；`unitCount` 同样乘 `multipliers.shipmentCount`。
2. 同步 `PublicSalesScreenPayload` 类型与白名单校验。
3. 先确认平台数据库里发给同一省份的车次与台数在各行之间是否可能重复计数；如果重复，要按合同或发运单号去重，并在字段注释里写明口径。**这一条不确定就停下来问 Claude，不要自己猜。**
4. 隐私：只输出省份名和计数（省份名本来就在 `routes.province` 里公开），不得新增客户、联系人、地址、合同号。
5. 补测试：`regionUnits` 全量求和等于 `summary.unitCount`；省份数等于 `summary.regionCount`；超过 80 条路线时样本截断不影响 `regionUnits`。
6. 这是生产平台代码，改完要跑平台侧测试和构建，**部署由用户决定**，施工方不自行部署。

### v8-3 Task 11 追加项
除 Task 11 原有内容，一并处理：
1. 区域卡改用 `summary.regionUnits` 取 TOP5 和「其他」，样本 `routes` 只用于地图落点。大屏与语音用同一份口径。
2. 发运清单翻页：播报结束后停在当前页，不要跳回第 1 页；打断暂停期间暂停翻页；有句级播放边界时按句同步，否则按 4s 翻页，并保证第 3 页有机会出现。
3. 完成率上限：协议 1000% 的上限与平台不封顶的口径冲突，超限时卡片会被丢弃、界面停在思考中直到 8 秒超时。改为显示「>999%」，不丢卡。
4. `services/voice-local/core.py` 的 `guarded_audio`：首块静音重试从 `range(2)` 改为 `range(3)`，确认首包延迟门槛不受影响，并补「连续两次静音、第三次成功」的单测。
5. `task12.test.ts` 的追问断言改为断言具体意图，不要只断言「不是 unanswerable」。
6. **启动自检的静音重试**：`server.py` 的 `initialize()` 里每个风格只自检一次，首块静音就永久 `failedStyles`，该风格一直回落到 `default`，直到人工重启。2026-10-08 起服务实测 warm 因此掉线一次（`rejectedFirstPeak=0.00067`，门槛 0.001）。要求：自检同样按第 4 条改成最多 3 次重试，仍失败才记 `failedStyles`；并在 `/health` 增加 `styleAttempts` 便于诊断。

### v8-4 稳定性批次（Task 11 之后、Task 9 之前）
1. voice-local P3 五项：`server.py:246` 提交失败释放名额、已生成 PCM 块先发再跑检查点、`gpu_queue.py` 捕获范围改为 `Exception`、补测准备阶段（参考编码 / 解码 / synchronize）的 ASR 排队、补 HTTP 层并发与断连测试。
2. 打断判定补强：1–2 个字的 ASR 文本容易误判为回声，增加固定打断词表（如「停」「等一下」「打住」）直接判为接受；浏览器端 `pendingAttempt` 目前只靠 `barge.result` 清除，补一条兜底。
3. 高负载打断延迟：并行浏览器回归时末音→新首音 P95 曾为 1.618s，超过 1.5s 门槛。复测并定位，达标后补记录。
4. **闲聊过滤（用户 2026-10-08 定：排入本批）**：意图分类新增一类「不是对小川说的话」，识别到就静默忽略、继续保持聆听窗口，不计入 `failures`、不占提问额度、不播任何话术。要求先出规格（提示词、负样本集、与 `unheard` 的边界），再施工；负样本集至少覆盖：旁人对话、电话通话、自言自语、与同事讨论机床/订单/价格。

## v7 变更（2026-10-08，优先于下文冲突条目）

1. **决策 3 / 决策 F / 红线 7 作废**，改为**说话即打断**：答案、唤醒应答、追问语、没听清、退出语都可以打断；告别语和降级话术不可打断。打断按两段确认：先让声，再暂停，ASR 判为有效才换题。播完立即开麦，进入 8 秒长窗，静默则播追问语，再进入 5 秒短窗，仍然静默则 idle_exit 退场。完整规格见 `~/Desktop/voice-8c-interaction-redesign.md`，修复意见见 `~/Desktop/voice-8c-barge-review.md`。
2. **「热情」风格**参考音频降了 2 半音（参考 152→135Hz，合成 137→120Hz，12/12 可懂）。原版备份在 `~/voxlab/ref/styles_v1_backup/`。决策 5 中「音调偏高」的说法作废。
3. **展厅硬件（用户 10-07 定）**：Windows 笔记本放在大屏旁，声音经 HDMI 由**大屏自带喇叭**播放；麦克风用**心形指向 USB 麦**，落地支架放在屏前约 0.5m、高 1.2–1.5m、背对大屏，地面贴站位标识（离麦 1–1.5m）。主要场景是介绍系统，机床偶尔运转。
4. **Task 9 追加**（与原 1–6 项同批）：
   7. **麦克风设备选择**：新增 `VOICE_MIC_DEVICE`（按设备名子串匹配 `enumerateDevices`），匹配失败用默认设备，并在页面提示。`getUserMedia` 带 `deviceId`。
   8. **尾音保护额外延迟**改为可配置（`VOICE_MIC_REOPEN_DELAY_MS` 已有，确认接到 barge 尾音期）。在现场按大屏喇叭实测校准：播一段带结尾的音频，测麦克风收到的尾音持续多久。
   9. **HDMI 首字吞音**：实测大屏喇叭在静默 10s、60s、5min 后首次出声，第一个字是否被吞。如果会吞，加可选的 `VOICE_AUDIO_KEEPALIVE=1`：ambient 期间持续输出 -60dBFS 以下的低频噪声，保持 HDMI 音频通道唤醒；同时记录对 KWS 和 AEC 是否有影响。
   10. **Windows 现场 Step 0**：在展厅笔记本 + 大屏喇叭 + 正式 USB 麦（按上面摆位）重做回声三组测试（无人声 10 次、关 AEC 对照、真人 5 次），按结果调整 `VOICE_BARGE_*` 阈值。门槛与 Mac 相同。
   11. 运维提示写进部署文档：Windows「声音 → 通信」设为「不执行任何操作」、关闭音频增强、正式麦设为默认录音设备；大屏声音模式设为标准或人声，关闭环绕、自动音量和动态 EQ。
   12. Task 9 验收追加：在展厅摆位下完整跑一遍演示流程（`~/Desktop/明日演示流程-小川语音.md` 第三节），打断 ≥ 4/5 成功，10 个答案无人说话时 0 次自我打断。
- 前置：8a 视觉壳 ✓、8b 数据通路 ✓（`?voiceDemo=1` / `?voiceLive=1` + `/voice-console` 均已跑通）
- 目标：唤醒 → 收音 → 识别 → 选卡 → 代码生成播报 → 本地克隆音色播放 → 大屏卡片与粒子同步。**ASR / LLM / TTS 全部在本机运行，不调用任何第三方云 API。**
- 已定的产品决策（用户 2026-10-06 确认）：
  1. **大屏网页在另一台电脑上打开**（局域网访问运行语音服务的 Mac）
  2. **断网时用最后一次成功的数据快照**回答，并说明数据时间
  3. **第一版不支持打断**：播报期间麦克风不收音
- 已定的产品决策（用户 2026-10-07 确认）：
  4. **语音助手名字为「小川」，唤醒词为「你好，小川」**。项目文档里的「贾维斯 / JARVIS」只是视觉与气质参照，不是产品名
  5. **情绪风格全部保留**：默认、热情、歉意、温暖、严肃、严肃长、建议。「热情」音调偏高、情绪控制弱于 ElevenLabs v4，用户试听后接受

> 读法：每个任务给出「现状 → 要做什么 → 验收」。改动点带 `file:line`（基于仓库初始快照 `a433bad`，施工前请核对）。**不要扩大改动范围。**

## 施工进度（截至 2026-10-07）

| 任务 | 状态 | 分支 / 提交 | 交付与审查记录 |
| --- | --- | --- | --- |
| Task 1–2 结构化选卡、代码生成播报 | ✅ 通过 | `codex/voice-8c-intent-spoken` · `f677852` | `docs/voice-8c-stage12-result.md` |
| Task 3–4 voice-local、音频接口、流式兜底 | ✅ 通过 | `codex/voice-8c-local-audio` · `4cb1433` → 修复 `ea888fb` | `docs/voice-8c-stage34-result.md`、`docs/voice-8c-task14-repair-result.md` |
| Task 5 浏览器 PCM 播放与播完同步 | ✅ 通过 | `codex/voice-8c-task5-playback` · `232bc85` → 修复 `80a1c9e` | `docs/voice-8c-task5-result.md`、`docs/voice-8c-task5-repair-result.md` |
| **Task 6 / 7 / 10** | ⚠ 首轮审查不通过，修复中 | `codex/voice-8c-task6-7-10` · `ea6ffee` | `docs/voice-8c-task6-7-10-result.md`；审查意见 `voice-8c-task6-7-10-review.md`（3 个高优先级 + L1 未达标） |
| Task 8 库存 | ⏸ 待业务确认公开范围 | — | §6 |
| Task 12 答案卡改版与溢出修复 | 排队（6/7/10 修复与本机真人测试后，先于 Task 11）；设计方向已定 | — | 本文 Task 12、`docs/design/answer-card-mockups/` |
| Task 11 接入平台真实数据 | 排队（Task 12 之后） | — | 本文 Task 11 |
| Task 9 跨机部署 | 排队（Task 11 之后） | — | — |

Claude 审查意见原文在用户桌面：`voice-8c-task1-4-review.md` / `-recheck.md`、`voice-8c-task5-review.md` / `-recheck.md`。

**截至 Task 5 的真模型实测**（文字提问，未含收音）：分类 P50 约 475ms；编排侧 TTS 首包 P50 约 370–380ms；提问 → 浏览器首音回报 P50 约 **1.03s**；9/9 轮完整播完、块间排程间隙 0ms。

---

## 0 环境事实（已实测，勿重复踩坑）

所有数字在运行语音服务的 Mac 上测得：M1 Ultra / 64GB，LLM + ASR + TTS 三个模型同时常驻内存。

### 0.1 本地 LLM = LM Studio

| 项 | 值 |
| --- | --- |
| 服务地址 | `http://127.0.0.1:1234/v1`（OpenAI 兼容） |
| 模型 id | `qwen/qwen3.6-35b-a3b`（MLX 4bit，约 20GB） |
| 启动 | `lms server start` + `lms load qwen/qwen3.6-35b-a3b -c 8192 --gpu max -y` |

**⚠️ 思考模式**：该模型默认开 reasoning，输出全进 `reasoning_content`，`content` 为空。**只有顶层 `reasoning_effort: "none"` 有效**；`enable_thinking:false`、`/no_think`、`chat_template_kwargs` 均无效。

**结构化选卡（v3 采用的调用方式）实测**：`response_format: {type:"json_schema", json_schema:{strict:true, schema:{intent: enum[...]}}}` + `reasoning_effort:"none"` + `temperature:0`，系统提示里只放意图定义，**不放业务数据**：

| 指标 | 实测（13 条，含口语改写） |
| --- | --- |
| 准确率 | **13/13**（如「这个月卖得咋样」「钱收回来多少了」「有没有什么料快不够了」「利润是多少→unanswerable」「好的谢谢没有了→chitchat_or_end」） |
| 耗时 | 中位 **405ms**，最慢 559ms（完整 JSON 返回） |

### 0.2 本地 TTS = Qwen3-TTS 1.7B（克隆模式，mlx-audio）

| 项 | 值 |
| --- | --- |
| 环境 | `~/voxlab/.venv`：Python 3.12 + mlx-audio 0.5.8 + fastapi/uvicorn，**纯 MLX，无 torch** |
| 模型 | `~/voxlab/models/qwen3-tts-1.7b-base`（Apache 2.0） |

**⚠️ 坑 1**：LM Studio 下载的那份 Qwen3-TTS 缺 `speech_tokenizer/`，不能克隆；LM Studio 也**不提供** TTS 接口（未知路径返回 200 + 错误体）。用 `~/voxlab/models/qwen3-tts-1.7b-base/`。

> ### ⚠️ 坑 2（最严重）：参考音频必须是中文，`ref_text` 必须与音频逐字一致
>
> 用户两段 ElevenLabs 音频同一音色：`m2` 英文，`v3` 中文。误用英文音频配中文文本时，**音色很像但中文一句都说不全**。实测（5 句 × 3 次，Whisper 转写算 CER）：
>
> | 参考音频 | 可懂（CER≤10%） | 音色一致（F0 ±15%） | 静音/失控 |
> | --- | --- | --- | --- |
> | 英文音频 + 中文文本（错配） | 约 0/15 | — | 频繁 |
> | 英文音频 + 英文文本（跨语言） | 4/15 | 12/15 | 0/15 |
> | **中文音频 + 中文汉字文本（定稿）** | **15/15** | **14/15** | **0/15** |
>
> 症状识别：**音色对但话说不清 → 先查参考音频语言与 `ref_text` 是否逐字对应。**

**定稿参考（成对，勿拆开修改）**：

- `ref_audio`：`~/voxlab/ref/ref_zh_9s.wav`（v3 原文件 5.70→14.55s，8.85s）
- `ref_text`：`先生,本月销售额一点二四亿元,完成月度目标的百分之八十二,距离目标还差两千七百一十六万元。`

**模型调用要点**（在 voice-local 服务内部实现，见 Task 3）：

- `lang_code="Chinese"` 必须显式传（mlx-audio 各入口默认值不是中文）。
- `temperature=0.6`：0.9 时音色上漂到 122–132Hz（目标 104Hz）。
- 克隆模式**忽略** `speed` / `pitch` / `instruct`；`repetition_penalty` 在源码中被强制为 `max(x, 1.5)`，不必传。
- 流式：`stream=True, streaming_interval=0.5`，每片约 0.5s 音频；输出转 **int16 LE / 24000Hz / 单声道** 裸 PCM。

**实测性能**：

| 指标 | 实测 |
| --- | --- |
| 可懂度 | 15/15 |
| 音色 | F0 中位 98.8Hz（目标 104.3Hz），14/15 落在 ±15% |
| 稳定性 | 定稿配置下 65 次合成 **0 次静音/失控** |
| 首包（热） | **0.29–0.33s，与句长无关** |
| 首包（冷，进程启动后第一次） | **4.14s** → 必须启动预热 |
| RTF | 0.46–0.64（合成快于播放） |
| 语速 | 约 0.20–0.28 秒/字（用于失控封顶，见 Task 4） |

### 0.3 本地 ASR = Qwen3-ASR 0.6B（mlx-audio）+ 热词

同一组 10 条展厅提问（macOS 中文语音合成的近讲干声；**展厅远场真人准确率须现场测**）：

| 模型 | 识别耗时（中位 / 最慢） | 全对 |
| --- | --- | --- |
| Whisper large-v3-turbo | 277 / 308ms | 9/10（「待办」→「代板」） |
| Qwen3-ASR-0.6B | 118 / 154ms | 9/10（「待办」→「代办」） |
| **Qwen3-ASR-0.6B + 热词** | **134 / 141ms** | **10/10** |
| SenseVoice-Small（mlx） | 27ms | 输出为 token 编号，本地包缺解码词表，未采用 |

- 模型：`~/voxlab/models/qwen3-asr-0.6b`（`mlx-community/Qwen3-ASR-0.6B-bf16`）
- 热词（可配置）：`回款、跟进待办、成品仓、原材料仓、半成品仓、物料、库存预警、发货、完成率、合同额`
- **mlx_audio.server 的识别接口不能传热词**，这是改用自建 voice-local 服务的原因之一。

### 0.4 整链路实测（服务侧）

原型 `~/voxlab/voice_local.py`（ASR+TTS 同进程）+ LM Studio，10 条提问 × 2 轮，计时从「一句话的录音完整交给 ASR」开始，到「TTS 返回第一个 0.1s 音频」结束：

| 阶段 | P50 | P95 |
| --- | --- | --- |
| ASR | 187ms | 204ms |
| 选卡（LLM 结构化输出） | 451ms | 480ms |
| TTS 首包 | 312ms | 327ms |
| **合计** | **962ms** | **985ms** |

20 轮全部识别正确、选卡正确。**未包含**：VAD 判定说完所需的尾部静音、局域网上传、浏览器播放缓冲（见决策 G）。

### 0.5 部署拓扑（已定：大屏在另一台电脑）

```
┌──────────── 大屏电脑（Chrome kiosk） ────────────┐        ┌────────────────── 语音 Mac ──────────────────┐
│ /screen/sales?voiceLive=1                         │        │ HTTPS 反向代理（单一源，唯一对外端口 443）   │
│  ├ 麦克风 → VAD（+唤醒词）→ 上传一句话 PCM ───────┼─HTTPS─▶│  /            → Next.js 大屏    127.0.0.1:3015│
│  ├ WS 订阅状态/卡片 ◀─────────────────────────────┼─WSS───▶│  /hub         → 编排服务 WS     127.0.0.1:3210│
│  └ 拉取每句 PCM → Web Audio 播放 + 振幅驱动粒子 ◀─┼─HTTPS──│  /voice/*     → 编排服务 HTTP   127.0.0.1:3210│
└───────────────────────────────────────────────────┘        │ 编排服务 ──▶ voice-local（ASR+TTS）127.0.0.1:8810│
                                                              │          ──▶ LM Studio              127.0.0.1:1234│
                                                              │          ──▶ 平台 payload（阿里云，带本地快照缓存）│
                                                              └───────────────────────────────────────────────┘
```

- **为什么必须 HTTPS**：浏览器只在 `localhost` 或 HTTPS 页面上允许 `getUserMedia`；HTTPS 页面里 WS/HTTP 也必须是 WSS/HTTPS（混合内容会被拦）。
- **为什么单一源**：页面、WS、音频接口同源，不需要 CORS，Origin 白名单只需一项。
- 除反向代理外，所有服务只绑 `127.0.0.1`。

---

### 0.6 情绪风格参考（v4 新增，已实测）

用户用同一 ElevenLabs 音色另外生成了 4 段**纯中文**、带情绪的音频，切成以下风格。每个风格的参考音频与文本逐字对应，**成对使用、不可拆开**。文件位于 `~/voxlab/ref/styles_v1/<id>.wav` + `<id>.txt`（ASCII 文件名，供服务配置；中文名版本在 `~/voxlab/ref/styles/`）。

| id | 中文名 | 参考文本 | 时长 |
| --- | --- | --- | --- |
| `default` | 默认 | 先生,本月销售额一点二四亿元,完成月度目标的百分之八十二,距离目标还差两千七百一十六万元。 | 8.85s |
| `cheerful` | 热情 | 你好先生,很高兴为您服务。请问有什么可以帮您的? | 4.00s |
| `apologetic` | 歉意 | 非常抱歉,先生。这个问题我暂时还回答不了您。 | 4.05s |
| `warm` | 温暖 | 为您服务是我的荣幸。我们下次再见。 | 3.30s |
| `serious` | 严肃 | 先生,目前我们距离本月目标还差一千两百万元。 | 4.70s |
| `serious_long` | 严肃长 | 先生,目前我们距离本月目标还差一千两百万元。这些产品已经接近预警线,请您尽快联系采购人员进行补充。 | 10.10s |
| `advise` | 建议 | 待跟进商机二十三个,建议您优先关注三家连续两周无进展的客户。 | 5.90s |

`serious_long` 由原音频第 1、3 句拼接（中间 0.45s 静音）。原音频第 2 句含「丝杠」「BK5030」等型号，两个识别模型读法不一致，未用作参考。

**评测**（`~/voxlab/eval_styles.py`；每风格同 5 句 × 3 次，temperature 0.6）：

| 风格 | 可懂（CER≤10%） | 音色一致（F0 ±15%） | 失败 | F0 中位 | 音高起伏 | 语速 |
| --- | --- | --- | --- | --- | --- | --- |
| default | 15/15 | 15/15 | 0 | 94.9Hz | 9.8 半音 | 0.195 秒/字 |
| cheerful | 15/15 | **1/15** | 0 | 138.7Hz | 14.8 半音 | 0.179 秒/字 |
| apologetic | 15/15 | 15/15 | 0 | 103.0Hz | 11.2 半音 | 0.196 秒/字 |
| warm | 15/15 | 13/15 | 0 | 110.1Hz | 13.6 半音 | 0.207 秒/字 |
| serious | 15/15 | 10/15 | 0 | 107.6Hz | 14.6 半音 | 0.202 秒/字 |
| serious_long | 15/15 | 12/15 | 0 | 105.7Hz | 14.6 半音 | 0.192 秒/字 |

- 情绪确实被带上：各情绪风格的音高起伏 11–15 半音，默认 9.8。
- `cheerful` 音调上扬（参考原声本身 152Hz），超出「音色一致」区间；**用户已试听接受**。因此「F0 ±15%」验收只适用于 `default` / `apologetic`，其他风格以可懂度与人工试听为准。
- `advise` 未进入本轮评测，Task 10 自检时补测。

## 1 架构决策（必读）

### 决策 A：热路径零工具轮

8b 主路径已是零工具轮（`orchestrator.ts:311-319`）。v3 进一步：**LLM 只做意图分类，不接收业务快照**——延迟更低，也不再把经营数据送进模型。

### 决策 B：模型只选卡，数字与播报全部由代码生成（v3 重写）

**问题**：让模型自由写播报会算错数（实测把 1240+386+512 算成 3138）。`sanitizeAnswer` 的子串匹配（`inject-context.ts:122`）只能事后整句降级，且会侥幸放行。

> 更正：v1/v2 把这个例子的「正确答案」写成 2138 件，是错的——原材料、半成品单位是「件」，成品单位是「台」，**不同单位不能相加**（Codex 评审指出）。正确做法是分单位、分仓播报，详见 Task 8。

**v3 管线**：

```
ASR 文本 ──▶ LLM 结构化输出 {intent}（JSON Schema 枚举约束，~0.45s）
        ──▶ 校验 intent ∈ 枚举；不合法 → unanswerable
        ──▶ card-builders 用快照构造卡片（含 card.spoken，已是代码模板，card-builders.ts:47,71,122,155）
        ──▶ 读法归一化（显示文本 → 汉字读法，纯函数）
        ──▶ 按句号切句 ──▶ 逐句 TTS ──▶ 浏览器顺序播放
```

- **不再做「模型流式文本边出边切句」**（v2 Task 3 第 4 条作废）：结构化 JSON 很短，等它完整返回再生成播报，实测比让模型写完整回答更快（0.45s vs 0.6–1.2s）。
- 首期 **intent 不带 slots**。将来需要参数（如省份、仓库名）时，slot 只能取**快照中实际存在的枚举值**，由代码校验，不接受自由文本。
- `sanitizeAnswer` 降为备份护栏：对最终播报文本仍执行一次，正常情况下不应触发；触发即记 trace 告警（说明模板或归一化有 bug）。

### 决策 C：音频走 HTTP，按句拉取，不走 WS

`ws-server.ts:312-313` 拒绝二进制帧，不改。每轮回答的每一句是一个独立的音频资源：`GET /voice/audio/:turnId/:index`，固定话术 `GET /voice/audio/fixed/:key`。WS 只传状态与「这一轮有哪几句」的元数据（Task 5）。

### 决策 D：参考对成对配置 + 启动自检（v3 加强）

1. `VOICE_TTS_REF_AUDIO` / `VOICE_TTS_REF_TEXT` 成对配置。
2. **启动自检 = 预热 + 回环校验**：voice-local 启动时合成「我在,先生。请讲。」，再用同进程的 ASR 识别回来，计算 CER。CER > 20% 或静音 → `/health` 报 `selfCheck: failed`，编排服务据此关闭语音播报（大屏照常出卡片）并告警。这能抓住「参考语言错配」这一类问题。
3. 自检**不能**证明音色好、读法自然：**更换参考对后必须重跑 `~/voxlab/eval_ref.py` 并人工试听**。
4. 固定话术缓存的 key = `sha256(模型 id + 参考音频字节 + ref_text + temperature + 文本)`，参考对或参数一变自动失效重建。

### 决策 E：数据快照本地缓存（断网策略，用户已定）

- 编排服务**后台每 60s 拉一次** payload（与大屏轮询同节拍），成功即写本地文件（含 `generatedAt`）。提问时直接用内存中的最新快照，**提问路径上不再发起网络请求**。
- 拉取失败时继续使用上一份快照：
  - 快照年龄 > `VOICE_SNAPSHOT_STALE_MS`（默认 10 分钟）：播报首句前加「先生,以下是 HH 点 mm 分的数据。」，答案卡显示「数据更新于 HH:mm」。
  - 快照年龄 > `VOICE_SNAPSHOT_MAX_AGE_MS`（默认 24 小时）或从未成功拉取：走降级话术。
- 快照文件只存公开 payload 白名单字段（与大屏同口径），存放在 gitignored 目录。

### 决策 F：半双工收音（用户已定：第一版不支持打断）

| 状态 | 麦克风 |
| --- | --- |
| ambient | 只跑唤醒词检测（Task 7 之前：不收音，靠对话台 / F9 唤醒） |
| waking | 关（播放「我在」） |
| listening | VAD 收一句话 |
| thinking / answering / closing | **关** |
| followup（3s） | VAD 开；检测到说话即进入 listening，无需唤醒词 |

- 播放队列**真正播完**（见 Task 5「播完」定义）后再等 `VOICE_MIC_REOPEN_DELAY_MS`（默认 300ms）才开麦，避免收进音箱余音。
- 识别结果为空或少于 2 个字：播固定话术「抱歉先生,我没有听清。」，回到 followup。

### 决策 G：延迟口径与目标（v3 明确）

| 代号 | 起点 | 终点 | 目标 |
| --- | --- | --- | --- |
| **L1** | VAD 判定一句话结束 | 首个音频样本开始播放（Web Audio 调度时刻） | **P50 ≤ 1.1s，P95 ≤ 1.3s** |
| L2 | 用户最后一个字（= L1 起点 − VAD 尾部静音） | 同上 | 记录并报告；默认尾部静音 500ms 时约 P95 ≤ 1.8s |

- L1 预算：服务侧实测 0.96/0.99s（§0.4）+ 局域网上传与转发约 0.05s + 浏览器预缓冲 0.15s。
- v2 写的「说完话 → 首音 ≤1.5s」**口径不清且偏乐观**：若从最后一个字算起，要达到 1.5s 需把 VAD 尾部静音压到约 300ms，容易截断用户的话。尾部静音做成可配置（`VOICE_VAD_HANGOVER_MS`，建议 400–600），展厅实测再定。
- 所有延迟报告给 **P50 与 P95**，样本 ≥ 20 轮，三个模型同时常驻的条件下测。
- 进一步压缩的备选（本期不做）：选卡改用更小的本地模型。

### 决策 H：人设与命名统一为「小川」（v4，用户已定）

- 用户可见的一切（语音、屏幕文字、卡片标题、提示语、对话台界面）只出现「小川」，**不出现「贾维斯 / Jarvis / JARVIS」**。称呼用户「先生」不变。
- 「贾维斯」只是视觉风格与声音气质的参照。现有内部标识符与文件名（`JarvisCore.tsx`、`docs/jarvis-voice-mode-plan.md`、代码注释）**不改名**，避免无意义改动；`JarvisCore.tsx` 零改动的红线不变。
- 唤醒词：**「你好，小川」**（4 音节，比 2 音节「小川」误唤醒更少）。识别结果中带出的唤醒词前缀要从问题文本中剥除（Task 6）。
- 注意公司名「大川机床」与「小川」同字：唤醒词负样本测试必须包含「大川」相关说法（Task 7）。

### 决策 I：情绪风格按场景选择（v4）

- **一轮回答使用一个风格**（不按句切换），由代码按意图和数据决定，**不由 LLM 决定**（与决策 B 一致：模型只输出意图）。
- 映射表集中定义一处（建议 `src/lib/voice/speech-style.ts`），可通过配置覆盖；首版：

| 场景 | 风格 |
| --- | --- |
| 唤醒应答「我在,先生。请讲。」、问候 | `cheerful` |
| 唤醒后无人说话的退出语「有事您再叫我,先生。」 | `warm` |
| 销售 / 完成率 / 回款类，且**已超额完成** | `cheerful` |
| 其他数据回答（含未完成目标） | `default` |
| 逾期跟进 > 0、库存预警（Task 8） | `serious`（v5：原 `serious_long` 为人工拼接参考，评测出现失败，改为不映射） |
| 答不上来（降级）、没听清 | `apologetic` |
| 追问「还有其他问题需要我帮您处理吗?」、告别 | `warm` |
| `advise`、`serious_long` | 不映射，保留可配 |

- 「未完成目标」用 `default` 而非严肃：月中未完成是常态，用严肃语气会显得报忧。
- 风格不可用（自检失败或未配置）时回落 `default`，记日志，不影响播报。

### 决策 J：预测性合成（v5，L1 达标方案）

Task 6 首轮实测 L1 P50 1230 / P95 1330ms（ASR 222 + 分类 481 + TTS 首包 362 + 预缓冲 150，串行）。本机实验：分类与 TTS 同时运行时分类 +63ms、TTS 首包 +106ms，但关键路径 P50 1029 → 682ms，净省约 350ms。

- ASR 文本出来后**同时**发起 LLM 分类，并用 `classifyScriptedQuestion` 猜意图；猜到数据意图则立即构造答案并**开始合成**（只进 `AudioStore` 缓冲，不广播卡片）。
- LLM 返回：一致 → 广播卡片与 `speech`（音频已在缓冲）；不一致 → 取消预测轮，按 LLM 意图正常走。
- **最终意图永远由 LLM 决定**；浏览器在卡片广播前拿不到 turnId，猜错不可能播出错误内容。关键词路由直接作答已否决（24 句中 3 句会答错）。
- trace 记 `speculative: hit | miss | none`，L1 报告分开统计。

### 决策 K：无人值守必须自愈（v5）

展厅无人值守，任何状态都不能等人工重启：
- **唤醒后 5 秒没人说话**（从唤醒应答播完、麦克风打开时起算；确认人声开口即暂停计时）→ 说「有事您再叫我,先生。」（固定话术 `idle_exit`，`warm` 风格）→ 退场回大屏常态界面（用户 2026-10-07 定）。问候后、没听清后重新聆听同样适用；追问窗口仍为 3 秒静默退场。服务端自带上限兜底，配置 `VOICE_LISTEN_TIMEOUT_MS`（默认 5000）；
- 连续 2 次「没听清」或降级即告别退场；
- 浏览器任何非 ambient 状态下 Esc 都通知服务端；`/voice/wake` 未被接受返回 409；
- 播放器任何停止路径都释放麦克风占用。

---

## 2 施工任务

与 Codex 评审中的阶段划分对应：阶段 2 = Task 1–2 ✅；阶段 3 = Task 3–4 ✅；阶段 4 = Task 5 ✅；**阶段 5 = Task 6–7 + Task 10（本批）**，Task 9 部署随后；阶段 6 = Task 8。

### Task 1：本地 LLM 结构化选卡

**状态：✅ 已完成并通过复查**（见文首「施工进度」）。下文保留为施工规格原文。

**现状**：`llm/zhipu.ts:26` 的 `OpenAiCompatibleAdapter` 是通用 OpenAI 兼容客户端，只有流式 `stream()`；`config.ts:88-91` 已有 `VOICE_LLM_BASE_URL/API_KEY/MODEL`。

**要做**：

1. `config.ts` 增加 `llmReasoningEffort`（`VOICE_LLM_REASONING_EFFORT`，默认 `"none"`），请求体透传顶层 `reasoning_effort`。
2. `LlmAdapter` 增加非流式方法 `classify(question, signal) → Intent`：
   - 请求体带 `response_format.json_schema`（strict，`intent` 为枚举），`temperature: 0`，`max_tokens: 40`；
   - 系统提示只含意图定义（参考 `~/voxlab/intent_bench.py` 的 `SYSTEM`），**不含快照**；
   - 返回值必须 `JSON.parse` 后校验在枚举内，否则视为 `unanswerable`；
   - 若响应只有 `reasoning_content` 无 `content`，错误信息需注明「模型处于思考模式，检查 reasoning_effort」。
3. 意图枚举集中定义一处（建议 `src/lib/voice/intents.ts`），编排服务与测试共用：
   `sales_progress, target_rate, region_shipments, upcoming_shipments, new_customers, followup_todo, collection, unanswerable, chitchat_or_end`（Task 8 再加 `inventory_overview, inventory_alerts`）。
4. `ScriptedAdapter` 实现同一 `classify()`：由现有 `routeQuestion`（`scripted.ts:33-94`）映射到意图，保证无 LLM 时仍可离线演示。
5. `.env.example` 补本地 LLM 示例。

**验收**：
- `/voice-console` 8 条问题 + `intent_bench.py` 的 13 条改写全部选对；
- 选卡耗时 P50 ≤ 500ms（对照 §0.1）；
- 不设 `VOICE_LLM_API_KEY` 时回落 scripted，现有测试全绿。

---

### Task 2：代码生成播报 + 读法归一化

**状态：✅ 已完成并通过复查**（见文首「施工进度」）。下文保留为施工规格原文。

**现状**：`card-builders.ts` 已用 `formatMoney` 等构造卡片和 `spoken` 模板；`orchestrator.ts:386-399` 目前取 LLM 流式文本作为播报，再过 `sanitizeAnswer`。

**要做**：

1. 编排主路径改为：`classify()` → 意图映射到 card builder → **以 `card.spoken` 为播报文本**（不再使用 LLM 生成的文本）。`chitchat_or_end` → 告别话术并 `closing`；`unanswerable` → 降级话术。
2. 检查并补齐每个模板的 `spoken`：≤3 句、先结论后数字、称呼「先生」。
3. 新增读法归一化纯函数 `src/lib/voice/spoken-normalize.ts`：显示文本 → TTS 读法。必须覆盖并单测（表驱动）：

   | 显示 | 读法 |
   | --- | --- |
   | `¥1,286.0万` | `一千二百八十六万元` |
   | `1.24亿元` | `一点二四亿元` |
   | `110.2%` | `百分之一百一十点二` |
   | `386台` / `12项` | `三百八十六台` / `十二项` |
   | `2026-10-06` | `十月六日`（日期按需求定，至少不能读成数字串） |
   | `-3.5%` | `负百分之三点五` |

   规则与 `src/lib/format.ts` 的格式一一对应；屏幕卡片仍显示数字形态。
4. `sanitizeAnswer` 改为对**归一化前的播报文本**做备份校验；数字提取改为 token 边界匹配（`(?<![\d.])\d+(?:\.\d+)?(?![\d.])`），触发时记 trace 告警而不是静默替换。
5. 切句：按 `。！？` 切，生成 `sentences: {index, text(显示), spokenText(读法), displayStart, displayEnd}[]`，供 Task 3/5 使用。

**验收**：
- 8 条问题的播报文本与卡片数字逐字同源（diff 测试）；
- 防幻觉用例（#8 华南退货率、「利润是多少」）走降级；
- 归一化单测全绿；任何路径下 LLM 输出的文字都不进入播报。

---

### Task 3：voice-local 服务（ASR + TTS）与编排服务音频接口

**状态：✅ 已完成并通过复查**（见文首「施工进度」）。下文保留为施工规格原文。

**3a. voice-local（新建 Python 服务，建议 `services/voice-local/`）**

参考原型 `~/voxlab/voice_local.py`（已实测可用），正式实现需补齐：

| 接口 | 说明 |
| --- | --- |
| `POST /asr` | body = 16kHz 单声道 int16 PCM（或同规格 WAV）；≤15s；返回 `{text, ms}`；带热词 |
| `POST /tts` | `{text, style?}` → 流式 `audio/pcm`（int16 LE / 24kHz / mono），响应头标注采样格式 |
| `GET /health` | `{warm, selfCheck, models, refHash, styles}` |

- 启动：加载两个模型 → 预热 → 回环自检（决策 D）。
- GPU 任务串行（进程内锁）；单展厅场景足够。
- 只绑 `127.0.0.1`；参考对、热词、模型路径走环境变量。
- 客户端断开（编排服务 abort）时停止生成，释放锁。
- 提供启动脚本与 `requirements.txt`（锁定 mlx-audio 0.5.8 等版本）。

**3b. 编排服务侧**

1. `services/voice-orchestrator/src/tts/`：`VoiceLocalClient`，封装 `/asr`、`/tts`、`/health`；`/tts` 读流时**处理奇数字节**（int16 采样可能跨块）。
2. **每轮音频任务**：意图确定、句子生成后，编排服务**立即**按顺序为每句发起合成并在内存中缓冲；浏览器 `GET /voice/audio/:turnId/:index` 时，先吐已缓冲部分，再接续实时部分。新问题顶替旧轮 / 强制退场时，abort 全部合成并让对应 GET 返回 410。
3. **固定话术缓存**：唤醒「我在,先生。请讲。」、追问、告别、降级、「抱歉先生,我没有听清。」，启动时合成存盘（key 见决策 D），`GET /voice/audio/fixed/:key` 直接读文件。
4. HTTP 路由挂在编排服务现有的 HTTP server 上（`ws-server.ts` 已有 `GET /` 探活），路径前缀 `/voice/`。
5. **鉴权**：`/voice/*` 全部要求 `Authorization: Bearer <screen token>`（或 console token），与 WS 首帧鉴权同一套令牌；Origin 校验沿用现有白名单。
6. 新增 env：`VOICE_LOCAL_URL`（默认 `http://127.0.0.1:8810`）、`VOICE_TTS_ENABLED`、`VOICE_TTS_STYLE`。

**验收（Task 1–4审查后更新）**：热状态 `/tts` 首包含发送前重生成，P50≤350ms、P95≤600ms；重生成率单独记录，超过10%需排查。固定话术不触发合成；顶替/强制退场后合成请求在200ms内停止；voice-local自检失败时大屏无声但卡片正常。完整语音链路按决策G在Task 6验收。

---

### Task 4：TTS 流式兜底（v3 重写）

**状态：✅ 已完成并通过复查**（见文首「施工进度」）。下文保留为施工规格原文。

边合成边播放时，句末才发现问题已无法撤回，所以检查必须前移：

1. **首片检查（零额外延迟）**：voice-local 拿到第一片（约 0.5s 音频）后先检查峰值；若近乎静音，**丢弃并重新生成一次**，此时还未向客户端发送任何字节，客户端只感知到多一次首包时间。
2. **失控封顶**：每句 `max_tokens = ⌈(字数 × 0.4 + 1.5) × 12⌉`（实测语速 0.20–0.28 秒/字，留约一倍余量）；达到上限即截断该句。原型已按此公式实现。
3. **已开始发送后**不再重试：中途出错则结束该句，继续下一句；整轮至少有卡片可看。
4. 打点：`trace/metrics.ts` 增加 `asrMs`、`classifyMs`、`ttsFirstByteMs`、`ttsRegenerated`、`ttsTruncated`、`playbackStartMs`（浏览器回报，见 Task 5）。
5. 上述「0.4 秒/字」「首片峰值阈值」须在施工完成后用 30 轮实测校准并写回本文档。

**Codex Task 3–4 施工校准（2026-10-06，本机正式服务，30轮）**：10种中文业务/固定话术各3次，启动回环自检CER=0。最终30轮均输出非静音语音，0失败/0截断，3次首片近静音触发发送前重生成；ASR回环CER最大4%。实测语速0.18–0.2933秒/字（含标点，P95=0.276），继续采用`VOICE_TTS_SECONDS_PER_CHAR=0.4`与额外1.5秒预算。完整模型首片有效峰值最低0.001038，被丢弃峰值0.000122–0.000732，采用`VOICE_TTS_SILENCE_PEAK=0.001`（int16满幅归一化）。

首包历史实测：27次无重生成均≤400ms；包含3次重试后P50=301.55ms、P95=571.11ms、最大578.3ms。真实分类＋编排＋浏览器的8题联调首包约399–417ms，重试一轮约688ms。Claude审查后确认按含重试的P50≤350ms、P95≤600ms验收，旧30轮分布达标；不降低静音阈值。单服务取消28–42ms，编排强制退场约130ms；取消记录仍保留时新GET=410，已发送200的流立即断开。固定5条话术GET新增合成0次。详细记录与逐轮数据：视觉仓`docs/voice-8c-stage34-result.md`、`docs/voice-8c-tts-calibration.json`。修复批实测见`docs/voice-8c-task14-repair-result.md`。浏览器播放结束同步属于Task 5，现场麦克风识别属于Task 6，回环结果不代替现场验收。

**验收**：mock 一次首片静音 → 用户听到的是正常语音，trace 记 `ttsRegenerated`；mock 一次失控 → 该句被截断、下一句照常播放、状态机正常进入 followup。

---

### Task 5：浏览器 PCM 播放器 + 状态同步（v3 重写）

**状态：✅ 已完成并通过复查**（`232bc85` + 修复 `80a1c9e`）。交付与验证见 `docs/voice-8c-task5-result.md`、`docs/voice-8c-task5-repair-result.md`。下述“现状”保留为施工前基线。

**现状**：`OverlayStage.tsx:117-123` 振幅为 `demoAmplitude`；`:203` 用定时器判定播报结束；`live-source.ts:129-134` 丢弃 `tts.boundary`；`JarvisCore.tsx:302` 读 `frame.amplitude(now)`（**零改动**）。

**要做**：

1. 新建独立模块 `src/lib/voice/pcm-player.ts`（不依赖 React，可单测），职责：
   - `fetch` 拉取 `audio/pcm` 流 → int16 转 float32 → 按块创建 `AudioBuffer`（sampleRate 24000）→ 在同一个 `AudioContext` 时间轴上**首尾相接调度**；
   - 首块到达后**预缓冲 150ms** 再开始播放，之后边收边排；
   - 所有块经过同一个 `AnalyserNode` → 暴露 `getAmplitude(): number`（RMS 归一化到 0–1）；
   - 按句顺序播放：播第 i 句时预取第 i+1 句；
   - 事件：`onSentenceStart(index)` 在该句**第一个样本的实际调度时刻**触发（用 `AudioContext.currentTime` 计算，不是在下载时触发）；`onDrained()` 在**所有句子的流都已结束、且 `currentTime ≥ 最后一块的结束时刻`** 时触发；
   - `stop()`：立即停止所有已调度的块并中断下载（顶替 / 退场 / 错误）。
2. **协议（增量、向后兼容）**：`answer.delta` 末片（`full: true`）增加可选字段：
   ```ts
   speech?: { turnId: string; sentences: { index: number; displayStart: number; displayEnd: number }[]; staleNotice?: string }
   ```
   浏览器据此按 `GET /voice/audio/:turnId/:index` 拉取。`tts.boundary` 在 live 模式下不再由服务端发送（类型保留），句级高亮由 `onSentenceStart` 在本地驱动。`parseWireEvent` 与快照测试同步更新。
3. `OverlayStage.tsx`：live 模式下振幅改读 `player.getAmplitude()`；demo 模式保留 `demoAmplitude`。
4. `OverlayStage.tsx:203`：answering → followup 改为由 `onDrained` 驱动；**保留一个兜底超时**（预计时长 × 2 + 2s），防止音频异常导致状态机卡死。
   - 同步修改编排侧状态机，不能让它继续按打字速度抢先进入followup。告别的服务端回报入口已准备：screen发送`{type:"playback.drained",at,turnId}`，仅匹配当前告别轮；普通回答的回报处理仍需在Task 5接通。告别使用`speech.fixed="goodbye"`的缓存音频，播完退场。未接播放器时告别有PCM时长×2+2秒兜底；告别与追问超时均不取消音频。
5. 浏览器把首句开始播放的时间回报给编排服务（复用 trace，用于 L1 统计）。
6. Kiosk 启动参数加 `--autoplay-policy=no-user-gesture-required`；`AudioContext` 在首次唤醒时 `resume()`。

**验收**：粒子随真实音频律动；高亮与听到的句子同步（人工对照 + 单测验证调度时刻）；播完才进 followup；顶替时旧音频立即停止；关闭覆盖层基线零回归。

---

### Task 6：麦克风收音 + ASR 接入（v4 更新）

**6a. 收音与识别**

1. 大屏页面 live 模式下 `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}})`，`AudioWorklet` 重采样到 16kHz 单声道。
2. 浏览器端 VAD：推荐 `@ricky0123/vad-web`（Silero VAD，onnxruntime-web，MIT）；**模型与 wasm 文件随站点本地托管**，不从 CDN 加载（断网可用）。参数可配：尾部静音 `VOICE_VAD_HANGOVER_MS`（默认 500）、最短语音 300ms、最长 15s。
3. 收音只在决策 F 允许的状态下开启。**开麦时刻 = 播放器末块结束时刻 + `AudioContext.outputLatency` + 300ms**（Task 5 复查遗留：接蓝牙/USB 音箱时不计输出延迟会收进小川的尾音）。
4. 一句话结束 → `POST /voice/utterance`（Bearer screen token，body = int16 PCM）→ 编排服务转 voice-local `/asr` → 推送 `asr.partial{final:true}` → 走与 `question.submit` 相同的编排流程。该接口计入现有提问限流。
5. 新增 `POST /voice/wake`（screen token）：等价 `session.wake`，供 F9 运维键与 Task 7 唤醒词调用。
6. **角色模型变更**：大屏不再是纯订阅方。WS 上仍禁止大屏发唤醒、提问等控制事件；允许的上行仅限：Task 5 的播放状态回报（仅当前轮），以及 Esc 通过 `playback.failed(reason:"dismissed")` 结束**当前轮**（Task 5 修复批引入，已认可）。收音 / 唤醒上行只走上述两个 HTTP 接口，且必须带 screen token。
7. `/voice-console` 文字提问保持不变（跳过 ASR）。

**6b. 识别文本处理（决策 H）**

8. **剥除唤醒词前缀**：ASR 文本若以「你好小川」「小川」开头（含标点、空格变体），先剥除再分类；剥除后为空则按「没听清」处理。
9. **新增 `greeting` 意图**：现状 `scripted.ts` 关键词里「你好」被归为 `chitchat_or_end`（`intents.ts:54`），唤醒后用户说一句「你好」会直接结束会话。改为：纯问候 → 播 `wake` 固定话术（`cheerful` 风格）→ 回到 listening，不结束会话。LLM 意图枚举、JSON Schema、scripted 回落同步更新，补测试。
10. 识别结果为空或少于 2 个字：播 `unheard`「抱歉先生,我没有听清。」（`apologetic` 风格）→ 回到 followup。

**6c. Task 5 复查遗留（本批一并处理）**

11. 断流后按 `currentTime + 150ms` 重新锚定（现为 +5ms，合成接近实时时会每块有缝）。
12. ambient 状态 suspend `AudioContext`；live 卡片 rAF 在卡片静止后停帧。
13. 读法量词表补「天、周、次、位、名、人、种、批、份、套」（量词前单独的 2 读「两」）。

**验收**：
- 在大屏电脑上按 F9 唤醒 → 说出 8 条问题全部正确作答；followup 窗口内直接追问可用；播报期间说话不会被收音。
- 「你好小川,本月销售情况怎么样」整句识别后，剥除前缀并正确作答；单说「你好」不会结束会话。
- **L1 达到决策 G**（P50 ≤ 1.1s、P95 ≤ 1.3s，≥ 20 轮，三模型常驻），报告须**按阶段拆解**：VAD 判定 → 上传 → ASR → 分类 → TTS 首包 → 浏览器预缓冲 → 首样本；并解释编排侧 TTS 首包比直连多出的部分（Task 5 实测约 65–75ms）。

---

### Task 7：唤醒词「你好，小川」（v4 更新）

1. 浏览器端 sherpa-onnx wasm KWS（`sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`），模型与 wasm 本地托管。
2. **唤醒词「你好小川」**：用 `sherpa-onnx-cli text2token --tokens-type ppinyin` 离线生成 `keywords.txt` 随站点发布；唤醒词可配置，但默认值与界面提示一律是「你好，小川」。代码与配置中不再出现「贾维斯」作为唤醒词。
3. 命中 → `POST /voice/wake` → 播放缓存的「我在,先生。请讲。」（`cheerful` 风格，Task 10）→ **播完 + outputLatency + 300ms** 后开麦进入 listening。
4. 误触发防护：`--keywords-threshold`、`--keywords-score`、能量门限可配；应答后 5s 冷却。
5. （P2，可选）**一口气说完**：用户说「你好小川，本月销售怎么样」不停顿时，KWS 命中后若 300ms 内语音仍在继续，则跳过唤醒应答，直接把后续语音当作问题送 ASR。若本批不做，须在报告中说明。

**验收（建议门槛，需业务确认，见 §6）**：
- 2–3m 距离、背景约 60dB 人声条件下说「你好，小川」20 次 ≥ 18 次成功；唤醒 → 开始播放应答 ≤ 0.8s。
- **负样本**：连续 1 小时展厅背景音误唤醒 ≤ 1 次；另外各说 10 次「大川机床」「小川」「你好」「小王」「你好大川」，误唤醒合计 ≤ 1 次。

---

### Task 8：库存数据（开发可先行，公开上线需业务确认）

**背景**：平台 `erp_inventory_list` 仅 SUPER_ADMIN/PURCHASE/WAREHOUSE 可用，`/api/mcp` 需 Ed25519 用户断言，大屏签不出，故走公开 payload 扩展。

1. **平台仓**新增库存投影（与 `PublicSalesScreenPayload` 同模式），**按仓库 + 单位**组织，例如：
   ```ts
   inventory: {
     warehouses: { name: string; quantities: { unit: string; qty: number }[]; alertCount: number }[];
     alerts: { name: string; unit: string; qty: number; safetyQty: number }[]; // ≤ 10 条
   }
   ```
   **不同单位绝不相加**；单价、成本、供应商、采购价一律不进 payload。
2. 视觉仓：快照构造、意图 `inventory_overview / inventory_alerts`、库存卡片（按仓分行，数量带单位）、播报模板（分仓分单位）。
3. 公开范围与字段清单需业务确认后才能在生产开启（feature flag 默认关）。

**验收**：问「库存还有多少」→ 分仓分单位播报，无跨单位合计；问「哪些物料预警了」→ 列出前 3 项并说明总数；fixture 与平台投影字段一致。

---

### Task 9：跨机部署（HTTPS 单一源）

1. 在语音 Mac 上部署反向代理（推荐 Caddy，`tls internal` 或 mkcert 证书），路由见 §0.5；把根证书安装到大屏电脑的系统信任库。
2. **安全开关**：新增 `VOICE_HUB_BEHIND_PROXY=1`。开启时，即使编排服务绑定在 `127.0.0.1`，`assertHubExposureSafe`（`config.ts:114`）也必须要求双令牌——否则经代理的跨机流量会落入「回环免令牌」分支。
3. Origin 白名单只放 `https://<语音 Mac 主机名>`。
4. 大屏 Chrome kiosk 启动参数：`--kiosk`、`--autoplay-policy=no-user-gesture-required`、`--use-fake-ui-for-media-stream`（自动允许麦克风，仅限专用展示机）；令牌通过 `#hubToken=` 片段传入（现有机制）。
5. **仅限调试**的备选：不配 HTTPS 时，可在大屏 Chrome 加 `--unsafely-treat-insecure-origin-as-secure=http://<mac-ip>:3015`，同时 WS/音频也走同一 http 源。不得用于正式展厅。
6. 进程守护：LM Studio、voice-local、编排服务、Next.js、反代开机自启（launchd），并在 `/health` 汇总各组件状态。

**验收**：大屏电脑重启后无人工操作即可唤醒问答；拔掉令牌访问 `/voice/*` 返回 401；断开外网后用快照回答并说明数据时间。

---

### Task 10：情绪风格（v4 新增，建议与 Task 6–7 同批）

**现状**：voice-local 只接受一组参考对（`core.py` `Settings.ref_audio/ref_text/style`，`VOICE_TTS_STYLE=default`）；编排 `AudioStore` 固定使用一个 style；固定话术 5 条单一风格。`/health.styles` 已是数组（保持）。

**10a. voice-local 多参考对**

1. 新增 `VOICE_TTS_STYLES_DIR`：目录内每对 `<id>.wav` + `<id>.txt` 即一个风格，`id` 须匹配 `^[a-z_]{1,32}$`；`default` 仍由 `VOICE_TTS_REF_AUDIO/TEXT` 提供（目录里的 `default.*` 若存在须与之一致，否则启动报错）。本机配置指向 `~/voxlab/ref/styles_v1/`。
2. 启动时读入**每个风格的音频字节**（不再按路径每次重读，顺带解决 Task 1–4 审查低优先级第 4 条），分别计算 refHash；对**每个风格**做回环自检（合成该风格参考文本的前半句 → ASR → CER ≤ 20% 且非静音）。
3. `/health` 返回：`styles`（自检通过的 id 数组）、`styleHashes`（id → refHash）、`failedStyles`。单个风格失败不影响其他风格；`default` 失败则整个 TTS 视为不可用（沿用现有逻辑）。
4. `POST /tts` 的 `style` 只接受 `styles` 中的 id，否则 400（现有白名单校验扩展）。

**10b. 编排侧选风格**

5. 按决策 I 实现 `speechStyleFor(intent, answer)`：意图与数据（是否超额、逾期是否 > 0）→ 风格 id；映射表集中一处并可配置覆盖。
6. `AudioStore.start(sentences, style)` 按轮传入风格；风格不在 `/health.styles` 中时回落 `default` 并记 trace `styleFallback`。
7. 固定话术按场景绑定风格：`wake` → `cheerful`、`followup` / `goodbye` → `warm`、`fallback` / `unheard` → `apologetic`。缓存键使用**该风格**的 refHash；任一风格 refHash 变化只重建该风格的缓存。
8. trace 增加 `style` 字段；对话台显示本轮风格。

**验收**：
- 7 个风格自检全部通过；`advise` 补跑与 §0.6 相同的评测并写入报告。
- 每个**已映射**风格：可懂 CER ≤ 10%（15/15）、0 静音 0 失控；`default`、`apologetic` 额外满足 F0 ±15%。
- **每个已映射风格的 TTS 首包 P95 ≤ 600ms**（参考越长预填充越久，`serious_long` 10.1s 须单独报告）。
- 超额完成的销售问题用 `cheerful`、未完成用 `default`、降级用 `apologetic`、告别用 `warm`，单测与真模型各覆盖一次。
- 删除 `VOICE_TTS_STYLES_DIR` 后系统照常工作（全部回落 `default`）。

---

### Task 12：答案卡改版与溢出修复（v6，用户 2026-10-07 定方向）

**状态**：设计方向已定（参考效果图），排在 Task 6/7/10 修复与本机真人测试之后、Task 11 之前。

**参考效果图**（用户用 ChatGPT 生成并认可，位于 `docs/design/answer-card-mockups/`）：

| 文件 | 内容 |
| --- | --- |
| `效果图_1_区域发运分布.png` | 宽卡：左侧 TOP5 排行（名次徽章 + 条形 + 台/单 + 占比），右侧迷你中国地图与发运航线 |
| `效果图_2_目标完成率.png` | 左侧大圆环，右侧三行图标指标（已完成 / 目标 / 距目标还差） |
| `效果图_3_合同额目标进度.png` | 大号金额 + 完成率 + 进度条 + 目标/差额 |
| `现状_*.png` | 改版前 8 个问题的实拍，用于对照 |

效果图是 AI 生成的概念图，**取其版式、层次与质感，不照抄其中的文字**；文字与数字一律来自 payload 与代码模板。

#### 12.1 版面与几何（1920×1080 设计坐标，1280×720 等比缩放）

- **核心上移缩小**：进入 answering 时，粒子核心从 (960, 470) 平滑移到约 (960, 225)，半径缩到约 0.75 倍（≈600ms，与卡片展开同步）；退场时逆向复原。实现方式：`params.ts` 的 `overlayGeometry` 增加阶段参数，由 OverlayStage 写入 `frame.geometry`——`JarvisCore.tsx` 已从 `frame.geometry` 读取核心位置，**渲染层仍零改动**。
- **能量束**：核心底部到卡片顶边中点一道竖向粒子流（效果图中的「光柱」），沿用 plan §7 的粒子流向卡片锚点，改为竖向收束。
- **卡片区**：顶边 y = 400；**底边硬上限 y = 1020**（安全边 60px）；最大高度 620px。宽度两档：标准 880px，宽卡 1040px（区域分布带地图时）。
- **卡片框**：切角边框 + 四角加亮 + 边缘辉光（SVG/CSS 实现），沿用 `--ov-*` 铜/琥珀色令牌与黑体金额；**不引入 WebGL / Three.js**（plan §13 红线）。
- **卡片分区**（自上而下，各区高度固定）：
  1. 标题区：`2026年9月 · 区域发运分布` + 副标题一行；
  2. **数据区**：各模板的图形主体（下表）；
  3. **小川播报区**（对应效果图中的「AI 洞察」框，见 12.3）；
  4. **可继续追问条**（见 12.4）。
- 背景地面光环与地平线光带（效果图底部）：**P2 可选**，Canvas 2D 或 CSS 实现，覆盖层帧增量仍须 ≤ 8ms；`?lite=1` 时关闭。

#### 12.2 模板清单（8 种，统一视觉体系）

| 意图 | 模板 | 数据区内容 | 数据字段 |
| --- | --- | --- | --- |
| sales_progress | `target-progress` | 按效果图 3：大号金额、完成率、进度条、月度目标 / 距目标还差（超额时显示「已超额」） | `collection.*` |
| target_rate | `completion-ring` | 按效果图 2：大圆环 + 三行图标指标 | `collection.*` |
| region_shipments | `region`（宽卡） | 按效果图 1：左 TOP5 排行，右迷你地图；地图**复用现有** `src/data/china-map.json`、`src/lib/geo.ts` 与 `ShipmentMap` 的投影，只画省界、航线与落点，不另引地图库 | `delivery.routes`、`delivery.summary` |
| upcoming_shipments | `customers-shipments` | 设备清单（型号 / 合同尾号 / 状态标签 / 日期），每行一行高；顶部今日到期 / 七日内 / 逾期三枚计数徽章 | `delivery.milestones`、`delivery.summary` |
| new_customers | `customer-kpi`（新） | 两块大数字指标：本期新增 / 客户总数 | `kpis.periodNewCustomers`、`kpis.totalCustomers` |
| followup_todo | `followup-buckets`（新） | 三块指标：今日 / 七日内 / 逾期；逾期 > 0 时该块琥珀加亮（不用红色） | `kpis.todayFollowUp`、`sevenDayFollowUp`、`overdueFollowUp` |
| collection | `collection-split`（新） | 左回款率圆环（复用 `completion-ring` 视觉），右已回 / 未回金额，下方一条双色比例条 | `collection.collectionRate`、`totalPaidAmount`、`totalUnpaidAmount` |
| greeting / chitchat_or_end / unanswerable / 没听清 / 退出语 | `brief`（精简卡） | 无数据区，只有一句话 + 追问条；**修复现有正文重复显示两遍的问题** | — |

新模板走现有注册表（`cards/registry.tsx`）、协议逐字段校验（`isValidAnswerCard`）、`card-builders.ts` 同源 formatter。播报文本不因改版而变化。

#### 12.3 小川播报区（替代效果图中的「AI 洞察」）

效果图里的「AI 洞察」是模型自由生成的分析建议，这与红线 3（LLM 文字不进入输出）冲突，且其中的「建议…」没有数据依据。改为：

- 标题「**小川播报**」（不用「AI 洞察」字样，避免让人以为是模型分析）；
- 正文 = 本轮实际播报文本 `card.spoken`，**随播放逐句高亮**（Task 5 已有句级高亮）；这样也顺带解决了文字重复显示；
- 可选一行「**提示**」：从**规则表**生成的固定句，例如：
  - 合同额未达标：「距离目标还差 ¥214.0万，可关注待签合同的推进。」
  - 已超额：「本月合同额已超额完成，超出 ¥X万。」
  - 逾期跟进 > 0：「有 6 项跟进已逾期，建议优先处理。」
  - 区域：「广东省发运台数最多。」
  
  规则表集中一处、按数据条件选句；句中数字只能来自 payload，同样过数字护栏；**只显示、不播报**。没有匹配规则则不显示。

#### 12.4 可继续追问条

效果图中的示例问题（「本月和上月相比如何？」「哪些客户最有希望成交？」「哪些区域增速最快？」「发运与合同额是否匹配？」）**系统都答不了**——没有历史同期数据，客户级明细是永久红线（见 `voice-coverage-backlog.md`）。展示它们只会引导观众问出「抱歉先生,我暂时无法调取这项数据」。

- 追问条**只能列出当前支持的问题**，每张卡固定 2 条，映射表集中一处：

| 当前卡片 | 追问示例 |
| --- | --- |
| target-progress | 目标完成率是多少？ · 回款情况怎么样？ |
| completion-ring | 本月销售情况怎么样？ · 回款情况怎么样？ |
| region | 近期有哪些发货安排？ · 本月销售情况怎么样？ |
| customers-shipments | 各区域发货分布怎么样？ · 今天有多少跟进待办？ |
| customer-kpi | 今天有多少跟进待办？ · 本月销售情况怎么样？ |
| followup-buckets | 本月新增了多少客户？ · 近期有哪些发货安排？ |
| collection-split | 本月目标完成率是多少？ · 本月销售情况怎么样？ |
| brief（答不上来） | 「您可以问我：」本月销售情况 · 回款情况 · 发货安排 |
| brief（问候 / 告别 / 退出语） | 不显示 |

- Task 8 库存接入后，再加库存相关追问。

#### 12.5 溢出规则（硬性）

1. **任何卡片底边不得超过 y = 1020**，左右不得超出画布。
2. 各模板数据区高度固定，**列表每页最多 5 行**。数据超过 5 项时**分页**：页面之间水平滑动过渡（约 400ms），底部页码圆点；自动翻页与播报句同步（无句子对应时每 4s 翻一页），最多 3 页，其余合并为「其他 N 项」。区域卡排行只列 TOP5，其余合并为「其他 N 省 · X 台」，地图仍显示全部落点。
3. 长文本：标题一行省略；播报区最多 3 行（播报本身 ≤ 3 句）；提示一行省略；金额按 `formatMoney` 定长格式，必须在 `¥99,999.9万` 这样的最长值下不换行。
4. 用**长数据夹具**测试：20 个省份、15 条发运、最长金额、全部 0 值、超额 180% 等。

#### 12.6 演示模式

`?voiceDemo=1` 改为**轮播全部 7 张数据卡**（每张走完整的发射 → 播报 → 收回流程），展厅无人说话时也能展示全部效果。

#### 12.7 验收

- Playwright：8 种卡片 × 正常数据 + 长数据夹具，在 1920×1080 与 1280×720 下，卡片外框 bounding box 底边 ≤ 1020、无文本节点溢出（`scrollWidth ≤ clientWidth`）。
- 屏上数字与播报数字逐一一致；追问条中的每个问题经分类器都落在受支持意图（自动测试）。
- 产出 8 张卡的 1920×1080 截图放入 `docs/design/answer-card-mockups/实现_*.png`，**由用户对照效果图人工确认**。
- 覆盖层开启时帧增量 ≤ 8ms（`?lite=1` 关闭背景装饰）；现有大屏基线测试全绿。

---

### Task 11：接入平台真实数据（v5 新增）

**现状**：
- 大屏 `/screen/sales` 用的是 mock 数据（`src/app/screen/sales/page.tsx:28` `buildMockScreenPayload()`）；
- 编排服务默认读本地 fixture；`VOICE_PAYLOAD_MODE=http` 已能读平台 `GET /api/screen/sales/[publicId]`，但**决策 E 的快照缓存没有任何任务实现**：每次提问现拉，断网即降级。

**数据来源（不变的原则）**：只读平台已有的**公开大屏接口** `PublicSalesScreenPayload`（平台侧已做脱敏：无客户名/联系人/电话/地址，合同号打码，金额可配倍率）。语音与大屏**都不直连数据库**、不走 MCP、不持有数据库账号。

**要做**：
1. **编排服务快照缓存（决策 E 落地）**：后台每 60s 拉一次；成功即写本地文件（gitignored，权限 0600）并更新内存；提问时只读内存快照，提问路径不发网络请求；拉取失败沿用上一份；快照 > 10 分钟播报加「先生,以下是 HH 点 mm 分的数据。」并在卡片显示更新时间；> 24 小时或从未成功则降级。
2. **大屏页接平台数据**：服务端渲染时从同一平台接口取数（或读编排服务的快照），保持「首屏无 loading」；60s 轮询沿用。大屏与语音必须是**同一份快照**，避免屏上数字与播报不一致。
3. 配置：`VOICE_PAYLOAD_URL`、`VOICE_PAYLOAD_PUBLIC_ID`（大屏页与编排共用）；publicId 只放本机配置，不进仓库、不进日志（沿用 `guard/redaction.ts`）。
4. 字段校验：拉到的 payload 先过现有结构校验（`public-payload.ts`），不合法视为拉取失败，不覆盖上一份好快照。

**前置（需用户 / 运维）**：在生产平台「系统设置 → 销售大屏分享」生成 publicId（`/api/system/sales-screen/share`，需管理员登录），并确认这台 Mac 能访问平台域名。

**验收**：屏上数字与播报数字逐一一致；拔网线后照常回答并说明数据时间；恢复网络后 60s 内更新；publicId 不出现在日志与 trace 中。

---

## 3 全局验收（8c 收口）

| # | 项 | 标准 |
| --- | --- | --- |
| 1 | 延迟 | L1（VAD 判定说完 → 开始播放）P50 ≤ 1.1s、P95 ≤ 1.3s；同时报告 L2。≥ 20 轮，三模型常驻，大屏电脑经局域网访问 |
| 2 | 音色与可懂度 | 合成 F0 中位 89–120Hz **且** Whisper 转写 CER ≤ 10%（`eval_ref.py`）；更换参考对后必须重测并人工试听 |
| 3 | 数字准确 | 播报与卡片同源，diff 测试全绿；LLM 文本不进入播报；防幻觉用例必降级；库存无跨单位合计 |
| 4 | 识别 | 展厅现场 20 条真人提问（含口语改写）识别 + 选卡正确 ≥ 18 条 |
| 5 | 稳定性 | 连续 30 轮无静音、无失控、无状态机卡死 |
| 6 | 断网 | 拔外网：语音照常工作，使用快照并说明数据时间；快照超 24h 降级 |
| 7 | 安全 | `/voice/*` 无令牌 401；非白名单 Origin 拒绝；经代理时强制令牌 |
| 8 | 基线无回归 | 关闭覆盖层，`/screen/sales` 现有测试全绿 |
| 9 | 唤醒 | 「你好，小川」按 Task 7 门槛通过，含「大川」等负样本 |
| 12 | 无人值守 | 唤醒后静默、持续噪声、各状态 Esc、播报中断后，系统均能自行回到可唤醒状态（决策 K） |
| 10 | 情绪风格 | 按 Task 10 验收；用户人工试听确认各场景风格合适 |
| 11 | 人设命名 | 用户可见的语音与文字中不出现「贾维斯 / Jarvis」 |

---

## 4 红线（不要做）

1. 不改 WS 协议加二进制帧——音频走 HTTP。
2. key、模型路径、参考对不硬编码——走环境变量。
3. **LLM 的输出文字不进入播报**；LLM 不接收业务快照。
4. 不用英文参考音频做中文播报。
5. `JarvisCore.tsx` 渲染层零改动；不动 `.screen-*` 基线样式。
6. 不走平台 MCP 拿库存；库存不同单位不相加。
7. ~~播报期间不收音（第一版）。~~ v7 作废：改为说话即打断，但打断必须经两段确认，不能一检测到人声就停播。
8. 不从公网 CDN 加载 VAD / KWS 模型与 wasm。
9. 用户可见的语音与文字不出现「贾维斯 / Jarvis」；内部标识符不为此改名。
10. 情绪风格由代码按意图与数据选择，不交给 LLM 决定。

---

## 5 参考产物（语音 Mac 本机）

| 路径 | 说明 |
| --- | --- |
| `~/voxlab/voice_local.py` | **voice-local 原型**（ASR+TTS 同进程、预热、热词、失控封顶），Task 3a 的起点 |
| `~/voxlab/intent_bench.py` | 结构化选卡：意图定义、JSON Schema、13 条改写用例 |
| `~/voxlab/asr_bench.py` + `asr_q/` | ASR 选型基准与测试音频 |
| `~/voxlab/e2e_bench.py` | 整链路延迟（§0.4 数据来源） |
| `~/voxlab/eval_ref.py` | 参考音频评测：CER + F0 + 失败率，**换参考对必跑** |
| `~/voxlab/ref/ref_zh_9s.wav` | 定稿参考音频 |
| `~/voxlab/models/` | TTS / ASR / Whisper 模型（已下载完整） |
| `~/voxlab/say.py`（命令 `xiaochuan`） | 人工试听任意文案；`--style <中文名>` 切换风格 |
| `~/voxlab/ref/styles_v1/` | **情绪风格参考对**（ASCII id，Task 10 配置用） |
| `~/voxlab/eval_styles.py` | 情绪风格评测（可懂度、音色、起伏、语速），§0.6 数据来源 |
| `~/voxlab/ref/emo/` | 用户提供的 4 段情绪原始音频（ElevenLabs，2026-10-07） |

---

## 6 待业务确认（不阻塞 Task 1–7 开发）

1. **库存**：是否允许进入公开 payload；字段与单位清单（Task 8）。
2. **唤醒可靠率门槛**：Task 7 中的建议值（含负样本清单）是否接受。
3. **延迟目标**：是否接受以 L1 为验收口径（决策 G）。
4. **VAD 尾部静音**：默认 500ms，展厅实测后定。
5. **情绪风格映射**：决策 I 的场景 → 风格表是否认可（尤其「未完成目标用默认而非严肃」）。

---

## 7 对 Codex 评审（2026-10-06）的逐条回应

| # | 评审意见 | 结论 | 处理 |
| --- | --- | --- | --- |
| 1 | ASR 没有施工任务 | 采纳 | §0.3 实测选型；新增 Task 6；voice-local 提供 `/asr` |
| 2 | 裸 PCM 不能按普通音频播放；ended 定义 | 采纳 | Task 5 独立 `pcm-player`；「播完」= 流结束且队列耗尽 |
| 3 | 句级高亮须跟随实际播放时间 | 采纳 | 按句拉取 + `onSentenceStart` 用调度时刻触发；服务端不再发 `tts.boundary` |
| 4 | 结构化答案与流式切句冲突 | 采纳 | 决策 B：等短 JSON 完整返回再由代码生成播报；实测选卡 0.45s，整链路 0.96s |
| 5 | 库存示例单位混用 | 采纳，原文错误 | 决策 B 更正；Task 8 按仓按单位，禁止跨单位相加 |
| 6 | 断网与远程数据冲突 | 采纳，用户已定 | 决策 E 本地快照 + 数据时间说明 |
| 7 | 播放后才校验无法撤回 | 采纳 | Task 4 首片检查（未发送前重生成）+ 按字数封顶 + 已发送不重试 |
| 8 | ≤1.5s 口径不清、余量小 | 采纳 | 决策 G 定义 L1/L2，实测预算，P50/P95 |
| 注 1 | 自检不能证明逐字匹配 | 部分解决 | 决策 D 增加 ASR 回环 CER 自检；仍要求换参考对后跑评测并试听；缓存 key 含参考对哈希 |
| 注 2 | 数字正则只是备用 | 采纳 | 主防线为意图枚举 + 模板 + 统一格式化；正则仅告警 |
| 注 3 | 大屏设备位置 | 用户已定：另一台电脑 | §0.5 拓扑 + Task 9 HTTPS 单一源 + 代理下强制令牌 |
