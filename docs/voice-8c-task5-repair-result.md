# 8c Task 5 审核修复交付

- 日期：2026-10-07。
- 仓库：`/Users/apple/Desktop/Codex/machinery-crm-visual-dashboard`。
- 施工分支：`codex/voice-8c-task5-playback`；修复基线 `232bc85`。
- 依据：Claude 的 `voice-8c-task5-review.md` 和上轮 `voice-8c-task1-4-recheck.md`；用户确认自查结论后授权施工。
- 范围：3 个中优先级问题、1 个遗留容量泄漏，以及相应回归测试/报告更正。未开始 Task 6 收音功能。
- 状态：本地修复；未合并、未推送、未部署。没有修改数据库、本机模型配置或依赖版本。开始前已有的 `next-env.d.ts` 自动生成差异保持原样，不纳入本次提交。

## 四项修复

| 审核问题 | 修复后的行为 | 验证证据 |
| --- | --- | --- |
| 没有大屏时出卡后等待约 47 秒 | 出卡时检查在线 screen 数：没有大屏则走原打字/持卡节奏；播放等待期间最后一台大屏断开，立即按 drained 结束等待。保留服务端合成及 PCM 缓存。 | 无屏文字节奏单测；两屏→一屏仍等待、最后一屏断开立即 followup；合成未完成时不断开 worker，完成后仅写一条 trace；浏览器真实 WS 断开验证。 |
| Esc 本地退场、hub 仍追问 | `playback.failed` 增加 `reason: "dismissed"`；仅 screen、匹配当前 turnId/seq、处于 answering/followup 才调用 `forceClose("force")`。播报中退场记 cancelled；追问中退场保留此前 drained 记录。 | 两阶段的角色/旧轮/重复回报单测；真实 Chromium Esc 检查 hub 回到 ambient，移除原 E2E 的手动关闭兜底；追问阶段 Esc 后新问题可重新唤醒；实际 JSONL 终态断言。 |
| 下一句出错硬切上一句 | 采用审核推荐的“跳过失败句、继续后续句”策略。保留已排程样本，失败流中已经收取的完整块也继续排程；不会因预取句 503 立即 stop 整轮。 | 第 2 句 503 时，第 1 句完整排程到 1.150s，第 3 句从该尾部接续，末样本后才 drained；浏览器第二句失败时第一句无提前 stop，耗尽后进入追问，JSONL 记录跳句。 |
| voice-local 响应头阶段断开永久占名额 | StreamingResponse 子类用响应调用层 finally 统一清理流状态、取消未耗尽生成及释放队列，覆盖生成器尚未开始的异常路径；同时回收超过 120 秒且 worker 已完成的遗留 streaming job，取消并唤醒迭代器。 | 真 ASGI 发送响应头时注入 OSError（ASGI 2.4）与取消（2.3），各连续 8 次后仍可成功取得下一次 TTS；流标志复位、队列为空。TTL 回收遗留流且不回收仍运行的 GPU job。 |

WebSocket 断开接线位于 `main.ts` 的 `onClose → orchestrator.detach`，连接集合先删除再计数；未声明角色及 console 断开不会影响播放。每轮 waitingForScreens 标志阻止重复断开重启追问计时，旧轮回报不影响新轮。

## 跳句与播放终态契约

- 新增 screen 上行 `playback.skipped`：`{at,turnId,sentenceIndex,reason}`。原因仅允许 `audio_unavailable`、`invalid_audio`、`audio_interrupted`；索引需是非负整数且小于当前句数。仅当前 answering 轮有效，重复索引忽略。
- 最终 trace 的 `playbackSkipped` 记录每个跳过句的索引与原因；对话台显示被跳过的句子，大屏提示“部分语音播报中断，请查看卡片。”。
- 至少一整句播放数据成功时，全部句子流正常或异常结束、音频时钟到达末块尾部后才回报 drained。卡片文本不删句；trace 明确记录缺失的播报。
- 若所有句子都失败：有已排程的部分音频则先让它播完，再回报 failed；没有音频则立即失败，不伪装成 drained。
- 第一条句子失败时，`playback.started` 改为首个实际播放句触发，整轮只发一次；高亮仍用原文对应句索引。
- 顶替、主动退场仍立即 abort 当前下载与预取并停止音源。整轮超时、自动播放受限、累计下载超过 8MiB 仍直接失败，避免把资源上限误当成可跳过的单句故障。
- 无屏/断屏按 drained 结束的是状态等待；`playbackStartMs` 可为 null，不代表现场实际发声，不作为 L1 首音验收。

## 验证

- TypeScript/Vitest：**349/349**，25 个测试文件；其中播放器 19 项、音频/编排 25 项。
- Python unittest：**14/14**；使用已有 `/Users/apple/voxlab/.venv/bin/python`，运行库与锁文件一致，未安装或升级依赖。
- Chromium E2E：**13/13**；真实 hub、鉴权/CORS HTTP、Web Audio、WS 断开及 JSONL 落盘，GPU 替换为确定性 PCM。新增用例覆盖追问阶段 Esc、第二句失败、第一句失败的首音回报；原 4 项大屏布局/隐私回归保留。
- `pnpm exec tsc --noEmit`、`pnpm lint`、`pnpm build`、`git diff --check`：通过。
- 本批没有重新加载真模型、重测 GPU 延迟、人工试听物理音箱或开启麦克风。自动化验证覆盖代码、浏览器播放时间轴、故障恢复和容量释放；真实模型延迟仍需后续整机验证。

复跑：

```bash
pnpm test
/Users/apple/voxlab/.venv/bin/python -m unittest discover -s services/voice-local -v
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm test:e2e
```

## 原报告更正与遗留项

1. 上轮要求 Task 5 补修的 voice-local 容量名额泄漏确实遗漏，现已补修。不能只依赖 `background=`：本机锁定的 Starlette 1.7.0 在 ASGI ≥2.4 发送抛 OSError 时可能直接退出，调用层 finally 才能覆盖该路径。
2. 原 Task 5 E2E 包含 Esc 和顶替操作，但只检查停播、DOM 退场或服务端取消。本批直接断言 Esc 后 hub 终态，以及顶替时仍未完成下载的浏览器 AbortSignal 被中断。
3. “8 秒音频不抢先追问”原断言只在约 4.15 秒检查，早于旧文字节奏约 4.85 秒期限；现追加首音后 **6.5 秒**检查 answering 且无 drained，保留最后耗尽断言。
4. 移除把所有 FORCE_CLOSE 都误报 `audio_interrupted` 的逻辑，也消除了告别本地兜底的重复失败回报路径；只有主动 Esc 发 dismissed，真实播放错误发具体故障。
5. 编排侧与直连首包延迟差值尚未按阶段拆解；Task 6 的 L1 报告必须补充，不能从两组独立样本的中位数差直接断定 GPU 争用原因。
6. 输出延迟 `outputLatency`、断流后 150ms 重新预缓冲、多屏一台失败取消整轮、live 卡片停帧及 ambient suspend 留给 Task 6。当前仍按 AudioContext 时间轴判定末样本，不将蓝牙/USB 的实际输出延迟称为已验收。
7. 读法量词“天、周、次、位、名、人、种、批、份、套”，以及上轮低优先级的取消钩子自检、异常日志、503 原因、参考音频启动时读入、非回环访问拒绝、缓存 fsync、标点句过滤等仍需后续明确排期；本批没有宣称已完成。
8. Task 6 仍须接入 VAD/ASR 后至少 20 轮按 VAD 结束→实际首音测 L1/L2，并考虑输出延迟后再等待 300ms 开麦。`/health.styles` 继续为数组，本批没有引入单 style 假设或修改风格接口。

建议 Claude 按原审核要求仅复核四项修复与补充测试；本批未发送外部消息或发起新任务。
