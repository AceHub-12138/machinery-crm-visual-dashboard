# 8b 打点延迟报告(voice-orchestrator · 数据通路)

- 日期:2026-09-28(k3/voice-mode-8a 分支,8b 阶段验收实测)
- 环境:本机 Windows / Node v22.23;数据源=本地 fixture;LLM=离线 scripted 适配器
  (无 VOICE_LLM_API_KEY,首字延迟为适配器模拟值,不含真实网络与推理耗时)
- 打点埋点:plan §16.2 B④——question → prefetch → llm_first_token → tool_exec → answer_full
- 采集方式:编排服务逐轮写 `services/voice-orchestrator/logs/voice-trace.jsonl`
  (gitignored,经 guard/redaction 脱敏),`node scripts/voice-latency-report.mjs` 汇总

## 汇总(22 轮实测,其中降级轮 3)

| 阶段 | P50 | P95 | 样本数 | 说明 |
| --- | --- | --- | --- | --- |
| 提问基点 | 0 ms | 0 ms | 22 | t0 |
| 预取完成(payload) | 549 ms | 597 ms | 21 | fixture 读盘+结构校验;含 partial 视觉节奏并行 |
| LLM 首字 | 584.5 ms | 628.1 ms | 20 | scripted 适配器固定 30ms 模拟延迟 |
| 工具轮完成 | — | — | 0 | 主路径零工具轮;MCP flag 关,无长尾样本 |
| 全答就绪 | 585 ms | 629.1 ms | 20 | 卡片构造完成并广播 |
| 提问 → 全答(端到端) | 585 ms | 629.1 ms | 20 | |

## 解读

1. **主路径远低于 thinking 8s 死线(plan §4)**:P95 ≈ 0.63s,即使叠加真实 LLM
   首 token(典型 0.5~1.5s)与一句播报,总链路仍在 8s 兜底之内。
2. **预取是延迟大头之一但被视觉节奏完全遮盖**:逐字转写(partial pacing ≤1.2s)
   与预取并行,用户感知的等待 = max(转写节奏, 预取+LLM),而非两者之和。
3. **工具轮样本为 0 是 8b 的设计结果**("主路径零工具轮"红线);8c 接真实模型后
   长尾问题才会产生 tool_exec 样本,届时本报告补充该列。
4. **降级轮**:数据源 500(HTTP 模式演练)、LLM 挂起(6s 死线演练)、覆盖缺口
   (华南退货率)各 1 轮——三条路径均按 §16.2 收束到降级话术并优雅退场,基线无感。
5. 真实 LLM(智谱)与真实 TTS 的延迟须在 8c/租用设备到位后复测;本报告锁定
   「编排层自身开销」基线:<1ms 协议广播 + fixture/校验/注入构造 <10ms。

## 复现

```bash
node --experimental-strip-types services/voice-orchestrator/src/main.ts   # 终端 1
pnpm dev                                                                   # 终端 2(3015)
# 大屏 http://localhost:3015/screen/sales?voiceLive=1;对话台 /voice-console 提问
node scripts/voice-latency-report.mjs services/voice-orchestrator/logs/voice-trace.jsonl
```
