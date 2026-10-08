# voice-orchestrator —— 「小川」语音编排服务（8c Task 1–5）

独立 Node 进程：WS hub + payload 预取 + 本地意图分类 + 确定性卡片/播报 + 会话编排。
零 npm 依赖,Node ≥ 22.6 TS 直跑(`--experimental-strip-types`)。

## 启动

```bash
# 仓库根目录
node --experimental-strip-types services/voice-orchestrator/src/main.ts
# 或
pnpm --dir services/voice-orchestrator start
```

- 监听 `ws://localhost:3210`(VOICE_HUB_PORT 可改),HTTP GET `/` 为探活端点。
- 无 `VOICE_LLM_API_KEY` 时自动落到离线 scripted 适配器:意图由离线路由分类，答案由公开 fixture
  口径确定性生成,供 `/voice-console` 全链路演示与验收(无需外网)。

## 验收路径(plan §16.2 D/F)

1. 启动本服务;另起 `pnpm dev`(3015)。
2. 打开大屏 `http://localhost:3015/screen/sales?voiceLive=1`(订阅 hub)。
3. 打开对话台 `http://localhost:3015/voice-console`,点 8 条快捷问题,
   观察大屏 粒子→答案卡 动效与本页事件流/打点。
4. 打点 JSONL 落在 `logs/voice-trace.jsonl`(gitignored),
   `node scripts/voice-latency-report.mjs` 输出 P50/P95 延迟报告。

## 错误路径演练(三条降级)

| 路径 | 演练方法 | 预期 |
| --- | --- | --- |
| 编排崩溃 | 会话中 kill 本进程 | 大屏 FORCE_CLOSE 优雅退场回基线,自动重连 |
| LLM 超时 | 配 `VOICE_LLM_*` 指向不通端点(或测试内注入) | 8s 后 error(llm_timeout)→ 降级话术 → 退场 |
| 数据源异常 | `VOICE_PAYLOAD_MODE=http` 指向 500 端点 | error(datasource)→ 降级话术 → 退场 |

## 安全基线(2026-09-28 外部审核后加固)

- **默认只绑 127.0.0.1**(`VOICE_HUB_HOST` 可改);跨机部署 = 显式放开 + 自行评估。
- **Origin 校验**:浏览器不受 WS 同源策略保护,不校验 = 运维机器上任意网页可跨站
  劫持(读经营数据/操纵大屏/烧 LLM 额度)。默认仅本机来源放行;
  `VOICE_HUB_ALLOWED_ORIGINS` 精确白名单可放开。
- **双令牌首帧鉴权**:设置 `VOICE_HUB_CONSOLE_TOKEN` / `VOICE_HUB_SCREEN_TOKEN`
  (各 ≥16 字符、互不相同)后,客户端连上后的**第一条**消息必须是
  `{"type":"hub.auth","token":"…"}`,服务端按令牌决定角色(对话台/大屏),
  错误令牌以 4401 关闭,`console.hello` 自报角色不再被采信。非回环绑定
  (`VOICE_HUB_HOST` 不是 127.0.0.1/localhost/::1)而未设双令牌时,服务
  **拒绝启动**(退出码 1)。令牌传输不用 URL 查询串:大屏从 `#hubToken=`
  片段读取(读后存 sessionStorage 并从地址栏抹掉),对话台可在页面输入。
  `?hub=` 白名单除本机地址外,可用构建期 `NEXT_PUBLIC_VOICE_HUB_HOSTS`
  (逗号分隔主机名)放行跨机 hub 地址。
- **角色模型**:只有声明为 console 的连接可提问或唤醒；screen 仅可回报当前轮播放开始/耗尽/失败/跳句，以及当前回答或追问阶段的 Esc 退场（`playback.failed` 的 `reason: "dismissed"`）；不允许 screen 发通用 `session.close`，未声明角色只读;
  角色仅允许声明一次(防中途提权)。`trace.turn`(含问题原文)只发 console。
- **帧层防线**:分片累计总长上限 1MB、客户端帧强制掩码、无起始续帧拒绝
  (1002)、二进制/未知 opcode 关闭(1003)、并发连接上限 32;握手后 5s 内须声明角色(否则 4408)、25s 心跳 / 60s 无入站断开、控制帧 ≤125B 且不分片、RSV 须为 0。
- **限流**:全局(按 hub 计,不按连接)提问最小间隔 1.5s + 60s 窗口 8 问(可配),超出回
  error(rate_limited);被新问题顶替的旧轮立即 abort(LLM 流/死线/预取外呼)。
- **数据策略**:问题原文会写入 trace JSONL 并广播给对话台(展厅大屏本来就要
  展示转写,属产品行为);如需不落盘问题原文,把 `VOICE_TRACE_FILE` 置空即可。
  8c 分类请求只发送当前问题和意图定义，不发送经营快照或历史答案。模型
  地址默认回环，模型 ID 必须由环境变量显式提供。

## 当前交付边界

8c Task 1–2 已接入：真实本地 LLM 只输出 `{intent}`，strict JSON Schema 加运行时严格解析。
意图枚举在 `src/lib/voice/intents.ts`；`intent-answers.ts` 将意图映射到卡片 builder，播报取 `card.spoken`。
`spoken-normalize.ts` 生成汉字读法和句子 UTF-16 偏移，显示原文不变；本地 TTS 管线逐句消费。

Task 3–4 已完成本地 ASR/TTS 服务和音频 HTTP 管线。Task 5已接入浏览器PCM播放、真实振幅、句级高亮及播放状态同步。麦克风采集、唤醒、快照缓存和跨机HTTPS仍属后续施工；当前通过对话台输入问题。
平台 MCP 代码保留，但分类主路径不调用工具，不将模型文本用于播报。
首期不支持库存和指定地区、仓库、客户、型号、历史时期的筛选；覆盖外问题明确降级。
完成率保留真实值（包括超过 100%），发货提醒计数使用完整 summary，而非样本数组长度。

本地配置（复制 `.env.example` 为 `.env.local`，模型 ID 填 LM Studio 当前已加载的标识）：

```dotenv
VOICE_LLM_BASE_URL=http://127.0.0.1:1234/v1
VOICE_LLM_API_KEY=local-placeholder
VOICE_LLM_MODEL=your-loaded-model
VOICE_LLM_REASONING_EFFORT=none
VOICE_MCP_ENABLED=0
```

本地服务不校验 key 时仍需非空占位值，才能选择真实适配器。缺少 key 时使用 scripted。
`reasoning_content` 有内容而 `content` 为空时，会明确诊断思考模式。
数字 token 校验是备用告警：异常记录 `numberGuardViolations`，不静默把整个模板替换掉。

`/voice-console` 显示 `classifyMs`（一次完整分类耗时），旧 `llmFirstToken` 在分类路径为 null。
运行真实模型验收（Node 22.6+，模型 ID 从环境变量读取）：

```bash
node --experimental-strip-types scripts/voice-intent-report.mjs docs/voice-8c-intent-latency-report.md
```

该脚本先预热，再跑 8 条对话台问题和原型 13 条问题各两轮；两条库存问题本阶段预期降级。
此报告只测完整分类调用，不代表真实语音首音延迟。

## 配置

见 `.env.example`;红线:key/模型不落仓,日志经 `guard/redaction.ts`
脱敏(publicId/凭证字段永不落盘,沿用 sales-screen step3 约定);
启动日志只打数据源模式,不打 URL。

## 布局

```
src/
  main.ts            入口:hub + 数据源 + LLM + 编排接线
  config.ts          环境变量(.env.local 宽松加载)
  orchestrator.ts    会话编排(同一 reducer 做镜像;预取→分类→代码模板→广播)
  ws/codec.ts        RFC6455 帧编解码(纯函数,单测)
  ws/ws-server.ts    最小 WS hub(零依赖)
  llm/types.ts       LlmAdapter 接口(classify + 保留 stream 兼容)
  llm/scripted.ts    离线确定性适配器(路由=纯函数,fail-closed)
  llm/zhipu.ts       OpenAI 兼容本地分类客户端（历史文件名保留）
  datasource/        fixture / http 数据源 + 本地数字快照/护栏 + 保留 MCP 客户端
  trace/metrics.ts   打点(question→prefetch→first_token→tool_exec→answer_full)
  guard/redaction.ts 日志脱敏
fixtures/            公开 payload fixture(字段=平台 PublicSalesScreenPayload)
test/                vitest(与根仓同一命令:pnpm test)
```

## Task 3–4 音频接口

开启编排配置；voice-local 和编排的启动顺序不再影响最终恢复：

```dotenv
VOICE_TTS_ENABLED=1
VOICE_LOCAL_URL=http://127.0.0.1:8810
VOICE_TTS_STYLE=default
VOICE_HUB_CONSOLE_TOKEN=your-distinct-console-token
VOICE_HUB_SCREEN_TOKEN=your-distinct-screen-token
```

令牌各至少16字符且不同；开启 TTS 时回环部署也必须配置。默认 TTS 关闭，无额外模型请求。启动自检或固定缓存失败会记录告警、静音，卡片和状态机继续正常工作。启用时每30秒复查健康；恢复后自动重建/加载固定缓存。健康但参考哈希不变时不重复合成；参考哈希变化时取消旧音频轮、刷新全部固定话术，完成后才恢复就绪。并发健康刷新合并，关闭会取消刷新和轮询。

音频通过现有 hub 的 HTTP 端口提供。所有数据 GET 要求 `Authorization: Bearer <screen或console令牌>`，Origin 沿用 WS 白名单。合法 Origin 的浏览器 OPTIONS 预检只返回 GET/Authorization 许可，不返回音频/状态，也不授予数据读取权限。错误 Origin 拒绝；后续 GET 仍校验 Bearer。

- `GET /voice/health`：音频是否启用/就绪与静音原因。
- `GET /voice/audio/fixed/:key`：`wake`、`followup`、`goodbye`、`fallback`、`unheard`。启动时从磁盘加载或合成，运行期 GET 不调用模型。
- `GET /voice/audio/:turnId/:index`：已缓冲内容接续实时 PCM。元信息通过 `answer.delta` 末片的可选 `speech` 字段公布，不改变旧事件顺序。

PCM 格式为 int16 LE、24kHz、mono。客户端合并跨网络块的半个 int16 样本。取消后新的 GET 返回410；已发送 HTTP 200 的连接不能改成410，因此立即断开流。失败/截断句不冒充完整音频：尚未发头时返回503；已发200时断开body。浏览器保留已经排程的音频，跳过失败句的剩余部分并继续后续句，显示卡片提示，并回报跳过句索引与原因。有完整成功句时，在全部流结束及末样本播放结束后回报 drained；没有完整成功句时，等待已排程部分播完后回报 failed；没有音频则立即失败。整轮超时、自动播放受限或超过8MiB下载上限仍直接失败。只有整轮失败回报会取消服务端余下合成，单句跳过不取消。

每轮缓存最多8MiB，保留120秒、最多4条轮记录；单大屏每次新建轮会取消所有旧轮，最多1轮有效。被取消轮立即释放音频。固定缓存位于忽略的 `logs/tts-cache/`，键包括参考音频字节、参考文本、模型标识/路径、温度、策略参数、style和话术。更换参考对并重启voice-local后，编排将在下一次健康检查识别哈希变化，无需重启编排。

告别回答使用缓存的 `goodbye`，`speech`追加 `fixed: "goodbye"`，仍按轮ID读取，保留顶替/强制取消/TTL语义。告别不新建GPU合成，播完后退场。

## Task 5 浏览器播放与状态同步

- `src/lib/voice/pcm-player.ts`：int16 LE转float32，24kHz AudioBuffer共享AudioContext时间轴与AnalyserNode；首块预缓冲150ms，50ms块连续排程。正在播放第i句时预取下一句。聚合下载限8MiB；停止会abort下载并stop/disconnect所有排程节点。
- 句级高亮在AudioContext.currentTime到达首块排程时间时触发。全部句子流正常或异常结束且currentTime达到末块结束时刻才完成。单句下载失败采用“跳过并记录、继续后续句”策略；至少一整句成功才能回报 drained，全部失败不能伪装成功。
- screen经已鉴权WS回报 `{type:"playback.started"|"playback.drained",at,turnId}`，失败用 `{type:"playback.failed",at,turnId,reason}`，跳句用 `{type:"playback.skipped",at,turnId,sentenceIndex,reason}`。仅所属大屏的当前轮回报有效；console、unknown、其他大屏、旧轮、重复终态与越界/重复跳句忽略。Esc仅所属大屏可触发当前会话退场；不会把此前drained记录改成失败。
- 普通答案实际播完后等待8秒再进入followup；语音追问提示播完、麦克风实际打开后开始3秒静默窗口。问候/没听清直接重新聆听，告别播完退场。失败/超时保留完整可读卡片至少8秒后异常退场，不播追问。
- 出卡时没有在线大屏，用原打字/持卡节奏完成展示，再等待8秒；保留合成/缓存。所属大屏断开取消会话，不伪装播完或转交其他标签。
- 防止挂起：普通音频按归一化文本的保守合成时长（0.4秒/字＋1.5秒/句）×2＋2秒兜底；告别用缓存PCM时长×2＋2秒。播放器独立网络/音频时钟超时；覆盖层另留8秒持卡时间和2秒退场保障，仅异常退场，不自行进入追问。正常播完和追问超时保留PCM；普通播放失败/超时、顶替、强制关闭等取消音频。
- live粒子振幅来自真实PCM RMS；demo保留模拟驱动；`JarvisCore.tsx`没有修改。高亮只切分显示字符串，不改变卡片数字或读法。
- 首次唤醒/点击/键盘事件尝试resume AudioContext。展厅启动可用 `bash scripts/start-voice-kiosk.sh`，带 `--autoplay-policy=no-user-gesture-required`；本阶段没有开启麦克风权限。

`/voice-console`显示首音回报、播放结果和被跳过的句子。`playbackSkipped` 在最终 JSONL 中记录句子索引及失败原因；无屏按文字展示节奏完成状态等待，所属屏断开取消会话。`playbackStartMs` 可为 null，不作为真实播放验收样本。`playbackStartMs`使用hub单一时钟，表示「提问到收到浏览器首样本开始回报」，包含回传网络耗时；第一句被跳过时以首个实际播放句子为准。不与异机Date.now相减，也不等同于Task 6的VAD L1。合成完成及播放终态都确定后，每轮只追加一条JSONL；取消/失败/兜底同样落盘。语音输入记录实际ASR耗时，文字输入不产生ASR样本。其他固定提示（wake/followup/fallback/unheard）保持缓存接口，收音阶段的提示播放与开麦节拍在Task 6接线。

验证：`pnpm test`、`pnpm test:e2e`。E2E使用真实hub/HTTP鉴权/CORS/Chromium Web Audio，只把GPU换成确定性PCM。

### 真人测试修复后的规则（2026-10-07，覆盖上方旧收尾规则）

- 鉴权成功的直接 `hub.hello` 返回本连接的 `screenId`；`session.start.screenId` 指定负责收音和播音的大屏。语音唤醒选择发起请求的大屏，文字对话台选择第一个在线大屏。其他标签只显示；其播放回报、Esc和收音不能推进会话。所属大屏断开即取消，不假报播完或交给其他标签。
- `POST /voice/wake`、`/voice/listen`、`/voice/utterance` 必须附 `X-Voice-Screen`；后两者仍需 `X-Voice-Session` 和 `X-Voice-Listen`。唤醒验证连接在线且已鉴权，收音验证会话归属。重连取得新id，旧请求失效。
- 正常答案实际播完后保留答案 **8秒**，不开麦、不显示追问；然后进入followup。语音会话播完追问提示，等待输出延迟+300ms、麦克风实际打开后，开始原有3秒静默窗口。问候/没听清仍直接重新聆听，告别仍播完退场。顶替、Esc、断线取消待触发追问。
- 整轮播放失败或超时不进入追问。卡片至少保留8秒；长答案保证剩余打字时间+2秒，随后error退场。自动播放被阻止时，点击启用后续声音，等退场后再唤醒。固定唤醒/追问失败直接error退场，不打开麦克风。
- 无屏用文字展示节奏完成后再等8秒；所属屏断开记cancelled及screen_disconnected原因。前端异常兜底只退场，不自行进入followup。
- trace追加 `playbackFailureReason`、`playbackScreenId`、`playbackEndMs`、`playbackScreenCount`、`followupDelayMs`。固定提示失败的原因和类型写入编排日志，不记录令牌。

真实模型验证脚本（先完成production build，voice-local已预热，分类模型配置已提供）：

```bash
pnpm build
VOICE_LLM_MODEL=<currently-loaded-model> VOICE_LLM_API_KEY=local-placeholder node --experimental-strip-types scripts/voice-playback-check.mjs
```

脚本使用公开fixture与独立回环hub/临时Next端口18815；输入对话台8题＋告别，真实分类及TTS，验证卡片、振幅、队列耗尽和回报，结束后关闭临时进程。不接麦克风，不证明音箱现场听感。报告见 `docs/voice-8c-task5-result.md`。
