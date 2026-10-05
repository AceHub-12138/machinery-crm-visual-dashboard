# voice-orchestrator —— 「小川」语音编排服务(8b 数据通路)

独立 Node 进程:WS hub + 预取注入 + LLM 适配器 + 会话编排。
零 npm 依赖,Node ≥ 22.6 TS 直跑(`--experimental-strip-types`)。

## 启动

```bash
# 仓库根目录
node --experimental-strip-types services/voice-orchestrator/src/main.ts
# 或
pnpm --dir services/voice-orchestrator start
```

- 监听 `ws://localhost:3210`(VOICE_HUB_PORT 可改),HTTP GET `/` 为探活端点。
- 无 `VOICE_LLM_API_KEY` 时自动落到离线 scripted 适配器:答案由注入 fixture
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
  接入真实 LLM 时,注入快照(经营数字)会发往模型服务商,上生产前需确认
  数据外发合规。

## 当前语音与 MCP 边界（2026-10-05 源码复核）

当前交付为文字驱动的 8b 数据/视觉通路。ASR、TTS、麦克风采集和唤醒尚未接入，振幅为合成演示值。
平台 MCP **未启用，代码保留**：主入口未调用 initialize，编排请求未给 LLM 传工具目录，因此仅打开 feature flag 不能打通长尾路径。保持 `VOICE_MCP_ENABLED=0`；接线、权限验证及真实平台联调须另行验收。

本地 OpenAI 兼容 LLM 配置示例（本地服务无密钥时仍需非空占位值，才能选择真实适配器）：

```dotenv
VOICE_LLM_BASE_URL=http://127.0.0.1:1234/v1
VOICE_LLM_API_KEY=local-placeholder
VOICE_LLM_MODEL=your-loaded-model
VOICE_MCP_ENABLED=0
```

这里没有验证已安装模型的推理质量、首 token 延迟、麦克风或扬声器；离线 scripted 数据不能作为真实语音延迟承诺。

## 配置

见 `.env.example`;红线:key/模型不落仓,日志经 `guard/redaction.ts`
脱敏(publicId/凭证字段永不落盘,沿用 sales-screen step3 约定);
启动日志只打数据源模式,不打 URL。

## 布局

```
src/
  main.ts            入口:hub + 数据源 + LLM + 编排接线
  config.ts          环境变量(.env.local 宽松加载)
  orchestrator.ts    会话编排(8a 同一 reducer 做镜像;预取→LLM→选卡→广播)
  ws/codec.ts        RFC6455 帧编解码(纯函数,单测)
  ws/ws-server.ts    最小 WS hub(零依赖)
  llm/types.ts       LlmAdapter 接口(OpenAI 兼容流式语义)
  llm/scripted.ts    离线确定性适配器(路由=纯函数,fail-closed)
  llm/zhipu.ts       智谱 GLM(OpenAI 兼容 SSE 流式)
  datasource/        fixture / http 数据源 + 注入快照 + 防幻觉护栏 + MCP 客户端
  trace/metrics.ts   打点(question→prefetch→first_token→tool_exec→answer_full)
  guard/redaction.ts 日志脱敏
fixtures/            公开 payload fixture(字段=平台 PublicSalesScreenPayload)
test/                vitest(与根仓同一命令:pnpm test)
```
