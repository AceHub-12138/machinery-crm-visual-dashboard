# voice-orchestrator —— 「小川」语音编排服务（8c Task 1–4）

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
- **角色模型**:只有声明为 console 的连接可发控制事件;screen/未声明角色只读;
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

Task 3–4 已完成本地 ASR/TTS 服务和音频 HTTP 管线。浏览器播放、麦克风采集、唤醒、快照缓存和跨机 HTTPS 属于后续施工，当前界面仍是文字驱动的问答。
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

先启动 `services/voice-local/run.py`，再开启编排配置：

```dotenv
VOICE_TTS_ENABLED=1
VOICE_LOCAL_URL=http://127.0.0.1:8810
VOICE_TTS_STYLE=default
VOICE_HUB_CONSOLE_TOKEN=your-distinct-console-token
VOICE_HUB_SCREEN_TOKEN=your-distinct-screen-token
```

令牌各至少16字符且不同；开启 TTS 时回环部署也必须配置。默认 TTS 关闭，无额外模型请求。启动自检或固定缓存失败会记录告警、静音，卡片和状态机继续正常工作。

音频通过现有 hub 的 HTTP 端口提供。所有数据 GET 要求 `Authorization: Bearer <screen或console令牌>`，Origin 沿用 WS 白名单。合法 Origin 的浏览器 OPTIONS 预检只返回 GET/Authorization 许可，不返回音频/状态，也不授予数据读取权限。错误 Origin 拒绝；后续 GET 仍校验 Bearer。

- `GET /voice/health`：音频是否启用/就绪与静音原因。
- `GET /voice/audio/fixed/:key`：`wake`、`followup`、`goodbye`、`fallback`、`unheard`。启动时从磁盘加载或合成，运行期 GET 不调用模型。
- `GET /voice/audio/:turnId/:index`：已缓冲内容接续实时 PCM。元信息通过 `answer.delta` 末片的可选 `speech` 字段公布，不改变旧事件顺序。

PCM 格式为 int16 LE、24kHz、mono。客户端合并跨网络块的半个 int16 样本。取消后新的 GET 返回410；已发送 HTTP 200 的连接不能改成410，因此立即断开流。无音频的失败句返回204，后续句继续合成。

每轮缓存最多8MiB，保留120秒、最多4轮；被取消轮立即释放音频。固定缓存位于忽略的 `logs/tts-cache/`，键包括参考音频字节、参考文本、模型标识/路径、温度、策略参数、style和话术。更换参考对后重启服务使缓存自然失效。

打点增加 `ttsFirstByteMs`、`ttsRegenerated`、`ttsTruncated`、`ttsFail`。首包后立即更新 console trace；整轮合成或取消后只追加一条最终 JSONL 记录，避免重复统计。真实 ASR 输入和浏览器播放尚未接入，`asrMs`、`playbackStartMs` 预留为 null。`classifyMs` 保留真实分类耗时。

Task 5 将接入播放器、振幅、高亮及播放结束反馈。本阶段保持现有展示计时，不能用它测语音播放结束或耳朵听到的延迟。
