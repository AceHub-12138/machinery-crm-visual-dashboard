# 8c 全本地语音栈施工任务书（交付 Codex）

- 版本：**v3** · 2026-10-06
  - v2：TTS 参考音频改为中文
  - **v3：按 Codex 评审补齐 ASR、浏览器 PCM 播放、结构化答案与播报管线、断网快照、跨机部署、半双工收音、延迟口径；全部新增数字均为本机实测**（评审逐条回应见 §7）
- 前置：8a 视觉壳 ✓、8b 数据通路 ✓（`?voiceDemo=1` / `?voiceLive=1` + `/voice-console` 均已跑通）
- 目标：唤醒 → 收音 → 识别 → 选卡 → 代码生成播报 → 本地克隆音色播放 → 大屏卡片与粒子同步。**ASR / LLM / TTS 全部在本机运行，不调用任何第三方云 API。**
- 已定的产品决策（用户 2026-10-06 确认）：
  1. **大屏网页在另一台电脑上打开**（局域网访问运行语音服务的 Mac）
  2. **断网时用最后一次成功的数据快照**回答，并说明数据时间
  3. **第一版不支持打断**：播报期间麦克风不收音

> 读法：每个任务给出「现状 → 要做什么 → 验收」。改动点带 `file:line`（基于仓库初始快照 `a433bad`，施工前请核对）。**不要扩大改动范围。**

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

---

## 2 施工任务

与 Codex 评审中的阶段划分对应：阶段 2 = Task 1–2；阶段 3 = Task 3–4；阶段 4 = Task 5；阶段 5 = Task 6–7（含 Task 9 部署）；阶段 6 = Task 8。

### Task 1：本地 LLM 结构化选卡

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

**施工状态（2026-10-07）**：已完成，待复核。交付与验证见 `docs/voice-8c-task5-result.md`。下述“现状”保留为施工前基线。

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

### Task 6：麦克风收音 + ASR 接入（v3 新增）

1. 大屏页面 live 模式下 `getUserMedia({audio:{echoCancellation:true, noiseSuppression:true, autoGainControl:true}})`，`AudioWorklet` 重采样到 16kHz 单声道。
2. 浏览器端 VAD：推荐 `@ricky0123/vad-web`（Silero VAD，onnxruntime-web，MIT）；**模型与 wasm 文件随站点本地托管**，不从 CDN 加载（断网可用）。参数可配：尾部静音 `VOICE_VAD_HANGOVER_MS`（默认 500）、最短语音 300ms、最长 15s。
3. 收音只在决策 F 允许的状态下开启。
4. 一句话结束 → `POST /voice/utterance`（Bearer screen token，body = int16 PCM）→ 编排服务转 voice-local `/asr` → 推送 `asr.partial{final:true}` → 走与 `question.submit` 相同的编排流程。该接口计入现有提问限流。
5. 新增 `POST /voice/wake`（screen token）：等价 `session.wake`，供 F9 运维键与 Task 7 唤醒词调用。
6. **角色模型变更**：大屏不再是纯订阅方。WS上仍禁止大屏发唤醒、提问、强制关闭等控制事件；Task 5的播放耗尽回报属于受限状态回报，仅允许当前轮。收音/唤醒上行通过上述两个HTTP接口，且必须带screen token。
7. `/voice-console` 文字提问保持不变（跳过 ASR）。

**验收**：在大屏电脑上按 F9 唤醒 → 说出 8 条问题全部正确作答；followup 窗口内直接追问可用；播报期间说话不会被收音；L1 达到决策 G 目标并出报告。

---

### Task 7：唤醒词

1. 浏览器端 sherpa-onnx wasm KWS（`sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01`），模型本地托管；唤醒词默认「贾维斯」，可配。
2. 命中 → `POST /voice/wake` → 播放缓存的「我在,先生。请讲。」→ 播完开麦进入 listening。
3. 误触发防护：置信度阈值、能量门限可配；应答后 5s 冷却。

**验收（建议门槛，需业务确认，见 §6）**：2–3m 距离、背景约 60dB 人声条件下 20 次唤醒 ≥ 18 次成功；连续 1 小时展厅背景音下误唤醒 ≤ 1 次；唤醒 → 开始播放应答 ≤ 0.8s。

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

---

## 4 红线（不要做）

1. 不改 WS 协议加二进制帧——音频走 HTTP。
2. key、模型路径、参考对不硬编码——走环境变量。
3. **LLM 的输出文字不进入播报**；LLM 不接收业务快照。
4. 不用英文参考音频做中文播报。
5. `JarvisCore.tsx` 渲染层零改动；不动 `.screen-*` 基线样式。
6. 不走平台 MCP 拿库存；库存不同单位不相加。
7. 播报期间不收音（第一版）。
8. 不从公网 CDN 加载 VAD / KWS 模型与 wasm。

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
| `~/voxlab/say.py`（命令 `xiaochuan`） | 人工试听任意文案 |

---

## 6 待业务确认（不阻塞 Task 1–7 开发）

1. **库存**：是否允许进入公开 payload；字段与单位清单（Task 8）。
2. **唤醒可靠率门槛**：Task 7 中的建议值是否接受。
3. **延迟目标**：是否接受以 L1 为验收口径（决策 G）。
4. **VAD 尾部静音**：默认 500ms，展厅实测后定。

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
